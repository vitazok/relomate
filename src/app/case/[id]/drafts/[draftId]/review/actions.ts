'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAuthedUserId } from '@/lib/auth/session';
import { makeRepository } from '@/lib/case/repository';
import { makeApprovalAuthorizer } from '@/lib/approvals/authorization';
import { makeApprovalRepository } from '@/lib/approvals/repository';
import { makeDraftRepository } from '@/lib/drafting/repository';
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
