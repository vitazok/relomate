'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAuthedUserId } from '@/lib/auth/session';
import { canAccessCase } from '@/lib/auth/authorization';
import { makeRepository } from '@/lib/case/repository';
import { makeApprovalAuthorizer } from '@/lib/approvals/authorization';
import { makeApprovalRepository } from '@/lib/approvals/repository';
import { makeDraftRepository } from '@/lib/drafting/repository';
import { inngest } from '@/lib/inngest/client';
import { db } from '@/lib/db/client';
import {
  approveDraftCore,
  rejectDraftCore,
  type DraftReviewError,
} from '@/lib/drafting/approval-core';
import { DraftContentSchema, type DraftContent } from '@/lib/drafting/types';

export interface DraftReviewActionState {
  error?: DraftReviewError;
  message?: string;
}

function deps() {
  return {
    repo: makeRepository(),
    drafts: makeDraftRepository(),
    approvals: makeApprovalRepository(),
    authorizer: makeApprovalAuthorizer(),
  };
}

export async function approveDraft(input: {
  draftId: string;
  caseId: string;
  content: DraftContent;
}): Promise<DraftReviewActionState> {
  const userId = await requireAuthedUserId();
  const parsed = DraftContentSchema.safeParse(input.content);
  if (!parsed.success) {
    return { error: 'invalid_content', message: 'Please complete all required draft sections.' };
  }
  const res = await approveDraftCore(deps(), { ...input, userId, content: parsed.data });
  if (!res.ok) return { error: res.error, message: res.message };
  revalidatePath(`/case/${input.caseId}`);
  redirect(`/case/${input.caseId}`);
}

export async function rejectDraft(input: {
  draftId: string;
  caseId: string;
  reason?: string;
}): Promise<DraftReviewActionState> {
  const userId = await requireAuthedUserId();
  const res = await rejectDraftCore(deps(), { ...input, userId });
  if (!res.ok) return { error: res.error, message: res.message };
  revalidatePath(`/case/${input.caseId}`);
  redirect(`/case/${input.caseId}`);
}

export async function regenerateDraft(input: {
  draftId: string;
  caseId: string;
  framingInstruction: string;
}): Promise<DraftReviewActionState> {
  const userId = await requireAuthedUserId();
  const framingInstruction = input.framingInstruction.trim();
  if (framingInstruction.length === 0) {
    return { error: 'invalid_content', message: 'Add a framing instruction first.' };
  }
  if (framingInstruction.length > 1200) {
    return { error: 'invalid_content', message: 'Keep the framing instruction shorter.' };
  }
  if (!(await canAccessCase(db, { userId, caseId: input.caseId, action: 'review_draft' }))) {
    return { error: 'forbidden', message: 'You cannot regenerate this draft.' };
  }

  const drafts = makeDraftRepository();
  const source = await drafts.getById(input.draftId);
  if (!source || source.caseId !== input.caseId) {
    return { error: 'not_found', message: 'Draft not found.' };
  }

  const newDraftId = await drafts.insert({
    caseId: input.caseId,
    userId,
    type: source.type,
  });
  await makeRepository().appendActivity({
    caseId: input.caseId,
    userId,
    kind: 'case.draft.requested',
    payload: {
      draftId: newDraftId,
      sourceDraftId: source.id,
      draftType: source.type,
      framingProvided: true,
    },
  });
  await inngest.send({
    name: 'draft.requested',
    data: {
      draftId: newDraftId,
      caseId: input.caseId,
      userId,
      framingInstruction,
    },
  });

  revalidatePath(`/case/${input.caseId}`);
  redirect(`/case/${input.caseId}`);
}
