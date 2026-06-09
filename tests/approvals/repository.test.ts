import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedAnonUser } from '../_db/seed-auth';
import { makeRepository } from '@/lib/case/repository';
import { makeApprovalRepository } from '@/lib/approvals/repository';

let testHandle: TestDbHandle;
vi.mock('@/lib/db/client', () => ({ get db() { return testHandle.db; } }));

describe('approval repository', () => {
  let organizationId: string;
  let caseId: string;
  let userId: string;

  beforeAll(async () => {
    testHandle = await createTestSchema();
    const seeded = await seedAnonUser(testHandle);
    organizationId = seeded.organizationId;
    userId = seeded.userId;
    const repo = makeRepository(testHandle.db, testHandle.schemaName);
    caseId = (await repo.createCase({ userId, visaType: 'blue_card', targetCountry: 'DE' })).caseId;
  }, 30_000);

  afterAll(async () => { if (testHandle) await testHandle.cleanup(); });

  it('createPending inserts a pending row and is idempotent per subject', async () => {
    const approvals = makeApprovalRepository(testHandle.db);
    const subjectId = crypto.randomUUID();
    const id1 = await approvals.createPending({ caseId, userId, subjectType: 'document', subjectId });
    const id2 = await approvals.createPending({ caseId, userId, subjectType: 'document', subjectId });
    expect(id2).toBe(id1); // idempotent — returns the existing open approval

    const row = await approvals.getBySubject('document', subjectId);
    expect(row?.status).toBe('pending');
    expect(row?.caseId).toBe(caseId);
    expect(row?.requiredRole).toBe('applicant');
    expect(row?.assigneeUserId).toBe(userId);
    expect(row?.visibility).toBe('client_visible');
  });

  it('listPending returns only pending approvals for the case', async () => {
    const approvals = makeApprovalRepository(testHandle.db);
    const s = crypto.randomUUID();
    await approvals.createPending({ caseId, userId, subjectType: 'document', subjectId: s });
    const pending = await approvals.listPending(caseId);
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending.every((p) => p.status === 'pending' && p.caseId === caseId)).toBe(true);
  });

  it('listReviewInbox returns pending firm-review approvals for an organization', async () => {
    const approvals = makeApprovalRepository(testHandle.db);
    const subjectId = crypto.randomUUID();
    await approvals.createPending({
      caseId,
      userId,
      assigneeUserId: null,
      subjectType: 'draft',
      subjectId,
    });

    const inbox = await approvals.listReviewInbox({ organizationId, requiredRole: 'consultant' });
    const row = inbox.find((approval) => approval.subjectId === subjectId);
    expect(row?.requiredRole).toBe('consultant');
    expect(row?.assigneeUserId).toBeNull();
    expect(row?.visibility).toBe('internal');
  });

  it('resolve flips pending → approved with a PII-safe decision', async () => {
    const approvals = makeApprovalRepository(testHandle.db);
    const subjectId = crypto.randomUUID();
    const id = await approvals.createPending({ caseId, userId, subjectType: 'document', subjectId });
    await approvals.resolve(id, {
      status: 'approved',
      decision: { confirmedPaths: ['passportNumber'], editedPaths: ['nationality'], rejectedReason: null },
      resolvedBy: userId,
    });
    const row = await approvals.getById(id);
    expect(row?.status).toBe('approved');
    expect(row?.resolvedBy).toBe(userId);
    expect(row?.decision).toEqual({
      confirmedPaths: ['passportNumber'],
      editedPaths: ['nationality'],
      rejectedReason: null,
    });
    // After resolve, the subject has no open approval (partial unique freed).
    expect(await approvals.getBySubject('document', subjectId)).toBeNull();
  });
});
