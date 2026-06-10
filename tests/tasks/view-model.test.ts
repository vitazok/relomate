import { describe, it, expect } from 'vitest';
import { deriveSystemTasks } from '@/lib/tasks/generate';
import { selectTopTasks } from '@/lib/tasks/view-model';
import type { TaskRow } from '@/lib/tasks/repository';

const NOW = new Date('2026-06-10T12:00:00.000Z');

function makeTaskRow(overrides: Partial<TaskRow>): TaskRow {
  return {
    id: 'task-1',
    caseId: 'case-1',
    organizationId: 'org-1',
    title: 'A task',
    source: 'system',
    generationKey: null,
    status: 'open',
    requiredRole: null,
    assigneeUserId: null,
    dueAt: null,
    blocking: false,
    visibility: 'internal',
    subjectType: null,
    subjectId: null,
    createdBy: null,
    completedAt: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('deriveSystemTasks (pure generator)', () => {
  it('emits a review task per pending approval, widening role/visibility/due', () => {
    const tasks = deriveSystemTasks({
      documents: [],
      drafts: [],
      approvals: [
        {
          id: 'apr-1',
          subjectType: 'draft',
          status: 'pending',
          requiredRole: 'consultant',
          visibility: 'internal',
          dueAt: new Date('2026-06-15T00:00:00.000Z'),
        },
      ],
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      generationKey: 'approval:apr-1',
      requiredRole: 'consultant',
      visibility: 'internal',
      blocking: true,
      subjectType: 'draft',
      subjectId: 'apr-1',
    });
    expect(tasks[0]?.dueAt?.toISOString()).toBe('2026-06-15T00:00:00.000Z');
  });

  it('marks applicant confirmations non-blocking and client_visible', () => {
    const [task] = deriveSystemTasks({
      documents: [],
      drafts: [],
      approvals: [
        {
          id: 'apr-2',
          subjectType: 'document',
          status: 'pending',
          requiredRole: 'applicant',
          visibility: 'client_visible',
          dueAt: null,
        },
      ],
    });
    expect(task).toMatchObject({ blocking: false, requiredRole: 'applicant', visibility: 'client_visible' });
  });

  it('ignores resolved approvals (only pending generate tasks)', () => {
    const tasks = deriveSystemTasks({
      documents: [],
      drafts: [],
      approvals: [
        { id: 'apr-3', subjectType: 'draft', status: 'approved', requiredRole: 'consultant', visibility: 'internal', dueAt: null },
      ],
    });
    expect(tasks).toHaveLength(0);
  });

  it('emits re-upload tasks for failed documents and regenerate tasks for failed drafts', () => {
    const tasks = deriveSystemTasks({
      documents: [
        { id: 'doc-1', fileName: 'passport.pdf', status: 'failed' },
        { id: 'doc-2', fileName: 'ok.pdf', status: 'confirmed' },
      ],
      drafts: [
        { id: 'draft-1', type: 'cover_letter', status: 'failed' },
        { id: 'draft-2', type: 'cv', status: 'approved' },
      ],
      approvals: [],
    });
    const keys = tasks.map((t) => t.generationKey).sort();
    expect(keys).toEqual(['document:doc-1:reupload', 'draft:draft-1:regenerate']);
    const reupload = tasks.find((t) => t.generationKey === 'document:doc-1:reupload');
    expect(reupload).toMatchObject({ requiredRole: 'applicant', blocking: true, visibility: 'client_visible' });
  });

  it('is deterministic — same input yields identical keys (idempotent reconcile precondition)', () => {
    const input = {
      documents: [{ id: 'doc-1', fileName: 'a.pdf', status: 'failed' as const }],
      drafts: [],
      approvals: [],
    };
    expect(deriveSystemTasks(input).map((t) => t.generationKey)).toEqual(
      deriveSystemTasks(input).map((t) => t.generationKey),
    );
  });
});

describe('selectTopTasks (pure view model)', () => {
  it('hides internal tasks from client audience, shows client_visible/shared', () => {
    const rows = [
      makeTaskRow({ id: 'internal', visibility: 'internal' }),
      makeTaskRow({ id: 'client', visibility: 'client_visible' }),
      makeTaskRow({ id: 'shared', visibility: 'shared' }),
    ];
    const client = selectTopTasks(rows, { audience: 'client', now: NOW }).map((t) => t.id);
    expect(client.sort()).toEqual(['client', 'shared']);
    const firm = selectTopTasks(rows, { audience: 'firm', now: NOW }).map((t) => t.id);
    expect(firm.sort()).toEqual(['client', 'internal', 'shared']);
  });

  it('drops terminal tasks', () => {
    const rows = [
      makeTaskRow({ id: 'open', status: 'open' }),
      makeTaskRow({ id: 'done', status: 'done' }),
      makeTaskRow({ id: 'cancelled', status: 'cancelled' }),
    ];
    expect(selectTopTasks(rows, { audience: 'firm', now: NOW }).map((t) => t.id)).toEqual(['open']);
  });

  it('orders blocking first, then overdue, then earliest due date', () => {
    const rows = [
      makeTaskRow({ id: 'due-later', dueAt: new Date('2026-06-20T00:00:00.000Z') }),
      makeTaskRow({ id: 'overdue', dueAt: new Date('2026-06-05T00:00:00.000Z') }),
      makeTaskRow({ id: 'blocking', blocking: true, dueAt: new Date('2026-07-01T00:00:00.000Z') }),
      makeTaskRow({ id: 'due-soon', dueAt: new Date('2026-06-12T00:00:00.000Z') }),
    ];
    const order = selectTopTasks(rows, { audience: 'firm', now: NOW }).map((t) => t.id);
    expect(order).toEqual(['blocking', 'overdue', 'due-soon', 'due-later']);
  });

  it('flags overdue relative to the parameterized now', () => {
    const row = makeTaskRow({ dueAt: new Date('2026-06-05T00:00:00.000Z') });
    expect(selectTopTasks([row], { audience: 'firm', now: NOW })[0]?.overdue).toBe(true);
    const early = new Date('2026-06-01T00:00:00.000Z');
    expect(selectTopTasks([row], { audience: 'firm', now: early })[0]?.overdue).toBe(false);
  });

  it('respects limit and assignee filter', () => {
    const rows = [
      makeTaskRow({ id: 'mine', assigneeUserId: 'u1', blocking: true }),
      makeTaskRow({ id: 'theirs', assigneeUserId: 'u2' }),
    ];
    const mine = selectTopTasks(rows, { audience: 'firm', now: NOW, assigneeUserId: 'u1' });
    expect(mine.map((t) => t.id)).toEqual(['mine']);
    const capped = selectTopTasks(rows, { audience: 'firm', now: NOW, limit: 1 });
    expect(capped).toHaveLength(1);
  });
});
