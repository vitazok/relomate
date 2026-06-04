import type { Repository } from '@/lib/case/repository';
import type { DocumentRepository } from '@/lib/documents/repository';
import type { ApprovalRepository } from '@/lib/approvals/repository';
import { buildConfirmUpdates, type ReviewedField, type FieldSource } from '@/lib/documents/confirm-mapping';

export interface ConfirmDeps {
  repo: Repository;
  docs: DocumentRepository;
  approvals: ApprovalRepository;
}

export interface ConfirmInput {
  documentId: string;
  caseId: string;
  userId: string;
  fields: ReviewedField[];
}

export type ConfirmError = 'not_found' | 'forbidden' | 'wrong_status' | 'validation';

export type ConfirmResult =
  | { ok: true; updatedPaths: string[]; unmapped: string[] }
  | { ok: false; error: ConfirmError; message?: string };

async function loadOwnedAwaitingDoc(
  deps: ConfirmDeps,
  input: { documentId: string; caseId: string; userId: string }
): Promise<
  | { error: 'not_found' | 'forbidden' | 'wrong_status' }
  | { doc: Exclude<Awaited<ReturnType<DocumentRepository['getById']>>, null> }
> {
  const doc = await deps.docs.getById(input.documentId);
  if (!doc || doc.caseId !== input.caseId) return { error: 'not_found' as const };
  if (doc.userId !== input.userId) return { error: 'forbidden' as const };
  if (doc.status !== 'awaiting_confirmation') return { error: 'wrong_status' as const };
  return { doc };
}

export async function confirmExtractionCore(deps: ConfirmDeps, input: ConfirmInput): Promise<ConfirmResult> {
  const loaded = await loadOwnedAwaitingDoc(deps, input);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { doc } = loaded;

  const { updates, perPathSource, unmapped } = buildConfirmUpdates(doc.spineItemId, input.fields);

  // Group paths by source → at most two applyUpdate calls (zero change to applyUpdate itself).
  const bySource: Record<FieldSource, Record<string, unknown>> = { document: {}, user_corrected: {} };
  for (const [path, value] of Object.entries(updates)) {
    bySource[perPathSource[path] ?? 'document'][path] = value;
  }

  const confirmedPaths: string[] = [];
  const editedPaths: string[] = [];
  try {
    for (const source of ['document', 'user_corrected'] as const) {
      const group = bySource[source];
      if (Object.keys(group).length === 0) continue;
      const result = await deps.repo.applyUpdate({
        caseId: input.caseId,
        source,
        sourceTurnId: null,
        confidence: 1.0,
        updates: group,
      });
      for (const p of result.updatedPaths) {
        confirmedPaths.push(p);
        if (source === 'user_corrected') editedPaths.push(p);
      }
    }
  } catch (err) {
    // A leaf value failed Zod validation in applyUpdate — surface as a field-level error,
    // NOT a crash. Nothing downstream has run, so the approval/doc stay reviewable for retry.
    return { ok: false, error: 'validation', message: err instanceof Error ? err.message : String(err) };
  }

  const approval = await deps.approvals.getBySubject('document', input.documentId);
  if (approval) {
    await deps.approvals.resolve(approval.id, {
      status: 'approved',
      decision: { confirmedPaths, editedPaths, rejectedReason: null },
      resolvedBy: input.userId,
    });
  }

  await deps.docs.setStatus(input.documentId, 'confirmed');

  // PII-safe audit row: leaf KEYS only, never values.
  await deps.repo.appendActivity({
    caseId: input.caseId,
    userId: input.userId,
    kind: 'case.approval.resolved',
    payload: { subjectType: 'document', subjectId: input.documentId, status: 'approved', confirmedPaths, editedPaths },
  });

  return { ok: true, updatedPaths: confirmedPaths, unmapped };
}

export interface RejectInput {
  documentId: string;
  caseId: string;
  userId: string;
  reason?: string;
}

export async function rejectExtractionCore(deps: ConfirmDeps, input: RejectInput): Promise<ConfirmResult> {
  const loaded = await loadOwnedAwaitingDoc(deps, input);
  if ('error' in loaded) return { ok: false, error: loaded.error };

  const approval = await deps.approvals.getBySubject('document', input.documentId);
  if (approval) {
    await deps.approvals.resolve(approval.id, {
      status: 'rejected',
      decision: { confirmedPaths: [], editedPaths: [], rejectedReason: input.reason ?? null },
      resolvedBy: input.userId,
    });
  }
  await deps.docs.setStatus(input.documentId, 'rejected');
  await deps.repo.appendActivity({
    caseId: input.caseId,
    userId: input.userId,
    kind: 'case.approval.resolved',
    payload: { subjectType: 'document', subjectId: input.documentId, status: 'rejected' },
  });
  return { ok: true, updatedPaths: [], unmapped: [] };
}
