import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedAnonUser } from '../_db/seed-auth';
import { makeRepository } from '@/lib/case/repository';
import * as schema from '@/lib/db/schema';

let testHandle: TestDbHandle;
vi.mock('@/lib/db/client', () => ({
  get db() {
    return testHandle.db;
  },
}));

describe('logCaseEvent handler', () => {
  let caseId: string;

  beforeAll(async () => {
    testHandle = await createTestSchema();
    const { userId } = await seedAnonUser(testHandle);
    const repo = makeRepository(testHandle.db, testHandle.schemaName);
    const created = await repo.createCase({
      userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
      targetConsulate: 'bengaluru',
    });
    caseId = created.caseId;
  }, 30_000);

  afterAll(async () => {
    if (testHandle) await testHandle.cleanup();
  });

  it('writes one inngest.echo activity_log row', async () => {
    const { logCaseEventHandler } = await import('@/lib/inngest/functions/log-case-event');
    const event = {
      name: 'case.facts.updated' as const,
      data: { caseId, paths: ['employment.annualGrossSalaryEur'], sourceTurnId: 't1' },
    };
    const step = {
      run: <T>(_id: string, fn: () => Promise<T>) => fn(),
    };
    await logCaseEventHandler({ event, step });

    const rows = await testHandle.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.kind, 'inngest.echo'));
    expect(rows).toHaveLength(1);
    expect((rows[0]?.payload as { paths: string[] }).paths).toEqual([
      'employment.annualGrossSalaryEur',
    ]);
    expect(rows[0]?.caseId).toBe(caseId);
  });
});
