import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedAnonUser } from '../_db/seed-auth';
import { makeRepository } from '@/lib/case/repository';
import { makeDocumentRepository } from '@/lib/documents/repository';

let testHandle: TestDbHandle;
let currentUserId: string | null = null;
vi.mock('@/lib/db/client', () => ({ get db() { return testHandle.db; } }));
vi.mock('@/lib/auth/session', () => ({ getCurrentUserId: () => Promise.resolve(currentUserId) }));

describe('GET /api/documents/[id]', () => {
  let caseId: string;
  let userId: string;
  let docId: string;

  beforeAll(async () => {
    testHandle = await createTestSchema();
    userId = (await seedAnonUser(testHandle)).userId;
    const repo = makeRepository(testHandle.db, testHandle.schemaName);
    caseId = (await repo.createCase({ userId, visaType: 'blue_card', targetCountry: 'DE' })).caseId;
    docId = await makeDocumentRepository(testHandle.db).insert({
      caseId, userId, r2Key: 'k', fileName: 'p.pdf', contentType: 'application/pdf', byteSize: 3,
    });
  }, 30_000);

  afterAll(async () => { if (testHandle) await testHandle.cleanup(); });
  beforeEach(() => { currentUserId = userId; });

  async function get(id: string) {
    const { GET } = await import('@/app/api/documents/[id]/route');
    return GET(new Request(`http://x/api/documents/${id}`), { params: Promise.resolve({ id }) });
  }

  it('returns the render-safe projection', async () => {
    const res = await get(docId);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ id: docId, status: 'pending_upload', fileName: 'p.pdf' });
    expect(json.r2Key).toBeUndefined(); // not leaked to the client
  });

  it('403 for another user', async () => {
    const other = await seedAnonUser(testHandle);
    currentUserId = other.userId;
    const res = await get(docId);
    expect(res.status).toBe(403);
  });

  it('strips raw/provider/modelVersion from a populated extraction', async () => {
    const docs = makeDocumentRepository(testHandle.db);
    const freshId = await docs.insert({
      caseId, userId, r2Key: 'k2', fileName: 'passport.pdf', contentType: 'application/pdf', byteSize: 3,
    });
    await docs.setExtraction(freshId, {
      spineItemId: 'passport',
      detectedType: 'passport',
      classification: { type: 'passport', confidence: 0.9 },
      extracted: {
        fields: { passportNumber: { value: 'X1234567', confidence: 0.95 } },
        provider: 'reducto',
        modelVersion: 'v1',
        raw: { unmaskedPassport: 'X1234567', secret: 'blob' },
      },
    });
    const res = await get(freshId);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.extracted).toEqual({ fields: { passportNumber: { value: 'X1234567', confidence: 0.95 } } });
    expect(json.extracted.raw).toBeUndefined();
    expect(json.extracted.provider).toBeUndefined();
    expect(json.extracted.modelVersion).toBeUndefined();
    expect(json.detectedType).toBe('passport');
    expect(json.classification).toMatchObject({ type: 'passport', confidence: 0.9 });
    // Defense-in-depth: the raw blob's contents must not appear anywhere in the serialized response.
    expect(JSON.stringify(json)).not.toContain('"secret"');
  });

  it('404 for a nonexistent document', async () => {
    const res = await get(crypto.randomUUID());
    expect(res.status).toBe(404);
  });
});
