'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAuthedUserId } from '@/lib/auth/session';
import { makeRepository } from '@/lib/case/repository';
import { makeApprovalRepository } from '@/lib/approvals/repository';
import { makeDraftRepository } from '@/lib/drafting/repository';
import {
  approveDraftCore,
  rejectDraftCore,
  type DraftReviewError,
} from '@/lib/drafting/approval-core';
import { CoverLetterContentSchema, type CoverLetterContent } from '@/lib/drafting/types';

export interface DraftReviewActionState {
  error?: DraftReviewError;
  message?: string;
}

function deps() {
  return {
    repo: makeRepository(),
    drafts: makeDraftRepository(),
    approvals: makeApprovalRepository(),
  };
}

function parseParagraphs(raw: string): string[] {
  return raw
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function parseCoverLetterContent(input: {
  title: string;
  recipient: string;
  subject: string;
  paragraphs: string;
  signoff: string;
}): CoverLetterContent | null {
  const parsed = CoverLetterContentSchema.safeParse({
    title: input.title.trim(),
    recipient: input.recipient.trim(),
    subject: input.subject.trim(),
    paragraphs: parseParagraphs(input.paragraphs),
    signoff: input.signoff.trim(),
  });
  return parsed.success ? parsed.data : null;
}

export async function approveDraft(input: {
  draftId: string;
  caseId: string;
  title: string;
  recipient: string;
  subject: string;
  paragraphs: string;
  signoff: string;
}): Promise<DraftReviewActionState> {
  const userId = await requireAuthedUserId();
  const content = parseCoverLetterContent(input);
  if (!content) {
    return { error: 'invalid_content', message: 'Please keep at least three non-empty paragraphs.' };
  }
  const res = await approveDraftCore(deps(), { ...input, userId, content });
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
