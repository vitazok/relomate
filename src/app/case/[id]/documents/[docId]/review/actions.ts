'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAuthedUserId } from '@/lib/auth/session';
import { makeRepository } from '@/lib/case/repository';
import { makeDocumentRepository } from '@/lib/documents/repository';
import { makeApprovalRepository } from '@/lib/approvals/repository';
import {
  confirmExtractionCore,
  rejectExtractionCore,
  type ConfirmError,
} from '@/lib/documents/confirm-core';
import type { ReviewedField } from '@/lib/documents/confirm-mapping';

export interface ReviewActionState {
  error?: ConfirmError;
  message?: string;
}

function deps() {
  return {
    repo: makeRepository(),
    docs: makeDocumentRepository(),
    approvals: makeApprovalRepository(),
  };
}

export async function confirmExtraction(input: {
  documentId: string;
  caseId: string;
  fields: ReviewedField[];
}): Promise<ReviewActionState> {
  const userId = await requireAuthedUserId();
  const res = await confirmExtractionCore(deps(), { ...input, userId });
  if (!res.ok) return { error: res.error, message: res.message };
  revalidatePath(`/case/${input.caseId}`);
  redirect(`/case/${input.caseId}`);
}

export async function rejectExtraction(input: {
  documentId: string;
  caseId: string;
  reason?: string;
}): Promise<ReviewActionState> {
  const userId = await requireAuthedUserId();
  const res = await rejectExtractionCore(deps(), { ...input, userId });
  if (!res.ok) return { error: res.error, message: res.message };
  revalidatePath(`/case/${input.caseId}`);
  redirect(`/case/${input.caseId}`);
}
