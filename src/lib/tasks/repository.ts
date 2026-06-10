import { and, eq, inArray } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import { db as defaultDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { isVisibility, type Visibility } from '@/lib/case/visibility';
import {
  isTerminalTaskStatus,
  type TaskRequiredRole,
  type TaskSource,
  type TaskStatus,
  type TaskSubjectType,
} from '@/lib/tasks/types';

type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface TaskRow {
  id: string;
  caseId: string;
  organizationId: string;
  title: string;
  source: TaskSource;
  generationKey: string | null;
  status: TaskStatus;
  requiredRole: TaskRequiredRole | null;
  assigneeUserId: string | null;
  dueAt: Date | null;
  blocking: boolean;
  visibility: Visibility;
  subjectType: TaskSubjectType | null;
  subjectId: string | null;
  createdBy: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTaskInput {
  caseId: string;
  organizationId: string;
  title: string;
  source?: TaskSource;
  generationKey?: string | null;
  status?: TaskStatus;
  requiredRole?: TaskRequiredRole | null;
  assigneeUserId?: string | null;
  dueAt?: Date | null;
  blocking?: boolean;
  visibility?: Visibility;
  subjectType?: TaskSubjectType | null;
  subjectId?: string | null;
  createdBy?: string | null;
}

export interface UpdateTaskInput {
  status?: TaskStatus;
  assigneeUserId?: string | null;
  dueAt?: Date | null;
  blocking?: boolean;
  title?: string;
  // Identifies the actor for the append-only task_changes audit row. Null = system.
  actorUserId?: string | null;
}

/** Desired open system task, as emitted by the pure generator (`deriveSystemTasks`). */
export interface DesiredSystemTask {
  generationKey: string;
  title: string;
  requiredRole?: TaskRequiredRole | null;
  dueAt?: Date | null;
  blocking?: boolean;
  visibility?: Visibility;
  subjectType?: TaskSubjectType | null;
  subjectId?: string | null;
}

export interface ReconcileResult {
  created: number;
  updated: number;
  resolved: number;
}

export interface TaskRepository {
  create(input: CreateTaskInput): Promise<string>;
  getById(id: string): Promise<TaskRow | null>;
  listByCase(caseId: string): Promise<TaskRow[]>;
  update(id: string, input: UpdateTaskInput): Promise<void>;
  reconcileSystemTasks(
    caseId: string,
    organizationId: string,
    desired: DesiredSystemTask[],
  ): Promise<ReconcileResult>;
}

function toRow(r: typeof schema.tasks.$inferSelect): TaskRow {
  if (!isVisibility(r.visibility)) throw new Error(`unknown task visibility: ${r.visibility}`);
  return {
    id: r.id,
    caseId: r.caseId,
    organizationId: r.organizationId,
    title: r.title,
    source: r.source,
    generationKey: r.generationKey,
    status: r.status,
    requiredRole: r.requiredRole,
    assigneeUserId: r.assigneeUserId ?? null,
    dueAt: r.dueAt ?? null,
    blocking: r.blocking,
    visibility: r.visibility,
    subjectType: r.subjectType,
    subjectId: r.subjectId ?? null,
    createdBy: r.createdBy ?? null,
    completedAt: r.completedAt ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// PII-safe audit payloads: structural change metadata only (ids/enums), never case data.
function changedFields(input: UpdateTaskInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.status !== undefined) payload.status = input.status;
  if (input.assigneeUserId !== undefined) payload.assigneeUserId = input.assigneeUserId;
  if (input.dueAt !== undefined) payload.dueAt = input.dueAt?.toISOString() ?? null;
  if (input.blocking !== undefined) payload.blocking = input.blocking;
  if (input.title !== undefined) payload.titleChanged = true;
  return payload;
}

export function makeTaskRepository(db?: Db, _schemaName: string | null = null): TaskRepository {
  const dbInstance = db ?? defaultDb;
  return {
    async create(input) {
      return await dbInstance.transaction(async (tx) => {
        const status = input.status ?? 'open';
        const [row] = await tx
          .insert(schema.tasks)
          .values({
            caseId: input.caseId,
            organizationId: input.organizationId,
            title: input.title,
            source: input.source ?? 'manual',
            generationKey: input.generationKey ?? null,
            status,
            requiredRole: input.requiredRole ?? null,
            assigneeUserId: input.assigneeUserId ?? null,
            dueAt: input.dueAt ?? null,
            blocking: input.blocking ?? false,
            visibility: input.visibility ?? 'internal',
            subjectType: input.subjectType ?? null,
            subjectId: input.subjectId ?? null,
            createdBy: input.createdBy ?? null,
            completedAt: isTerminalTaskStatus(status) ? new Date() : null,
          })
          .returning({ id: schema.tasks.id });
        if (!row) throw new Error('create task: no row returned');
        await tx.insert(schema.taskChanges).values({
          taskId: row.id,
          kind: 'created',
          actorUserId: input.createdBy ?? null,
          payload: { source: input.source ?? 'manual', status },
        });
        return row.id;
      });
    },

    async getById(id) {
      const rows = await dbInstance.select().from(schema.tasks).where(eq(schema.tasks.id, id));
      return rows[0] ? toRow(rows[0]) : null;
    },

    async listByCase(caseId) {
      const rows = await dbInstance
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.caseId, caseId));
      return rows.map(toRow);
    },

    async update(id, input) {
      await dbInstance.transaction(async (tx) => {
        const [existing] = await tx
          .select({ status: schema.tasks.status, assigneeUserId: schema.tasks.assigneeUserId })
          .from(schema.tasks)
          .where(eq(schema.tasks.id, id))
          .for('update');
        if (!existing) throw new Error(`update task: not found: ${id}`);

        const set: Partial<typeof schema.tasks.$inferInsert> = { updatedAt: new Date() };
        if (input.status !== undefined) {
          set.status = input.status;
          set.completedAt = isTerminalTaskStatus(input.status) ? new Date() : null;
        }
        if (input.assigneeUserId !== undefined) set.assigneeUserId = input.assigneeUserId;
        if (input.dueAt !== undefined) set.dueAt = input.dueAt;
        if (input.blocking !== undefined) set.blocking = input.blocking;
        if (input.title !== undefined) set.title = input.title;

        await tx.update(schema.tasks).set(set).where(eq(schema.tasks.id, id));

        const kind =
          input.status !== undefined && input.status !== existing.status
            ? 'status_changed'
            : input.assigneeUserId !== undefined && input.assigneeUserId !== existing.assigneeUserId
              ? 'reassigned'
              : 'updated';
        await tx.insert(schema.taskChanges).values({
          taskId: id,
          kind,
          actorUserId: input.actorUserId ?? null,
          payload: changedFields(input),
        });
      });
    },

    async reconcileSystemTasks(caseId, organizationId, desired) {
      return await dbInstance.transaction(async (tx) => {
        const openRows = await tx
          .select()
          .from(schema.tasks)
          .where(
            and(
              eq(schema.tasks.caseId, caseId),
              eq(schema.tasks.source, 'system'),
              inArray(schema.tasks.status, ['open', 'in_progress', 'blocked']),
            ),
          );
        const openByKey = new Map(
          openRows.filter((r) => r.generationKey != null).map((r) => [r.generationKey!, r]),
        );
        const desiredKeys = new Set(desired.map((d) => d.generationKey));

        let created = 0;
        let updated = 0;
        let resolved = 0;

        for (const d of desired) {
          const existing = openByKey.get(d.generationKey);
          const fields = {
            title: d.title,
            requiredRole: d.requiredRole ?? null,
            dueAt: d.dueAt ?? null,
            blocking: d.blocking ?? false,
            visibility: d.visibility ?? 'internal',
            subjectType: d.subjectType ?? null,
            subjectId: d.subjectId ?? null,
          };
          if (!existing) {
            const [row] = await tx
              .insert(schema.tasks)
              .values({
                caseId,
                organizationId,
                source: 'system',
                generationKey: d.generationKey,
                status: 'open',
                ...fields,
              })
              .returning({ id: schema.tasks.id });
            if (!row) throw new Error('reconcile: insert returned no row');
            await tx.insert(schema.taskChanges).values({
              taskId: row.id,
              kind: 'created',
              actorUserId: null,
              payload: { source: 'system', generationKey: d.generationKey },
            });
            created += 1;
            continue;
          }
          // Only rewrite when a tracked field actually drifted, so reconcile is a no-op on a
          // steady state and doesn't churn updatedAt / audit rows on every read.
          const drift =
            existing.title !== fields.title ||
            existing.requiredRole !== fields.requiredRole ||
            (existing.dueAt?.getTime() ?? null) !== (fields.dueAt?.getTime() ?? null) ||
            existing.blocking !== fields.blocking ||
            existing.visibility !== fields.visibility ||
            existing.subjectType !== fields.subjectType ||
            existing.subjectId !== fields.subjectId;
          if (drift) {
            await tx
              .update(schema.tasks)
              .set({ ...fields, updatedAt: new Date() })
              .where(eq(schema.tasks.id, existing.id));
            await tx.insert(schema.taskChanges).values({
              taskId: existing.id,
              kind: 'updated',
              actorUserId: null,
              payload: { reason: 'system_reconcile' },
            });
            updated += 1;
          }
        }

        // Auto-resolve open system tasks whose trigger cleared (key no longer desired).
        for (const row of openRows) {
          if (row.generationKey == null || desiredKeys.has(row.generationKey)) continue;
          await tx
            .update(schema.tasks)
            .set({ status: 'done', completedAt: new Date(), updatedAt: new Date() })
            .where(eq(schema.tasks.id, row.id));
          await tx.insert(schema.taskChanges).values({
            taskId: row.id,
            kind: 'status_changed',
            actorUserId: null,
            payload: { status: 'done', reason: 'system_reconcile' },
          });
          resolved += 1;
        }

        return { created, updated, resolved };
      });
    },
  };
}
