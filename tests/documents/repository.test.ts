import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedAnonUser } from '../_db/seed-auth';
import { makeRepository } from '@/lib/case/repository';
import { makeDocumentRepository } from '@/lib/documents/repository';

let testHandle: TestDbHandle;
vi.mock('@/lib/db/client', () => ({
  get db() {
    return testHandle.db;
  },
}));

describe('document repository', () => {
  let caseId: string;
  let userId: string;

  beforeAll(async () => {
    testHandle = await createTestSchema();
    const seeded = await seedAnonUser(testHandle);
    userId = seeded.userId;
    const repo = makeRepository(testHandle.db, testHandle.schemaName);
    const created = await repo.createCase({ userId, visaType: 'blue_card', targetCountry: 'DE' });
    caseId = created.caseId;
  }, 30_000);

  afterAll(async () => {
    if (testHandle) await testHandle.cleanup();
  });

  it('inserts a pending_upload row and reads it back', async () => {
    const docs = makeDocumentRepository(testHandle.db);
    const id = await docs.insert({
      caseId,
      userId,
      r2Key: `cases/${caseId}/documents/x/passport.pdf`,
      fileName: 'passport.pdf',
      contentType: 'application/pdf',
      byteSize: 1234,
    });
    const row = await docs.getById(id);
    expect(row?.status).toBe('pending_upload');
    expect(row?.caseId).toBe(caseId);
  });

  it('insertWithId honors a caller-minted id', async () => {
    const docs = makeDocumentRepository(testHandle.db);
    const minted = crypto.randomUUID();
    const returned = await docs.insertWithId(minted, {
      caseId,
      userId,
      r2Key: `cases/${caseId}/documents/${minted}/p.pdf`,
      fileName: 'p.pdf',
      contentType: 'application/pdf',
      byteSize: 10,
    });
    expect(returned).toBe(minted);
    expect((await docs.getById(minted))?.id).toBe(minted);
  });

  it('transitions status and persists extracted data', async () => {
    const docs = makeDocumentRepository(testHandle.db);
    const id = await docs.insert({
      caseId,
      userId,
      r2Key: 'k',
      fileName: 'f.pdf',
      contentType: 'application/pdf',
      byteSize: 1,
    });
    await docs.setStatus(id, 'uploaded');
    await docs.setExtraction(id, {
      spineItemId: 'passport',
      detectedType: 'passport',
      classification: { type: 'passport', confidence: 0.9 },
      extracted: { fields: { surname: { value: 'A', confidence: 0.9 } }, provider: 'anthropic_vision', modelVersion: 'm' },
    });
    const row = await docs.getById(id);
    expect(row?.status).toBe('awaiting_confirmation');
    expect(row?.spineItemId).toBe('passport');
    expect((row?.extracted as { fields: Record<string, unknown> }).fields.surname).toBeDefined();
  });

  it('lists documents by case (newest first)', async () => {
    const docs = makeDocumentRepository(testHandle.db);
    const before = await docs.listByCase(caseId);
    await docs.insert({
      caseId, userId, r2Key: 'older.pdf', fileName: 'older.pdf', contentType: 'application/pdf', byteSize: 1,
    });
    const newestId = await docs.insert({
      caseId, userId, r2Key: 'newest.pdf', fileName: 'newest.pdf', contentType: 'application/pdf', byteSize: 1,
    });
    const after = await docs.listByCase(caseId);
    expect(after.length).toBe(before.length + 2);
    expect(after.every((d) => d.caseId === caseId)).toBe(true);
    expect(after[0]!.id).toBe(newestId); // newest first
  });

  it('throws when updating a non-existent document', async () => {
    const docs = makeDocumentRepository(testHandle.db);
    const missing = crypto.randomUUID();
    await expect(docs.setFailed(missing, 'x')).rejects.toThrow(/not found/);
  });

  it('marks a row failed with a sanitized error', async () => {
    const docs = makeDocumentRepository(testHandle.db);
    const id = await docs.insert({
      caseId, userId, r2Key: 'k2', fileName: 'f2.pdf', contentType: 'application/pdf', byteSize: 1,
    });
    await docs.setFailed(id, 'extraction failed');
    const row = await docs.getById(id);
    expect(row?.status).toBe('failed');
    expect(row?.error).toBe('extraction failed');
  });
});
