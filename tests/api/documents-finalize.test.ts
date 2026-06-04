import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedAnonUser } from '../_db/seed-auth';
import { makeRepository } from '@/lib/case/repository';
import { makeDocumentRepository } from '@/lib/documents/repository';

let testHandle: TestDbHandle;
let currentUserId: string | null = null;
const sendEvent = vi.fn().mockResolvedValue(undefined);
const fakeHead = { ok: true as boolean };

vi.mock('@/lib/db/client', () => ({ get db() { return testHandle.db; } }));
vi.mock('@/lib/auth/session', () => ({ getCurrentUserId: () => Promise.resolve(currentUserId) }));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: (...a: unknown[]) => sendEvent(...a) } }));
vi.mock('@/lib/storage/r2', async (orig) => {
  const actual = (await orig()) as typeof import('@/lib/storage/r2');
  return {
    ...actual,
    makeR2StorageAdapter: () => ({
      ...actual.makeFakeStorageAdapter(),
      headObject: async () => (fakeHead.ok ? { size: 3, contentType: 'application/pdf' } : null),
    }),
  };
});

async function seedPending(caseId: string, userId: string) {
  const docs = makeDocumentRepository(testHandle.db);
  return docs.insert({ caseId, userId, r2Key: 'k', fileName: 'p.pdf', contentType: 'application/pdf', byteSize: 3 });
}

describe('POST /api/documents/[id]/finalize', () => {
  let caseId: string;
  let userId: string;

  beforeAll(async () => {
    testHandle = await createTestSchema();
    userId = (await seedAnonUser(testHandle)).userId;
    const repo = makeRepository(testHandle.db, testHandle.schemaName);
    caseId = (await repo.createCase({ userId, visaType: 'blue_card', targetCountry: 'DE' })).caseId;
  }, 30_000);

  afterAll(async () => { if (testHandle) await testHandle.cleanup(); });
  beforeEach(() => { currentUserId = userId; sendEvent.mockClear(); fakeHead.ok = true; });

  async function finalize(id: string) {
    const { POST } = await import('@/app/api/documents/[id]/finalize/route');
    return POST(new Request(`http://x/api/documents/${id}/finalize`, { method: 'POST' }), {
      params: Promise.resolve({ id }),
    });
  }

  it('emits document.uploaded and flips to uploaded', async () => {
    const id = await seedPending(caseId, userId);
    const res = await finalize(id);
    expect(res.status).toBe(200);
    expect(sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'document.uploaded', data: expect.objectContaining({ documentId: id, caseId, userId }) }),
    );
    const row = await makeDocumentRepository(testHandle.db).getById(id);
    expect(row?.status).toBe('uploaded');
  });

  it('4xx + no event when the object never landed in R2', async () => {
    fakeHead.ok = false;
    const id = await seedPending(caseId, userId);
    const res = await finalize(id);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it('403 for another user', async () => {
    const other = await seedAnonUser(testHandle);
    const otherRepo = makeRepository(testHandle.db, testHandle.schemaName);
    const otherCase = (await otherRepo.createCase({ userId: other.userId, visaType: 'blue_card', targetCountry: 'DE' })).caseId;
    const id = await seedPending(otherCase, other.userId);
    const res = await finalize(id); // current user is `userId`, not `other`
    expect(res.status).toBe(403);
  });

  it('idempotent re-finalize: ok without re-emitting', async () => {
    const id = await seedPending(caseId, userId);
    await finalize(id);            // first call → uploaded + 1 emit
    sendEvent.mockClear();
    const res = await finalize(id); // status now 'uploaded' → short-circuit
    expect(res.status).toBe(200);
    expect(sendEvent).not.toHaveBeenCalled();
  });
});
