import { z } from 'zod';

// Non-terminal statuses keep a system task "live" — the partial unique index in the schema
// dedupes open system tasks by (caseId, generationKey). Terminal statuses release the key so a
// re-emerging trigger (e.g. a re-uploaded document) can spawn a fresh task.
export const TaskStatusEnum = z.enum(['open', 'in_progress', 'blocked', 'done', 'cancelled']);
export type TaskStatus = z.infer<typeof TaskStatusEnum>;

export const TERMINAL_TASK_STATUSES = ['done', 'cancelled'] as const satisfies readonly TaskStatus[];

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return (TERMINAL_TASK_STATUSES as readonly TaskStatus[]).includes(status);
}

// `system` tasks are derived from case state by the generator and reconciled on each read.
// `manual` tasks are created by firm members and are never touched by reconciliation.
export const TaskSourceEnum = z.enum(['system', 'manual']);
export type TaskSource = z.infer<typeof TaskSourceEnum>;

// Who is expected to act. Null = no specific role expectation (anyone with case access).
export const TaskRequiredRoleEnum = z.enum([
  'applicant',
  'employer_contact',
  'consultant',
  'reviewer',
  'ops_manager',
]);
export type TaskRequiredRole = z.infer<typeof TaskRequiredRoleEnum>;

// What the task is about. Null = standalone task with no linked artifact.
export const TaskSubjectTypeEnum = z.enum(['document', 'draft', 'approval']);
export type TaskSubjectType = z.infer<typeof TaskSubjectTypeEnum>;

// Append-only audit kinds for task_changes (rule 10: no UPDATE on *_changes tables).
export const TaskChangeKindEnum = z.enum([
  'created',
  'status_changed',
  'reassigned',
  'updated',
]);
export type TaskChangeKind = z.infer<typeof TaskChangeKindEnum>;
