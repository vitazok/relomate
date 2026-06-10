// Pure projection of an organization's cases into the firm-console buckets. No DB, no `now`
// side effects — `now` is parameterized so overdue evaluation is testable, mirroring the
// tasks view model. The console route loads rows + open-task counts and feeds them here.

export interface ConsoleCaseInput {
  id: string;
  status: string;
  assignedConsultantId: string | null;
  reviewerId: string | null;
  targetSubmissionDate: Date | null;
  // Open (non-terminal) blocking task present on the case → the case is blocked.
  hasBlockingTask: boolean;
  // Earliest due date across the case's open tasks, if any → drives the overdue bucket.
  earliestTaskDueAt: Date | null;
  primaryApplicantUserId: string;
  updatedAt: Date;
}

export interface ConsoleCase {
  id: string;
  status: string;
  assignedConsultantId: string | null;
  reviewerId: string | null;
  targetSubmissionDate: string | null;
  primaryApplicantUserId: string;
  blocked: boolean;
  overdue: boolean;
}

export interface ConsoleBuckets {
  // Cases assigned to the viewing consultant (their queue).
  assignedToMe: ConsoleCase[];
  // Open cases with no consultant assigned yet (need triage).
  unassigned: ConsoleCase[];
  // Cases with an open blocking task or a past-due task — surfaced for attention.
  blockedOrOverdue: ConsoleCase[];
}

const CLOSED_STATUSES: ReadonlySet<string> = new Set(['closed', 'submitted', 'archived']);

function isOpen(status: string): boolean {
  return !CLOSED_STATUSES.has(status);
}

function projectCase(input: ConsoleCaseInput, now: Date): ConsoleCase {
  const overdue =
    input.earliestTaskDueAt != null && input.earliestTaskDueAt.getTime() < now.getTime();
  return {
    id: input.id,
    status: input.status,
    assignedConsultantId: input.assignedConsultantId,
    reviewerId: input.reviewerId,
    targetSubmissionDate: input.targetSubmissionDate?.toISOString() ?? null,
    primaryApplicantUserId: input.primaryApplicantUserId,
    blocked: input.hasBlockingTask,
    overdue,
  };
}

// Most recently updated first within each bucket so a consultant sees fresh activity on top.
function byRecency(a: ConsoleCaseInput, b: ConsoleCaseInput): number {
  return b.updatedAt.getTime() - a.updatedAt.getTime();
}

export interface BucketizeOptions {
  // The viewing consultant; their assigned cases fill `assignedToMe`. Firm admins/ops may
  // pass undefined to leave `assignedToMe` empty and triage from `unassigned`.
  viewerUserId?: string;
  now: Date;
}

/**
 * Pure: split an org's cases into console buckets. A case can appear in `blockedOrOverdue` AND
 * one of the assignment buckets — these are attention lenses, not a partition. Closed/submitted
 * cases drop out of `unassigned` (nothing to triage) but a blocked closed case is unusual enough
 * that we still surface it under attention.
 */
export function bucketizeConsoleCases(
  cases: ConsoleCaseInput[],
  options: BucketizeOptions,
): ConsoleBuckets {
  const { viewerUserId, now } = options;
  const sorted = [...cases].sort(byRecency);

  const assignedToMe: ConsoleCase[] = [];
  const unassigned: ConsoleCase[] = [];
  const blockedOrOverdue: ConsoleCase[] = [];

  for (const input of sorted) {
    const projected = projectCase(input, now);

    if (viewerUserId && input.assignedConsultantId === viewerUserId) {
      assignedToMe.push(projected);
    }
    if (input.assignedConsultantId == null && isOpen(input.status)) {
      unassigned.push(projected);
    }
    if (projected.blocked || projected.overdue) {
      blockedOrOverdue.push(projected);
    }
  }

  return { assignedToMe, unassigned, blockedOrOverdue };
}
