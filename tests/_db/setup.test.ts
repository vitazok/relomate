import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestSchema, type TestDbHandle } from './setup';
import { seedOrgAndUser } from './seed';

describe('test schema lifecycle', () => {
  let handle: TestDbHandle;

  beforeAll(async () => {
    handle = await createTestSchema();
  }, 30_000);

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  it('creates the schema with all tables', async () => {
    const result = await handle.db.execute(
      sql.raw(`SELECT tablename FROM pg_tables WHERE schemaname = '${handle.schemaName}'`),
    );
    const names = (result.rows as { tablename: string }[]).map((r) => r.tablename).sort();
    expect(names).toContain('cases');
    expect(names).toContain('case_facts');
    expect(names).toContain('users');
    expect(names).toContain('activity_log');
  });

  it('seedOrgAndUser inserts and returns ids', async () => {
    const { organizationId, userId } = await seedOrgAndUser(handle);
    expect(organizationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);
    const users = await handle.db.execute(
      sql.raw(`SELECT id FROM "${handle.schemaName}".users WHERE id = '${userId}'`),
    );
    expect(users.rows.length).toBe(1);
  });

  it('inserts go to the test schema (not public)', async () => {
    const { organizationId } = await seedOrgAndUser(handle);
    // Verify the row is in the test schema, NOT public.
    const inTest = await handle.db.execute(
      sql.raw(
        `SELECT count(*)::int AS n FROM "${handle.schemaName}".organizations WHERE id = '${organizationId}'`,
      ),
    );
    expect((inTest.rows[0] as { n: number }).n).toBe(1);
    // And NOT in public.
    const inPublic = await handle.db.execute(
      sql.raw(`SELECT count(*)::int AS n FROM "public".organizations WHERE id = '${organizationId}'`),
    );
    expect((inPublic.rows[0] as { n: number }).n).toBe(0);
  });
});
