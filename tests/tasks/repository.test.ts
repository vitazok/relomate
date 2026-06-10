import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedOrgAndUser } from '../_db/seed';
import { makeRepository } from '@/lib/case/repository';
import { makeTaskRepository, type DesiredSystemTask } from '@/lib/tasks/repository';
import * as schema from '@/lib/db/schema';

describe('tasks repository', () => {
  let handle: TestDbHandle;

  beforeAll(async () => {
    handle = await createTestSchema();
  }, 30_000);

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  async function createCase() {
    const seeded = await seedOrgAndUser(handle);
    const repo = makeRepository(handle.db, handle.schemaName);
    const { caseId } = await repo.createCase({
      userId: seeded.userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
    });
    return { ...seeded, caseId };
  }

  async function countChanges(taskId: string): Promise<number> {
    const rows = await handle.db
      .select()
      .from(schema.taskChanges)
      .where(eq(schema.taskChanges.taskId, taskId));
    return rows.length;
  }

  it('creates a manual task with a created audit row', async () => {
    const seeded = await createCase();
    const tasks = makeTaskRepository(handle.db, handle.schemaName);
    const id = await tasks.create({
      caseId: seeded.caseId,
      organizationId: seeded.organizationId,
      title: 'Call applicant',
      assigneeUserId: seeded.userId,
      blocking: true,
    });

    const row = await tasks.getById(id);
    expect(row).toMatchObject({
      title: 'Call applicant',
      source: 'manual',
      status: 'open',
      blocking: true,
      assigneeUserId: seeded.userId,
    });
    expect(await countChanges(id)).toBe(1);
  });

  it('records status transitions as append-only audit rows and stamps completedAt', async () => {
    const seeded = await createCase();
    const tasks = makeTaskRepository(handle.db, handle.schemaName);
    const id = await tasks.create({
      caseId: seeded.caseId,
      organizationId: seeded.organizationId,
      title: 'Do the thing',
    });

    await tasks.update(id, { status: 'in_progress', actorUserId: seeded.userId });
    await tasks.update(id, { status: 'done', actorUserId: seeded.userId });

    const row = await tasks.getById(id);
    expect(row?.status).toBe('done');
    expect(row?.completedAt).not.toBeNull();
    // created + 2 status changes
    expect(await countChanges(id)).toBe(3);
  });

  it('reconcile is idempotent — repeated reads with the same state never duplicate', async () => {
    const seeded = await createCase();
    const tasks = makeTaskRepository(handle.db, handle.schemaName);
    const desired: DesiredSystemTask[] = [
      { generationKey: 'document:doc-1:reupload', title: 'Re-upload passport', requiredRole: 'applicant', blocking: true, visibility: 'client_visible' },
      { generationKey: 'approval:apr-1', title: 'Review draft', requiredRole: 'consultant', blocking: true, visibility: 'internal' },
    ];

    const first = await tasks.reconcileSystemTasks(seeded.caseId, seeded.organizationId, desired);
    expect(first.created).toBe(2);

    const second = await tasks.reconcileSystemTasks(seeded.caseId, seeded.organizationId, desired);
    expect(second).toEqual({ created: 0, updated: 0, resolved: 0 });

    const all = await tasks.listByCase(seeded.caseId);
    expect(all.filter((t) => t.source === 'system')).toHaveLength(2);
  });

  it('reconcile updates a drifted field and auto-resolves cleared triggers', async () => {
    const seeded = await createCase();
    const tasks = makeTaskRepository(handle.db, handle.schemaName);
    await tasks.reconcileSystemTasks(seeded.caseId, seeded.organizationId, [
      { generationKey: 'approval:apr-1', title: 'Review draft', requiredRole: 'consultant', blocking: true, visibility: 'internal' },
      { generationKey: 'document:doc-1:reupload', title: 'Re-upload passport', requiredRole: 'applicant', blocking: true, visibility: 'client_visible' },
    ]);

    // apr-1 due date appears; doc-1 trigger clears (e.g. re-uploaded).
    const result = await tasks.reconcileSystemTasks(seeded.caseId, seeded.organizationId, [
      { generationKey: 'approval:apr-1', title: 'Review draft', requiredRole: 'consultant', blocking: true, visibility: 'internal', dueAt: new Date('2026-06-20T00:00:00.000Z') },
    ]);
    expect(result.updated).toBe(1);
    expect(result.resolved).toBe(1);

    const all = await tasks.listByCase(seeded.caseId);
    const approval = all.find((t) => t.generationKey === 'approval:apr-1');
    const doc = all.find((t) => t.generationKey === 'document:doc-1:reupload');
    expect(approval?.dueAt?.toISOString()).toBe('2026-06-20T00:00:00.000Z');
    expect(approval?.status).toBe('open');
    expect(doc?.status).toBe('done');
    expect(doc?.completedAt).not.toBeNull();
  });

  it('re-emits a fresh task after a resolved one when the trigger returns', async () => {
    const seeded = await createCase();
    const tasks = makeTaskRepository(handle.db, handle.schemaName);
    const key = 'document:doc-1:reupload';
    const desired: DesiredSystemTask[] = [
      { generationKey: key, title: 'Re-upload passport', requiredRole: 'applicant', blocking: true, visibility: 'client_visible' },
    ];

    await tasks.reconcileSystemTasks(seeded.caseId, seeded.organizationId, desired);
    await tasks.reconcileSystemTasks(seeded.caseId, seeded.organizationId, []); // trigger clears → resolved
    const reborn = await tasks.reconcileSystemTasks(seeded.caseId, seeded.organizationId, desired);
    expect(reborn.created).toBe(1); // partial unique index allows a new open row once the old is terminal

    const open = (await tasks.listByCase(seeded.caseId)).filter(
      (t) => t.generationKey === key && t.status === 'open',
    );
    expect(open).toHaveLength(1);
  });
});
