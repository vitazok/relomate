import type { Repository } from '@/lib/case/repository';
import type { ApprovalRepository } from '@/lib/approvals/repository';
import type { DraftRepository } from '@/lib/drafting/repository';
import { DraftContentSchema, type DraftContent, type DraftType } from '@/lib/drafting/types';

export type DraftReviewError =
  | 'not_found'
  | 'forbidden'
  | 'wrong_status'
  | 'missing_approval'
  | 'invalid_content';

export type DraftReviewResult =
  | { ok: true }
  | { ok: false; error: DraftReviewError; message: string };

export interface DraftReviewDeps {
  repo: Pick<Repository, 'appendActivity'>;
  drafts: DraftRepository;
  approvals: ApprovalRepository;
}

export interface ApproveDraftInput {
  draftId: string;
  caseId: string;
  userId: string;
  content: DraftContent;
}

export interface RejectDraftInput {
  draftId: string;
  caseId: string;
  userId: string;
  reason?: string | null;
}

function changed(previous: DraftContent | null, next: DraftContent): boolean {
  return JSON.stringify(previous) !== JSON.stringify(next);
}

function contentPath(type: DraftType): string {
  return `draft.${type}.content`;
}

export async function approveDraftCore(
  deps: DraftReviewDeps,
  input: ApproveDraftInput,
): Promise<DraftReviewResult> {
  const draft = await deps.drafts.getById(input.draftId);
  if (!draft || draft.caseId !== input.caseId) {
    return { ok: false, error: 'not_found', message: 'Draft not found.' };
  }
  if (draft.userId !== input.userId) {
    return { ok: false, error: 'forbidden', message: 'You cannot review this draft.' };
  }
  if (draft.status !== 'ready_for_review') {
    return { ok: false, error: 'wrong_status', message: 'This draft is not waiting for review.' };
  }

  const approval = await deps.approvals.getBySubject('draft', input.draftId);
  if (!approval) {
    return { ok: false, error: 'missing_approval', message: 'No pending approval was found.' };
  }

  if (draft.type !== input.content.type) {
    return { ok: false, error: 'invalid_content', message: 'Draft content type does not match.' };
  }

  const content = DraftContentSchema.safeParse(input.content);
  if (!content.success) {
    return { ok: false, error: 'invalid_content', message: 'Please complete the draft content.' };
  }

  const edited = changed(draft.content, content.data);
  await deps.drafts.approve(input.draftId, { content: content.data, approvedBy: input.userId });
  await deps.approvals.resolve(approval.id, {
    status: 'approved',
    resolvedBy: input.userId,
    decision: {
      confirmedPaths: [contentPath(draft.type)],
      editedPaths: edited ? [contentPath(draft.type)] : [],
      rejectedReason: null,
    },
  });
  await deps.repo.appendActivity({
    caseId: input.caseId,
    userId: input.userId,
    kind: 'case.draft.approved',
    payload: {
      draftId: input.draftId,
      draftType: draft.type,
      edited,
    },
  });

  return { ok: true };
}

export async function rejectDraftCore(
  deps: DraftReviewDeps,
  input: RejectDraftInput,
): Promise<DraftReviewResult> {
  const draft = await deps.drafts.getById(input.draftId);
  if (!draft || draft.caseId !== input.caseId) {
    return { ok: false, error: 'not_found', message: 'Draft not found.' };
  }
  if (draft.userId !== input.userId) {
    return { ok: false, error: 'forbidden', message: 'You cannot review this draft.' };
  }
  if (draft.status !== 'ready_for_review') {
    return { ok: false, error: 'wrong_status', message: 'This draft is not waiting for review.' };
  }

  const approval = await deps.approvals.getBySubject('draft', input.draftId);
  if (!approval) {
    return { ok: false, error: 'missing_approval', message: 'No pending approval was found.' };
  }

  const reason = input.reason?.trim() || null;
  await deps.drafts.reject(input.draftId);
  await deps.approvals.resolve(approval.id, {
    status: 'rejected',
    resolvedBy: input.userId,
    decision: {
      confirmedPaths: [],
      editedPaths: [],
      rejectedReason: reason,
    },
  });
  await deps.repo.appendActivity({
    caseId: input.caseId,
    userId: input.userId,
    kind: 'case.draft.rejected',
    payload: {
      draftId: input.draftId,
      draftType: draft.type,
      hasReason: reason != null,
    },
  });

  return { ok: true };
}
