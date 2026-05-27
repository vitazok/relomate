import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';

type Db = ReturnType<typeof drizzle<typeof schema>>;

let directUrl: string | null = null;

function loadDirectUrl(): string {
  if (directUrl) return directUrl;
  const envPath = join(process.cwd(), '.env.test.local');
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
      if (m && m[1] === 'DIRECT_URL') {
        directUrl = m[2] as string;
      }
    }
  }
  if (!directUrl) directUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? null;
  if (!directUrl) {
    throw new Error(
      'No DIRECT_URL/DATABASE_URL available. Create .env.test.local (see example) or set env vars.',
    );
  }
  return directUrl;
}

/** Reads the latest migration SQL and executes it against the given schema. */
async function applyMigrations(db: Db, schemaName: string): Promise<void> {
  const migrationsDir = join(process.cwd(), 'drizzle');
  const { readdirSync } = await import('node:fs');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    let raw = readFileSync(join(migrationsDir, file), 'utf8');
    // Strip hardcoded "public"."<table>" references from foreign keys so they resolve within the test schema.
    raw = raw.replace(/"public"\./g, '');
    // Drizzle migrations don't include schema prefixes; we run them inside `SET search_path = "${schemaName}"`.
    await db.execute(sql.raw(`SET search_path = "${schemaName}"`));
    // drizzle uses `--> statement-breakpoint` between statements; split on it.
    const statements = raw
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await db.execute(sql.raw(stmt));
    }
  }
}

export interface TestDbHandle {
  db: Db;
  schemaName: string;
  cleanup: () => Promise<void>;
}

/**
 * Create a throwaway Postgres schema, run all drizzle migrations into it,
 * return a Drizzle client whose search_path points at that schema, and a
 * cleanup function that drops the schema and closes the pool.
 *
 * Caller pattern (vitest):
 *
 *   let handle: TestDbHandle;
 *   beforeAll(async () => { handle = await createTestSchema(); });
 *   afterAll(async () => { await handle.cleanup(); });
 *   it('...', async () => { ... use handle.db ... });
 */
export async function createTestSchema(): Promise<TestDbHandle> {
  const url = loadDirectUrl();
  const pool = new Pool({ connectionString: url, max: 4 });
  const schemaName = `test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const db = drizzle(pool, { schema });
  await db.execute(sql.raw(`CREATE SCHEMA "${schemaName}"`));
  await db.execute(sql.raw(`SET search_path = "${schemaName}"`));
  await applyMigrations(db, schemaName);
  return {
    db,
    schemaName,
    cleanup: async () => {
      await db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
      await pool.end();
    },
  };
}
