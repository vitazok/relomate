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
    if (handle) await handle.cleanup();
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
      sql.raw(`SELECT id, user_id, organization_id, primary_applicant_user_id, status, visa_type, target_country, stage, priority FROM "${handle.schemaName}".cases WHERE id = '${caseId}'`),
    );
    expect(cases.rows.length).toBe(1);
    const inserted = cases.rows[0] as {
      user_id: string;
      organization_id: string;
      primary_applicant_user_id: string;
      status: string;
      stage: string;
      priority: string;
    };
    expect(inserted.user_id).toBe(seeded.userId);
    expect(inserted.organization_id).toBe(seeded.organizationId);
    expect(inserted.primary_applicant_user_id).toBe(seeded.userId);
    expect(inserted.status).toBe('draft');
    expect(inserted.stage).toBe('intake');
    expect(inserted.priority).toBe('normal');

    const facts = await handle.db.execute(
      sql.raw(`SELECT case_id, data FROM "${handle.schemaName}".case_facts WHERE case_id = '${caseId}'`),
    );
    expect(facts.rows.length).toBe(1);
    expect((facts.rows[0] as { data: unknown }).data).toEqual({});

    const participants = await handle.db.execute(
      sql.raw(`SELECT case_id, organization_id, user_id, role, invitation_status, visibility, relation FROM "${handle.schemaName}".case_participants WHERE case_id = '${caseId}'`),
    );
    expect(participants.rows.length).toBe(1);
    const participant = participants.rows[0] as {
      organization_id: string;
      user_id: string;
      role: string;
      invitation_status: string;
      visibility: string;
      relation: { kind?: string };
    };
    expect(participant.organization_id).toBe(seeded.organizationId);
    expect(participant.user_id).toBe(seeded.userId);
    expect(participant.role).toBe('applicant');
    expect(participant.invitation_status).toBe('active');
    expect(participant.visibility).toBe('shared');
    expect(participant.relation.kind).toBe('primary_applicant');
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
    expect(loaded.case.organizationId).toBe(seeded.organizationId);
    expect(loaded.case.primaryApplicantUserId).toBe(seeded.userId);
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
    if (handle) await handle.cleanup();
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

  it('does not report a contradiction when an object leaf is re-written with reordered keys (#8)', async () => {
    const { repo, caseId } = await freshCase();
    await repo.applyUpdate({
      caseId,
      source: 'user_stated',
      sourceTurnId: '00000000-0000-4000-8000-0000000000d1',
      confidence: 0.9,
      updates: {
        currentAddress: {
          line1: '27 MG Road',
          city: 'Pune',
          stateOrProvince: 'MH',
          country: 'IN',
          postalCode: '411001',
        },
      },
    });
    const second = await repo.applyUpdate({
      caseId,
      source: 'user_stated',
      sourceTurnId: '00000000-0000-4000-8000-0000000000d2',
      confidence: 0.9,
      updates: {
        // same address, keys in a DIFFERENT order
        currentAddress: {
          postalCode: '411001',
          country: 'IN',
          city: 'Pune',
          stateOrProvince: 'MH',
          line1: '27 MG Road',
        },
      },
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

  it('does not lose a profile update across concurrent writes to two cases of one user (#9)', async () => {
    // Two cases of the SAME user lock DIFFERENT case_facts rows, so the case_facts FOR UPDATE
    // does not serialize them. Both transactions write profile leaves. The buggy version
    // SELECT ... FOR UPDATE'd the profiles row that did not exist yet (locking nothing), so
    // both snapshot {schemaVersion:1} and the second upsert clobbers the first's profile write.
    // Repeat a few times — the interleaving is timing-dependent but reproduced 25/25 when buggy.
    for (let i = 0; i < 4; i++) {
      const repo = makeRepository(handle.db, handle.schemaName);
      const { caseId: caseA } = await repo.createCase({
        userId: seeded.userId,
        visaType: 'blue_card',
        targetCountry: 'DE',
        targetConsulate: 'bengaluru',
      });
      const { caseId: caseB } = await repo.createCase({
        userId: seeded.userId,
        visaType: 'blue_card',
        targetCountry: 'DE',
        targetConsulate: 'bengaluru',
      });
      await Promise.all([
        repo.applyUpdate({
          caseId: caseA,
          source: 'user_stated',
          sourceTurnId: '00000000-0000-4000-8000-0000000000e1',
          confidence: 0.9,
          updates: { nationality: 'IN' },
        }),
        repo.applyUpdate({
          caseId: caseB,
          source: 'user_stated',
          sourceTurnId: '00000000-0000-4000-8000-0000000000e2',
          confidence: 0.9,
          updates: { passportNumber: 'P1234567' },
        }),
      ]);

      const loaded = await repo.loadCase(caseA);
      expect(loaded.profile?.nationality?.value).toBe('IN');
      expect(loaded.profile?.passportNumber?.value).toBe('P1234567');
    }
  }, 30_000);

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
