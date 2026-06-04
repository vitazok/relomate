import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedAnonUser } from '../_db/seed-auth';
import { makeRepository } from '@/lib/case/repository';
import { makeDocumentRepository } from '@/lib/documents/repository';
import { makeFakeStorageAdapter } from '@/lib/storage/r2';
import { makeFakeExtractionProvider } from '@/lib/extraction';
import * as schema from '@/lib/db/schema';

let testHandle: TestDbHandle;
vi.mock('@/lib/db/client', () => ({
  get db() {
    return testHandle.db;
  },
}));

const step = { run: <T>(_id: string, fn: () => Promise<T>) => fn() };

async function seedDoc(caseId: string, userId: string, key: string) {
  const docs = makeDocumentRepository(testHandle.db);
  const id = await docs.insert({
    caseId, userId, r2Key: key, fileName: 'passport.pdf', contentType: 'application/pdf', byteSize: 3,
  });
  await docs.setStatus(id, 'uploaded');
  return id;
}

describe('extractDocument handler', () => {
  let caseId: string;
  let userId: string;

  beforeAll(async () => {
    testHandle = await createTestSchema();
    const seeded = await seedAnonUser(testHandle);
    userId = seeded.userId;
    const repo = makeRepository(testHandle.db, testHandle.schemaName);
    caseId = (await repo.createCase({ userId, visaType: 'blue_card', targetCountry: 'DE' })).caseId;
  }, 30_000);

  afterAll(async () => {
    if (testHandle) await testHandle.cleanup();
  });

  it('classify → extract → store, lands awaiting_confirmation with fields', async () => {
    const { extractDocumentHandler } = await import('@/lib/inngest/functions/extract-document');
    const storage = makeFakeStorageAdapter();
    const key = `cases/${caseId}/documents/d/passport.pdf`;
    await storage.__putForTest(key, new Uint8Array([1, 2, 3]), 'application/pdf');
    const documentId = await seedDoc(caseId, userId, key);

    const provider = makeFakeExtractionProvider({
      classifyResult: { spineItemId: 'passport', confidence: 0.92 },
      extractResult: {
        fields: { surname: { value: 'Sharma', confidence: 0.95 }, passportNumber: { value: 'X1', confidence: 0.9 } },
        provider: 'anthropic_vision',
        modelVersion: 'm',
      },
    });

    await extractDocumentHandler({
      event: { name: 'document.uploaded', data: { documentId, caseId, userId } },
      step,
      deps: { storage, provider },
    });

    const docs = makeDocumentRepository(testHandle.db);
    const row = await docs.getById(documentId);
    expect(row?.status).toBe('awaiting_confirmation');
    expect(row?.spineItemId).toBe('passport');
    expect((row?.extracted as { fields: Record<string, unknown> }).fields.surname).toBeDefined();
  });

  it('writes an activity_log row with field KEYS only — no PII values', async () => {
    const { extractDocumentHandler } = await import('@/lib/inngest/functions/extract-document');
    const storage = makeFakeStorageAdapter();
    const key = `cases/${caseId}/documents/d2/passport.pdf`;
    await storage.__putForTest(key, new Uint8Array([1]), 'application/pdf');
    const documentId = await seedDoc(caseId, userId, key);
    const provider = makeFakeExtractionProvider({
      classifyResult: { spineItemId: 'passport', confidence: 0.9 },
      extractResult: {
        fields: { passportNumber: { value: 'SECRET123', confidence: 0.99 } },
        provider: 'anthropic_vision',
        modelVersion: 'm',
      },
    });

    await extractDocumentHandler({
      event: { name: 'document.uploaded', data: { documentId, caseId, userId } },
      step,
      deps: { storage, provider },
    });

    const rows = await testHandle.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.kind, 'case.document.extracted'));
    const serialized = JSON.stringify(rows.map((r) => r.payload));
    expect(serialized).toContain('passportNumber'); // the KEY is logged
    expect(serialized).not.toContain('SECRET123'); // the VALUE is NOT
  });

  it('failure path: provider throws → status=failed + error + failed activity row', async () => {
    const { extractDocumentHandler } = await import('@/lib/inngest/functions/extract-document');
    const storage = makeFakeStorageAdapter();
    const key = `cases/${caseId}/documents/d3/passport.pdf`;
    await storage.__putForTest(key, new Uint8Array([1]), 'application/pdf');
    const documentId = await seedDoc(caseId, userId, key);
    const provider = makeFakeExtractionProvider({
      classifyResult: { spineItemId: 'passport', confidence: 0.9 },
      throwOnExtract: true,
    });

    await extractDocumentHandler({
      event: { name: 'document.uploaded', data: { documentId, caseId, userId } },
      step,
      deps: { storage, provider },
    });

    const docs = makeDocumentRepository(testHandle.db);
    const row = await docs.getById(documentId);
    expect(row?.status).toBe('failed');
    expect(row?.error).toBeTruthy();

    const failedRows = await testHandle.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.kind, 'case.document.extraction_failed'));
    const serialized = JSON.stringify(failedRows.map((r) => r.payload));
    expect(serialized).toContain(documentId);
  });

  it('does NOT write case_facts in any branch', async () => {
    const before = await testHandle.db
      .select()
      .from(schema.caseFacts)
      .where(eq(schema.caseFacts.caseId, caseId));
    // The previous tests ran the handler several times; case_facts must remain {} (empty).
    expect(before[0]?.data).toEqual({});
  });

  it('idempotent: re-delivery of a row already past uploaded is a no-op', async () => {
    const { extractDocumentHandler } = await import('@/lib/inngest/functions/extract-document');
    const docs = makeDocumentRepository(testHandle.db);
    const storage = makeFakeStorageAdapter();
    const key = `cases/${caseId}/documents/d4/passport.pdf`;
    await storage.__putForTest(key, new Uint8Array([1]), 'application/pdf');
    const documentId = await seedDoc(caseId, userId, key);
    await docs.setStatus(documentId, 'awaiting_confirmation'); // already processed

    const provider = makeFakeExtractionProvider({ throwOnClassify: true });
    // Should NOT throw — handler returns early before touching the provider.
    await extractDocumentHandler({
      event: { name: 'document.uploaded', data: { documentId, caseId, userId } },
      step,
      deps: { storage, provider },
    });
    const row = await docs.getById(documentId);
    expect(row?.status).toBe('awaiting_confirmation');
  });
});
