import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedOrgAndUser, type SeededIds } from '../_db/seed';
import { makeRepository } from '@/lib/case/repository';

describe('case repository: createCase + loadCase', () => {
  let handle: TestDbHandle;
  let seeded: SeededIds;

  beforeAll(async () => {
    handle = await createTestSchema();
    seeded = await seedOrgAndUser(handle);
  }, 30_000);

  afterAll(async () => {
    await handle.cleanup();
  });

  it('createCase inserts cases + empty case_facts row', async () => {
    const repo = makeRepository(handle.db, handle.schemaName);
    const { caseId } = await repo.createCase({
      userId: seeded.userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
      targetConsulate: 'bengaluru',
    });
    expect(caseId).toMatch(/^[0-9a-f-]{36}$/);

    const cases = await handle.db.execute(
      sql.raw(`SELECT id, status, visa_type, target_country FROM "${handle.schemaName}".cases WHERE id = '${caseId}'`),
    );
    expect(cases.rows.length).toBe(1);
    expect((cases.rows[0] as { status: string }).status).toBe('draft');

    const facts = await handle.db.execute(
      sql.raw(`SELECT case_id, data FROM "${handle.schemaName}".case_facts WHERE case_id = '${caseId}'`),
    );
    expect(facts.rows.length).toBe(1);
    expect((facts.rows[0] as { data: unknown }).data).toEqual({});
  });

  it('loadCase returns parsed case + caseFacts (empty profile)', async () => {
    const repo = makeRepository(handle.db, handle.schemaName);
    const { caseId } = await repo.createCase({
      userId: seeded.userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
      targetConsulate: 'bengaluru',
    });
    const loaded = await repo.loadCase(caseId);
    expect(loaded.case.id).toBe(caseId);
    expect(loaded.caseFacts).toEqual({});
    expect(loaded.profile).toBeNull();
  });

  it('loadCase throws on unknown case id', async () => {
    const repo = makeRepository(handle.db, handle.schemaName);
    await expect(
      repo.loadCase('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(/not found/i);
  });
});
