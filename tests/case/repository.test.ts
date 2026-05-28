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

  it('createCase inserts a single thread row alongside cases + case_facts', async () => {
    const repo = makeRepository(handle.db, handle.schemaName);
    const { caseId, threadId } = await repo.createCase({
      userId: seeded.userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
      targetConsulate: 'bengaluru',
    });
    expect(threadId).toMatch(/^[0-9a-f-]{36}$/);

    const threads = await handle.db.execute(
      sql.raw(`SELECT id, case_id FROM "${handle.schemaName}".threads WHERE case_id = '${caseId}'`),
    );
    expect(threads.rows.length).toBe(1);
    expect((threads.rows[0] as { id: string }).id).toBe(threadId);
  });

  it('loadCase returns the threadId of the case thread', async () => {
    const repo = makeRepository(handle.db, handle.schemaName);
    const { caseId, threadId } = await repo.createCase({
      userId: seeded.userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
      targetConsulate: 'bengaluru',
    });
    const loaded = await repo.loadCase(caseId);
    expect(loaded.threadId).toBe(threadId);
  });
});

describe('case repository: applyUpdate', () => {
  let handle: TestDbHandle;
  let seeded: SeededIds;

  beforeAll(async () => {
    handle = await createTestSchema();
    seeded = await seedOrgAndUser(handle);
  }, 30_000);

  afterAll(async () => {
    await handle.cleanup();
  });

  async function freshCase() {
    const repo = makeRepository(handle.db, handle.schemaName);
    const { caseId } = await repo.createCase({
      userId: seeded.userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
      targetConsulate: 'bengaluru',
    });
    return { repo, caseId };
  }

  it('writes a single case-facts path with full provenance', async () => {
    const { repo, caseId } = await freshCase();
    const turnId = '00000000-0000-4000-8000-000000000001';
    const result = await repo.applyUpdate({
      caseId,
      source: 'user_stated',
      sourceTurnId: turnId,
      confidence: 0.9,
      updates: { 'employment.annualGrossSalaryEur': 48500 },
    });
    expect(result.updatedPaths).toEqual(['employment.annualGrossSalaryEur']);
    expect(result.contradictions).toEqual([]);

    const loaded = await repo.loadCase(caseId);
    expect(loaded.caseFacts.employment?.annualGrossSalaryEur).toMatchObject({
      value: 48500,
      source: 'user_stated',
      sourceTurnId: turnId,
      confidence: 0.9,
    });
    expect(loaded.caseFacts.employment?.annualGrossSalaryEur?.updatedAt).toMatch(/^\d{4}-/);

    const changes = await handle.db.execute(
      sql.raw(`SELECT field_path, new_value, source, confidence FROM "${handle.schemaName}".case_changes WHERE case_id = '${caseId}'`),
    );
    expect(changes.rows.length).toBe(1);
    const change = changes.rows[0] as { field_path: string; source: string; confidence: string };
    expect(change.field_path).toBe('employment.annualGrossSalaryEur');
    expect(change.source).toBe('user_stated');
    expect(Number(change.confidence)).toBeCloseTo(0.9, 2);

    const activity = await handle.db.execute(
      sql.raw(`SELECT kind, payload FROM "${handle.schemaName}".activity_log WHERE case_id = '${caseId}'`),
    );
    expect(activity.rows.length).toBe(1);
    const entry = activity.rows[0] as { kind: string; payload: { paths: string[] } };
    expect(entry.kind).toBe('case.facts.updated');
    expect(entry.payload.paths).toEqual(['employment.annualGrossSalaryEur']);
  });

  it('writes three paths in one call: 1 activity row, 3 change rows', async () => {
    const { repo, caseId } = await freshCase();
    const result = await repo.applyUpdate({
      caseId,
      source: 'user_stated',
      sourceTurnId: '00000000-0000-4000-8000-000000000002',
      confidence: 0.85,
      updates: {
        'employment.annualGrossSalaryEur': 48500,
        'employment.employerName': 'Acme GmbH',
        'education.anabinStatus': 'H+',
      },
    });
    expect(result.updatedPaths.sort()).toEqual([
      'education.anabinStatus',
      'employment.annualGrossSalaryEur',
      'employment.employerName',
    ]);

    const changes = await handle.db.execute(
      sql.raw(`SELECT count(*)::int AS n FROM "${handle.schemaName}".case_changes WHERE case_id = '${caseId}'`),
    );
    expect((changes.rows[0] as { n: number }).n).toBe(3);

    const activity = await handle.db.execute(
      sql.raw(`SELECT count(*)::int AS n FROM "${handle.schemaName}".activity_log WHERE case_id = '${caseId}'`),
    );
    expect((activity.rows[0] as { n: number }).n).toBe(1);
  });

  it('loadCase round-trips provenance after applyUpdate', async () => {
    const { repo, caseId } = await freshCase();
    await repo.applyUpdate({
      caseId,
      source: 'user_stated',
      sourceTurnId: '00000000-0000-4000-8000-000000000003',
      confidence: 0.7,
      updates: { 'employment.employerName': 'Acme GmbH' },
    });
    const loaded = await repo.loadCase(caseId);
    expect(loaded.caseFacts.employment?.employerName?.value).toBe('Acme GmbH');
    expect(loaded.caseFacts.employment?.employerName?.confidence).toBe(0.7);
  });

  it('writes a profile-level path to profiles + profile_changes (not case_facts)', async () => {
    const { repo, caseId } = await freshCase();
    await repo.applyUpdate({
      caseId,
      source: 'user_stated',
      sourceTurnId: '00000000-0000-4000-8000-000000000004',
      confidence: 0.9,
      updates: { nationality: 'IN' },
    });

    const profileRows = await handle.db.execute(
      sql.raw(`SELECT data FROM "${handle.schemaName}".profiles WHERE user_id = '${seeded.userId}'`),
    );
    const profile = profileRows.rows[0] as
      | { data: { nationality?: { value: string } } }
      | undefined;
    expect(profile?.data?.nationality?.value).toBe('IN');

    const profileChanges = await handle.db.execute(
      sql.raw(`SELECT count(*)::int AS n FROM "${handle.schemaName}".profile_changes WHERE user_id = '${seeded.userId}'`),
    );
    expect((profileChanges.rows[0] as { n: number }).n).toBe(1);

    const caseChanges = await handle.db.execute(
      sql.raw(`SELECT count(*)::int AS n FROM "${handle.schemaName}".case_changes WHERE case_id = '${caseId}'`),
    );
    expect((caseChanges.rows[0] as { n: number }).n).toBe(0);
  });

  it('reports a contradiction when the same path is written twice with different values', async () => {
    const { repo, caseId } = await freshCase();
    await repo.applyUpdate({
      caseId,
      source: 'user_stated',
      sourceTurnId: '00000000-0000-4000-8000-000000000005',
      confidence: 0.9,
      updates: { 'employment.annualGrossSalaryEur': 48500 },
    });
    const second = await repo.applyUpdate({
      caseId,
      source: 'user_corrected',
      sourceTurnId: '00000000-0000-4000-8000-000000000006',
      confidence: 0.9,
      updates: { 'employment.annualGrossSalaryEur': 55000 },
    });
    expect(second.contradictions.length).toBe(1);
    const c = second.contradictions[0]!;
    expect(c.path).toBe('employment.annualGrossSalaryEur');
    expect(c.previousValue).toBe(48500);
    expect(c.newValue).toBe(55000);

    const loaded = await repo.loadCase(caseId);
    expect(loaded.caseFacts.employment?.annualGrossSalaryEur?.value).toBe(55000);
  });

  it('does not report a contradiction when the value is unchanged', async () => {
    const { repo, caseId } = await freshCase();
    await repo.applyUpdate({
      caseId,
      source: 'user_stated',
      sourceTurnId: '00000000-0000-4000-8000-000000000007',
      confidence: 0.9,
      updates: { 'employment.annualGrossSalaryEur': 48500 },
    });
    const second = await repo.applyUpdate({
      caseId,
      source: 'user_stated',
      sourceTurnId: '00000000-0000-4000-8000-000000000008',
      confidence: 0.9,
      updates: { 'employment.annualGrossSalaryEur': 48500 },
    });
    expect(second.contradictions).toEqual([]);
  });

  it('rejects an unknown path and writes nothing', async () => {
    const { repo, caseId } = await freshCase();
    await expect(
      repo.applyUpdate({
        caseId,
        source: 'user_stated',
        sourceTurnId: '00000000-0000-4000-8000-000000000009',
        confidence: 0.9,
        updates: { 'employment.nonsense': 'x' },
      }),
    ).rejects.toThrow(/unknown path/i);

    const changes = await handle.db.execute(
      sql.raw(`SELECT count(*)::int AS n FROM "${handle.schemaName}".case_changes WHERE case_id = '${caseId}'`),
    );
    expect((changes.rows[0] as { n: number }).n).toBe(0);
  });

  it('rejects an invalid leaf value and writes nothing', async () => {
    const { repo, caseId } = await freshCase();
    await expect(
      repo.applyUpdate({
        caseId,
        source: 'user_stated',
        sourceTurnId: '00000000-0000-4000-8000-00000000000a',
        confidence: 0.9,
        updates: { 'employment.annualGrossSalaryEur': 'forty thousand' },
      }),
    ).rejects.toThrow();

    const changes = await handle.db.execute(
      sql.raw(`SELECT count(*)::int AS n FROM "${handle.schemaName}".case_changes WHERE case_id = '${caseId}'`),
    );
    expect((changes.rows[0] as { n: number }).n).toBe(0);
  });

  it('serialises concurrent writes to the same case (row lock)', async () => {
    const { repo, caseId } = await freshCase();
    const a = repo.applyUpdate({
      caseId,
      source: 'user_stated',
      sourceTurnId: '00000000-0000-4000-8000-00000000000b',
      confidence: 0.9,
      updates: { 'employment.annualGrossSalaryEur': 48500 },
    });
    const b = repo.applyUpdate({
      caseId,
      source: 'user_stated',
      sourceTurnId: '00000000-0000-4000-8000-00000000000c',
      confidence: 0.9,
      updates: { 'employment.employerName': 'Acme' },
    });
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.updatedPaths.length).toBe(1);
    expect(rb.updatedPaths.length).toBe(1);

    const changes = await handle.db.execute(
      sql.raw(`SELECT count(*)::int AS n FROM "${handle.schemaName}".case_changes WHERE case_id = '${caseId}'`),
    );
    expect((changes.rows[0] as { n: number }).n).toBe(2);

    const loaded = await repo.loadCase(caseId);
    expect(loaded.caseFacts.employment?.annualGrossSalaryEur?.value).toBe(48500);
    expect(loaded.caseFacts.employment?.employerName?.value).toBe('Acme');
  });
});
