import type { Visibility } from '@/lib/case/visibility';
import { isTerminalTaskStatus, type TaskRequiredRole, type TaskStatus } from '@/lib/tasks/types';
import type { TaskRow } from '@/lib/tasks/repository';

// What a viewer is allowed to see. Applicants/employer contacts see only client-facing tasks;
// firm members see everything. Mirrors the visibility split used across the approval inbox.
export type TaskAudience = 'firm' | 'client';

export interface TopTask {
  id: string;
  title: string;
  status: TaskStatus;
  requiredRole: TaskRequiredRole | null;
  assigneeUserId: string | null;
  dueAt: string | null;
  blocking: boolean;
  overdue: boolean;
  subjectType: TaskRow['subjectType'];
  subjectId: string | null;
}

export interface SelectTopTasksOptions {
  audience: TaskAudience;
  now: Date;
  limit?: number;
  // When set, restrict to tasks assigned to this user (a consultant's "my tasks" view).
  assigneeUserId?: string;
}

const CLIENT_VISIBLE: ReadonlySet<Visibility> = new Set<Visibility>(['client_visible', 'shared']);

function audienceCanSee(visibility: Visibility, audience: TaskAudience): boolean {
  return audience === 'firm' ? true : CLIENT_VISIBLE.has(visibility);
}

function isOverdue(task: TaskRow, now: Date): boolean {
  return task.dueAt != null && task.dueAt.getTime() < now.getTime();
}

// Urgency ordering: blocking first, then overdue, then earliest due date (nulls last),
// then oldest created. Pure and total so the sort is deterministic.
function compareUrgency(a: TaskRow, b: TaskRow, now: Date): number {
  if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
  const aOver = isOverdue(a, now);
  const bOver = isOverdue(b, now);
  if (aOver !== bOver) return aOver ? -1 : 1;
  const aDue = a.dueAt?.getTime() ?? Infinity;
  const bDue = b.dueAt?.getTime() ?? Infinity;
  if (aDue !== bDue) return aDue - bDue;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

/**
 * Pure view model: project task rows into the ranked "top tasks" list for a viewer.
 * Drops terminal (done/cancelled) tasks and anything the audience may not see, then ranks
 * by urgency. `now` is parameterized so tests pin overdue evaluation.
 */
export function selectTopTasks(tasks: TaskRow[], options: SelectTopTasksOptions): TopTask[] {
  const { audience, now, limit, assigneeUserId } = options;
  const visible = tasks
    .filter((t) => !isTerminalTaskStatus(t.status))
    .filter((t) => audienceCanSee(t.visibility, audience))
    .filter((t) => (assigneeUserId ? t.assigneeUserId === assigneeUserId : true));

  visible.sort((a, b) => compareUrgency(a, b, now));

  const ranked = limit != null ? visible.slice(0, limit) : visible;
  return ranked.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    requiredRole: t.requiredRole,
    assigneeUserId: t.assigneeUserId,
    dueAt: t.dueAt?.toISOString() ?? null,
    blocking: t.blocking,
    overdue: isOverdue(t, now),
    subjectType: t.subjectType,
    subjectId: t.subjectId,
  }));
}
