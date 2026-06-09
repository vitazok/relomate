'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAuthedUserId } from '@/lib/auth/session';
import { makeRepository } from '@/lib/case/repository';
import { makeApprovalAuthorizer } from '@/lib/approvals/authorization';
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
  unmapped?: string[];
}

function deps() {
  return {
    repo: makeRepository(),
    docs: makeDocumentRepository(),
    approvals: makeApprovalRepository(),
    authorizer: makeApprovalAuthorizer(),
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

  const submittedKeys = new Set(input.fields.map((f) => f.key));
  const unsavedSubmitted = res.unmapped.filter((k) => submittedKeys.has(k));
  if (unsavedSubmitted.length > 0) {
    // The confirm DID persist everything it could (and resolved/closed the doc), but some
    // submitted fields couldn't be saved (unrecognized value). Tell the user which ones
    // rather than redirecting as if everything saved.
    return { unmapped: unsavedSubmitted };
  }

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
