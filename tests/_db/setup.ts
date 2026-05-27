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
async function applyMigrations(db: Db, _schemaName: string): Promise<void> {
  const migrationsDir = join(process.cwd(), 'drizzle');
  const { readdirSync } = await import('node:fs');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    let raw = readFileSync(join(migrationsDir, file), 'utf8');
    // Strip hardcoded "public"."<table>" references from foreign keys so they resolve within the test schema.
    raw = raw.replace(/"public"\./g, '');
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
  const baseUrl = loadDirectUrl();
  const schemaName = `test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  // Step 1: bootstrap connection — create the schema using base URL.
  const bootstrapPool = new Pool({ connectionString: baseUrl, max: 1 });
  await bootstrapPool.query(`CREATE SCHEMA "${schemaName}"`);
  await bootstrapPool.end();

  // Step 2: build the per-schema URL by appending `options=-c search_path=<schema>`.
  // pg parses URL `options` parameter and forwards it as a startup option to the server.
  const url = new URL(baseUrl);
  url.searchParams.set('options', `-c search_path=${schemaName}`);
  const pool = new Pool({ connectionString: url.toString(), max: 4 });
  const db = drizzle(pool, { schema });

  // Step 3: apply migrations — every connection from this pool already has the right search_path.
  await applyMigrations(db, schemaName);

  return {
    db,
    schemaName,
    cleanup: async () => {
      // Drop using a fresh bootstrap connection so the test pool can be cleanly closed first.
      await pool.end();
      const dropPool = new Pool({ connectionString: baseUrl, max: 1 });
      await dropPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await dropPool.end();
    },
  };
}
