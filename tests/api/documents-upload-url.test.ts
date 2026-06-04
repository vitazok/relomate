import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedAnonUser } from '../_db/seed-auth';
import { makeRepository } from '@/lib/case/repository';
import { makeDocumentRepository } from '@/lib/documents/repository';

let testHandle: TestDbHandle;
let currentUserId: string | null = null;

vi.mock('@/lib/db/client', () => ({ get db() { return testHandle.db; } }));
vi.mock('@/lib/auth/session', () => ({ getCurrentUserId: () => Promise.resolve(currentUserId) }));
vi.mock('@/lib/storage/r2', async (orig) => {
  const actual = (await orig()) as typeof import('@/lib/storage/r2');
  return {
    ...actual,
    makeR2StorageAdapter: () => actual.makeFakeStorageAdapter(),
  };
});

describe('POST /api/documents/upload-url', () => {
  let caseId: string;
  let userId: string;

  beforeAll(async () => {
    testHandle = await createTestSchema();
    userId = (await seedAnonUser(testHandle)).userId;
    const repo = makeRepository(testHandle.db, testHandle.schemaName);
    caseId = (await repo.createCase({ userId, visaType: 'blue_card', targetCountry: 'DE' })).caseId;
  }, 30_000);

  afterAll(async () => { if (testHandle) await testHandle.cleanup(); });
  beforeEach(() => { currentUserId = userId; });

  async function post(body: unknown) {
    const { POST } = await import('@/app/api/documents/upload-url/route');
    return POST(new Request('http://x/api/documents/upload-url', {
      method: 'POST',
      body: JSON.stringify(body),
    }));
  }

  it('401 when unauthenticated', async () => {
    currentUserId = null;
    const res = await post({ caseId, fileName: 'p.pdf', contentType: 'application/pdf', byteSize: 10 });
    expect(res.status).toBe(401);
  });

  it('400 on disallowed content type', async () => {
    const res = await post({ caseId, fileName: 'p.exe', contentType: 'application/x-msdownload', byteSize: 10 });
    expect(res.status).toBe(400);
  });

  it('400 on oversize file', async () => {
    const res = await post({ caseId, fileName: 'p.pdf', contentType: 'application/pdf', byteSize: 999_999_999 });
    expect(res.status).toBe(400);
  });

  it('403 when the case belongs to another user', async () => {
    const other = await seedAnonUser(testHandle);
    const otherRepo = makeRepository(testHandle.db, testHandle.schemaName);
    const otherCase = (await otherRepo.createCase({ userId: other.userId, visaType: 'blue_card', targetCountry: 'DE' })).caseId;
    const res = await post({ caseId: otherCase, fileName: 'p.pdf', contentType: 'application/pdf', byteSize: 10 });
    expect(res.status).toBe(403);
  });

  it('200 inserts a pending_upload row and returns a presigned url', async () => {
    const res = await post({ caseId, fileName: 'My Passport.pdf', contentType: 'application/pdf', byteSize: 10 });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.documentId).toBeTruthy();
    expect(json.uploadUrl).toContain('http');
    const row = await makeDocumentRepository(testHandle.db).getById(json.documentId);
    expect(row?.status).toBe('pending_upload');
    expect(row?.caseId).toBe(caseId);
    expect(row?.r2Key).toContain(json.documentId);
  });

  it('404 when the case does not exist', async () => {
    const res = await post({ caseId: crypto.randomUUID(), fileName: 'p.pdf', contentType: 'application/pdf', byteSize: 10 });
    expect(res.status).toBe(404);
  });
});
