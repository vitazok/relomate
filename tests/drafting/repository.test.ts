import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedAnonUser } from '../_db/seed-auth';
import { makeRepository } from '@/lib/case/repository';
import { makeDraftRepository } from '@/lib/drafting/repository';

let handle: TestDbHandle;

const content = {
  type: 'cover_letter' as const,
  data: {
    title: 'Cover letter',
    recipient: 'German Consulate Bengaluru',
    subject: 'EU Blue Card application',
    paragraphs: ['One', 'Two', 'Three'],
    signoff: 'Sincerely',
  },
};

describe('draft repository', () => {
  let caseId: string;
  let userId: string;

  beforeAll(async () => {
    handle = await createTestSchema();
    userId = (await seedAnonUser(handle)).userId;
    caseId = (await makeRepository(handle.db, handle.schemaName)
      .createCase({ userId, visaType: 'blue_card', targetCountry: 'DE' })).caseId;
  }, 30_000);

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  it('inserts a drafting row and lists it by case', async () => {
    const drafts = makeDraftRepository(handle.db);
    const id = await drafts.insert({ caseId, userId, type: 'cover_letter' });
    const row = await drafts.getById(id);
    expect(row?.status).toBe('drafting');
    expect(row?.type).toBe('cover_letter');

    const listed = await drafts.listByCase(caseId);
    expect(listed.some((d) => d.id === id)).toBe(true);
  });

  it('increments version per case and draft type', async () => {
    const drafts = makeDraftRepository(handle.db);
    const first = await drafts.insert({ caseId, userId, type: 'employer_letter' });
    const second = await drafts.insert({ caseId, userId, type: 'employer_letter' });
    const cv = await drafts.insert({ caseId, userId, type: 'cv' });

    expect((await drafts.getById(first))?.version).toBe(1);
    expect((await drafts.getById(second))?.version).toBe(2);
    expect((await drafts.getById(cv))?.version).toBe(1);
  });

  it('moves through ready_for_review, approved, rejected, and failed states', async () => {
    const drafts = makeDraftRepository(handle.db);
    const readyId = await drafts.insert({ caseId, userId, type: 'cover_letter' });
    await drafts.setReady(readyId, {
      content,
      modelVersion: 'm',
      promptVersion: 'p',
    });
    expect((await drafts.getById(readyId))?.status).toBe('ready_for_review');

    await drafts.approve(readyId, { content, approvedBy: userId });
    expect((await drafts.getById(readyId))?.status).toBe('approved');

    const rejectedId = await drafts.insert({ caseId, userId, type: 'cover_letter' });
    await drafts.reject(rejectedId);
    expect((await drafts.getById(rejectedId))?.status).toBe('rejected');

    const failedId = await drafts.insert({ caseId, userId, type: 'cover_letter' });
    await drafts.setFailed(failedId, 'nope');
    const failed = await drafts.getById(failedId);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('nope');
  });
});
