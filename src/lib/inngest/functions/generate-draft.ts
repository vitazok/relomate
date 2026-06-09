import { inngest, type DraftRequestedEvent } from '@/lib/inngest/client';
import { eq } from 'drizzle-orm';
import { makeRepository } from '@/lib/case/repository';
import { makeApprovalRepository } from '@/lib/approvals/repository';
import { makeDraftRepository } from '@/lib/drafting/repository';
import {
  generateDraftByType,
  makeAiDraftGenerator,
  type DraftGenerator,
} from '@/lib/drafting/generator';
import { db } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';

interface StepLike {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
}

export interface GenerateDraftDeps {
  generator: DraftGenerator;
}

export async function generateDraftHandler({
  event,
  step,
  deps,
}: {
  event: DraftRequestedEvent;
  step: StepLike;
  deps?: GenerateDraftDeps;
}): Promise<void> {
  const { draftId, caseId, userId } = event.data;
  const drafts = makeDraftRepository();
  const repo = makeRepository();
  const approvals = makeApprovalRepository();
  const generator = deps?.generator ?? makeAiDraftGenerator();

  const draftType = await step.run('load-draft', async () => {
    const draft = await drafts.getById(draftId);
    if (!draft) return null;
    if (draft.status !== 'drafting') return null;
    return draft.type;
  });
  if (!draftType) return;

  try {
    const generated = await step.run(`generate-${draftType}`, async () => {
      const loaded = await repo.loadCase(caseId);
      return generateDraftByType(generator, draftType, {
        caseId,
        profile: loaded.profile,
        caseFacts: loaded.caseFacts,
      });
    });

    await step.run('store-draft', () =>
      drafts.setReady(draftId, {
        content: generated.content,
        modelVersion: generated.modelVersion,
        promptVersion: generated.promptVersion,
      }),
    );

    await step.run('create-approval', async () => {
      const [assignment] = await db
        .select({
          assignedConsultantId: schema.cases.assignedConsultantId,
          reviewerId: schema.cases.reviewerId,
        })
        .from(schema.cases)
        .where(eq(schema.cases.id, caseId))
        .limit(1);
      await approvals.createPending({
        caseId,
        userId,
        assigneeUserId: assignment?.assignedConsultantId ?? assignment?.reviewerId ?? null,
        requiredRole: 'consultant',
        visibility: 'internal',
        subjectType: 'draft',
        subjectId: draftId,
      });
    });

    await step.run('log-ready', async () => {
      await db.insert(schema.activityLog).values({
        caseId,
        userId,
        kind: 'case.draft.ready_for_review',
        payload: { draftId, draftType },
      });
    });
  } catch (err) {
    await step.run('mark-failed', async () => {
      const message = err instanceof Error ? err.message : 'draft generation failed';
      await drafts.setFailed(draftId, message.slice(0, 500));
      await db.insert(schema.activityLog).values({
        caseId,
        userId,
        kind: 'case.draft.failed',
        payload: { draftId, draftType },
      });
    });
  }
}

export const generateDraft = inngest.createFunction(
  { id: 'generate-draft', triggers: [{ event: 'draft.requested' }] },
  generateDraftHandler,
);
