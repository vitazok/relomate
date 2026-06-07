import { inngest, type DraftRequestedEvent } from '@/lib/inngest/client';
import { makeRepository } from '@/lib/case/repository';
import { makeApprovalRepository } from '@/lib/approvals/repository';
import { makeDraftRepository } from '@/lib/drafting/repository';
import { makeAiDraftGenerator, type DraftGenerator } from '@/lib/drafting/generator';
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

  const proceed = await step.run('load-draft', async () => {
    const draft = await drafts.getById(draftId);
    if (!draft) return false;
    if (draft.status !== 'drafting') return false;
    if (draft.type !== 'cover_letter') throw new Error(`unsupported draft type: ${draft.type}`);
    return true;
  });
  if (!proceed) return;

  try {
    const generated = await step.run('generate-cover-letter', async () => {
      const loaded = await repo.loadCase(caseId);
      return generator.generateCoverLetter({
        caseId,
        profile: loaded.profile,
        caseFacts: loaded.caseFacts,
      });
    });

    await step.run('store-draft', () =>
      drafts.setReady(draftId, {
        content: { type: 'cover_letter', data: generated.content },
        modelVersion: generated.modelVersion,
        promptVersion: generated.promptVersion,
      }),
    );

    await step.run('create-approval', () =>
      approvals.createPending({ caseId, userId, subjectType: 'draft', subjectId: draftId }),
    );

    await step.run('log-ready', async () => {
      await db.insert(schema.activityLog).values({
        caseId,
        userId,
        kind: 'case.draft.ready_for_review',
        payload: { draftId, draftType: 'cover_letter' },
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
        payload: { draftId, draftType: 'cover_letter' },
      });
    });
  }
}

export const generateDraft = inngest.createFunction(
  { id: 'generate-draft', triggers: [{ event: 'draft.requested' }] },
  generateDraftHandler,
);
