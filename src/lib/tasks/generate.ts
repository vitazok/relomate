import type { DocumentStatus } from '@/lib/documents/types';
import type { DraftStatus, DraftType } from '@/lib/drafting/types';
import { DRAFT_TYPE_LABELS } from '@/lib/drafting/types';
import type {
  ApprovalRequiredRole,
  ApprovalStatus,
  SubjectType,
} from '@/lib/approvals/types';
import type { Visibility } from '@/lib/case/visibility';
import type { TaskRequiredRole, TaskSubjectType } from '@/lib/tasks/types';
import type { DesiredSystemTask } from '@/lib/tasks/repository';

// Minimal slices of the canonical rows the generator reads. Kept as local shapes so the
// generator stays pure and trivially testable without constructing full repo rows.
export interface GeneratorDocument {
  id: string;
  fileName: string;
  status: DocumentStatus;
}

export interface GeneratorDraft {
  id: string;
  type: DraftType;
  status: DraftStatus;
}

export interface GeneratorApproval {
  id: string;
  subjectType: SubjectType;
  status: ApprovalStatus;
  requiredRole: ApprovalRequiredRole;
  visibility: Visibility;
  dueAt: Date | null;
}

export interface GeneratorInput {
  documents: GeneratorDocument[];
  drafts: GeneratorDraft[];
  approvals: GeneratorApproval[];
}

// Approval required roles are a strict subset of task required roles; this widens the type
// without a cast (every ApprovalRequiredRole is a valid TaskRequiredRole).
function toTaskRole(role: ApprovalRequiredRole): TaskRequiredRole {
  return role;
}

const SUBJECT_TYPE: Record<SubjectType, TaskSubjectType> = {
  document: 'document',
  draft: 'draft',
};

// Firm-ready approvals (consultant/reviewer) gate the submission package, so their tasks block.
// Applicant/employer confirmations are tracked but non-blocking.
function approvalIsBlocking(role: ApprovalRequiredRole): boolean {
  return role === 'consultant' || role === 'reviewer';
}

function approvalTitle(approval: GeneratorApproval): string {
  if (approval.subjectType === 'draft') {
    return approval.requiredRole === 'applicant'
      ? 'Confirm drafted document'
      : 'Review drafted document';
  }
  return approval.requiredRole === 'applicant'
    ? 'Confirm extracted document details'
    : 'Review extracted document details';
}

/**
 * Pure projection: case artifact state → the set of OPEN system tasks that SHOULD exist.
 *
 * Idempotent by construction — every task carries a stable `generationKey`, so calling the
 * repository's `reconcileSystemTasks` with this output repeatedly neither duplicates a task
 * nor churns one whose inputs are unchanged. A trigger clearing (e.g. a failed doc re-uploaded,
 * an approval resolved) drops its key here, which auto-resolves the stale task on next reconcile.
 *
 * Sources are disjoint to avoid double-counting:
 *  - pending approvals → review/confirm tasks (carrying their role, visibility, due date)
 *  - failed documents  → applicant re-upload tasks
 *  - failed drafts     → firm regenerate tasks
 */
export function deriveSystemTasks(input: GeneratorInput): DesiredSystemTask[] {
  const tasks: DesiredSystemTask[] = [];

  for (const approval of input.approvals) {
    if (approval.status !== 'pending') continue;
    tasks.push({
      generationKey: `approval:${approval.id}`,
      title: approvalTitle(approval),
      requiredRole: toTaskRole(approval.requiredRole),
      dueAt: approval.dueAt,
      blocking: approvalIsBlocking(approval.requiredRole),
      visibility: approval.visibility,
      subjectType: SUBJECT_TYPE[approval.subjectType],
      subjectId: approval.id,
    });
  }

  for (const doc of input.documents) {
    if (doc.status !== 'failed') continue;
    tasks.push({
      generationKey: `document:${doc.id}:reupload`,
      title: `Re-upload ${doc.fileName} — we could not read it`,
      requiredRole: 'applicant',
      blocking: true,
      visibility: 'client_visible',
      subjectType: 'document',
      subjectId: doc.id,
    });
  }

  for (const draft of input.drafts) {
    if (draft.status !== 'failed') continue;
    tasks.push({
      generationKey: `draft:${draft.id}:regenerate`,
      title: `Regenerate ${DRAFT_TYPE_LABELS[draft.type]} — drafting failed`,
      requiredRole: 'consultant',
      blocking: false,
      visibility: 'internal',
      subjectType: 'draft',
      subjectId: draft.id,
    });
  }

  return tasks;
}
