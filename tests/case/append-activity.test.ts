import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedAnonUser } from '../_db/seed-auth';
import { makeRepository } from '@/lib/case/repository';
import * as schema from '@/lib/db/schema';

describe('repository.appendActivity', () => {
  let handle: TestDbHandle;
  let userId: string;
  let caseId: string;

  beforeAll(async () => {
    handle = await createTestSchema();
    const seeded = await seedAnonUser(handle);
    userId = seeded.userId;
    const repo = makeRepository(handle.db, handle.schemaName);
    const created = await repo.createCase({
      userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
      targetConsulate: 'bengaluru',
    });
    caseId = created.caseId;
  }, 30_000);

  afterAll(async () => { if (handle) await handle.cleanup(); });

  it('inserts an activity_log row with the given kind and payload', async () => {
    const repo = makeRepository(handle.db, handle.schemaName);
    await repo.appendActivity({
      caseId,
      userId,
      kind: 'case.note.added',
      payload: { note: 'user is anxious about timeline', sourceTurnId: null },
    });

    const rows = await handle.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.caseId, caseId));
    const note = rows.find((r) => r.kind === 'case.note.added');
    expect(note).toBeDefined();
    expect((note!.payload as { note: string }).note).toBe('user is anxious about timeline');
  });
});
