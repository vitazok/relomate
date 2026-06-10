import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedOrgAndUser } from '../_db/seed';
import { makeRepository } from '@/lib/case/repository';
import { makeDocumentRepository } from '@/lib/documents/repository';
import { makeApprovalRepository } from '@/lib/approvals/repository';
import { makeTaskRepository } from '@/lib/tasks/repository';
import { reconcileCaseTasks } from '@/lib/tasks/service';

describe('reconcileCaseTasks (integration seam)', () => {
  let handle: TestDbHandle;

  beforeAll(async () => {
    handle = await createTestSchema();
  }, 30_000);

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  async function createCase() {
    const seeded = await seedOrgAndUser(handle);
    const { caseId } = await makeRepository(handle.db, handle.schemaName).createCase({
      userId: seeded.userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
    });
    return { ...seeded, caseId };
  }

  it('derives tasks from failed documents and pending approvals, idempotently', async () => {
    const seeded = await createCase();
    const docs = makeDocumentRepository(handle.db);
    const docId = await docs.insert({
      caseId: seeded.caseId,
      userId: seeded.userId,
      r2Key: 'k/1',
      fileName: 'passport.pdf',
      contentType: 'application/pdf',
      byteSize: 10,
    });
    await docs.setFailed(docId, 'unreadable');

    const approvalId = await makeApprovalRepository(handle.db).createPending({
      caseId: seeded.caseId,
      userId: seeded.userId,
      subjectType: 'document',
      subjectId: docId,
      requiredRole: 'consultant',
      visibility: 'internal',
    });

    const first = await reconcileCaseTasks(seeded.caseId, seeded.organizationId, handle.db);
    expect(first.created).toBe(2);

    const second = await reconcileCaseTasks(seeded.caseId, seeded.organizationId, handle.db);
    expect(second).toEqual({ created: 0, updated: 0, resolved: 0 });

    const tasks = await makeTaskRepository(handle.db).listByCase(seeded.caseId);
    const keys = tasks.map((t) => t.generationKey).sort();
    expect(keys).toEqual([`approval:${approvalId}`, `document:${docId}:reupload`]);
  });
});
