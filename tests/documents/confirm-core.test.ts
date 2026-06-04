import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedAnonUser } from '../_db/seed-auth';
import { makeRepository } from '@/lib/case/repository';
import { makeDocumentRepository } from '@/lib/documents/repository';
import { makeApprovalRepository } from '@/lib/approvals/repository';
import { confirmExtractionCore, rejectExtractionCore } from '@/lib/documents/confirm-core';

let testHandle: TestDbHandle;
vi.mock('@/lib/db/client', () => ({ get db() { return testHandle.db; } }));

async function seedAwaitingDoc(caseId: string, userId: string) {
  const docs = makeDocumentRepository(testHandle.db);
  const id = await docs.insert({
    caseId, userId, r2Key: 'k', fileName: 'passport.pdf', contentType: 'application/pdf', byteSize: 3,
  });
  await docs.setStatus(id, 'uploaded');
  await docs.setExtraction(id, {
    spineItemId: 'passport',
    detectedType: 'passport',
    classification: { type: 'passport', confidence: 0.9 },
    extracted: {
      fields: {
        surname: { value: 'Sharma', confidence: 0.95 },
        givenNames: { value: 'Priya', confidence: 0.95 },
        passportNumber: { value: 'X1234567', confidence: 0.92 },
        dateOfBirth: { value: '1990-04-12', confidence: 0.9 },
        nationality: { value: 'India', confidence: 0.6 },
        dateOfExpiry: { value: '2030-09-01', confidence: 0.9 },
      },
      provider: 'anthropic_vision',
      modelVersion: 'm',
    },
  });
  await makeApprovalRepository(testHandle.db).createPending({
    caseId, userId, subjectType: 'document', subjectId: id,
  });
  return id;
}

describe('confirmExtractionCore', () => {
  let caseId: string;
  let userId: string;

  beforeAll(async () => {
    testHandle = await createTestSchema();
    userId = (await seedAnonUser(testHandle)).userId;
    const repo = makeRepository(testHandle.db, testHandle.schemaName);
    caseId = (await repo.createCase({ userId, visaType: 'blue_card', targetCountry: 'DE' })).caseId;
  }, 30_000);

  afterAll(async () => { if (testHandle) await testHandle.cleanup(); });

  function deps() {
    return {
      repo: makeRepository(testHandle.db, testHandle.schemaName),
      docs: makeDocumentRepository(testHandle.db),
      approvals: makeApprovalRepository(testHandle.db),
    };
  }

  it('writes confirmed fields to the profile at confidence 1.0 with per-field source', async () => {
    const documentId = await seedAwaitingDoc(caseId, userId);
    const res = await confirmExtractionCore(deps(), {
      documentId, caseId, userId,
      fields: [
        { key: 'surname', value: 'Sharma', edited: false },
        { key: 'givenNames', value: 'Priya', edited: false },
        { key: 'passportNumber', value: 'X1234567', edited: false },
        { key: 'dateOfBirth', value: '1990-04-12', edited: false },
        { key: 'nationality', value: 'India', edited: true },
        { key: 'dateOfExpiry', value: '2030-09-01', edited: false },
      ],
    });
    expect(res.ok).toBe(true);

    const loaded = await deps().repo.loadCase(caseId);
    const p = loaded.profile!;
    expect(p.fullName?.value).toBe('Priya Sharma');
    expect(p.fullName?.confidence).toBe(1);
    expect(p.fullName?.source).toBe('document');
    expect(p.passportNumber?.value).toBe('X1234567');
    expect(p.nationality?.value).toBe('IN');
    expect(p.nationality?.source).toBe('user_corrected');

    const doc = await deps().docs.getById(documentId);
    expect(doc?.status).toBe('confirmed');
    // No pending approval remains for this doc.
    const stillPending = (await deps().approvals.listPending(caseId)).find((a) => a.subjectId === documentId);
    expect(stillPending).toBeUndefined();
  });

  it('is a no-op when the document is not awaiting_confirmation (double-confirm guard)', async () => {
    const documentId = await seedAwaitingDoc(caseId, userId);
    await confirmExtractionCore(deps(), { documentId, caseId, userId, fields: [
      { key: 'passportNumber', value: 'A1', edited: false },
    ] });
    const second = await confirmExtractionCore(deps(), { documentId, caseId, userId, fields: [
      { key: 'passportNumber', value: 'A2', edited: false },
    ] });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe('wrong_status');
    const loaded = await deps().repo.loadCase(caseId);
    expect(loaded.profile?.passportNumber?.value).toBe('A1');
  });

  it('forbids confirming another user\'s document', async () => {
    const documentId = await seedAwaitingDoc(caseId, userId);
    const other = await seedAnonUser(testHandle);
    const res = await confirmExtractionCore(deps(), {
      documentId, caseId, userId: other.userId, fields: [{ key: 'passportNumber', value: 'X', edited: false }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('forbidden');
  });

  it('rejectExtractionCore resolves rejected, sets doc rejected, writes no case state', async () => {
    const documentId = await seedAwaitingDoc(caseId, userId);
    const before = await deps().repo.loadCase(caseId);
    const res = await rejectExtractionCore(deps(), { documentId, caseId, userId, reason: 'wrong doc' });
    expect(res.ok).toBe(true);
    const doc = await deps().docs.getById(documentId);
    expect(doc?.status).toBe('rejected');
    const after = await deps().repo.loadCase(caseId);
    expect(after.profile).toEqual(before.profile);
  });
});
