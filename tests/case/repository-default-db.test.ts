import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedOrgAndUser, type SeededIds } from '../_db/seed';

let testHandle: TestDbHandle;
vi.mock('@/lib/db/client', () => ({
  get db() {
    return testHandle.db;
  },
}));

describe('makeRepository() with no db argument falls back to the default client export', () => {
  let seeded: SeededIds;

  beforeAll(async () => {
    testHandle = await createTestSchema();
    seeded = await seedOrgAndUser(testHandle);
  }, 30_000);

  afterAll(async () => {
    await testHandle.cleanup();
  });

  it('createCase + loadCase work without an injected db', async () => {
    const { makeRepository } = await import('@/lib/case/repository');
    const repo = makeRepository();
    const { caseId } = await repo.createCase({
      userId: seeded.userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
      targetConsulate: 'bengaluru',
    });
    const loaded = await repo.loadCase(caseId);
    expect(loaded.case.id).toBe(caseId);
    expect(loaded.case.userId).toBe(seeded.userId);
  });
});
