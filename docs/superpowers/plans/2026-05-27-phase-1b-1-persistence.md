# Phase 1B-1 — Persistence & `update_case` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the case repository, dotted-path validator, and the `update_case` Vercel AI SDK tool adapter, with vitest integration tests against a real Supabase test schema. End state: `applyUpdate({caseId, source, confidence, sourceTurnId, updates: {'employment.annualGrossSalaryEur': 48500}})` writes to `case_facts.data` (provenance-wrapped), inserts a `case_changes` row, inserts an `activity_log` row, and detects path-local contradictions — all in one transaction. No auth, no UI, no AI SDK runtime.

**Architecture:** Three modules. `src/lib/case/paths.ts` is pure (path validation + immutable get/set). `src/lib/case/repository.ts` is the only DB-touching module — all reads `Schema.parse()` JSONB at the boundary; all writes go through `applyUpdate` which serialises per case via `SELECT … FOR UPDATE`. `src/lib/ai/tools/update_case.ts` is a thin Vercel AI SDK adapter over the repository — zero business logic. The user-message UUID becomes `sourceTurnId` (CLAUDE.md rule #9); 1B-1 has no messages yet, so tests synthesise UUIDs.

**Tech Stack:** Drizzle 0.45 + `pg` 8 + Postgres (Supabase EU), Zod 4, Vercel AI SDK v5 (`ai` package — added in this plan), Vitest 4 with real-Postgres integration via per-file test schemas.

---

## Pre-flight notes

Three things found while reviewing 1A's output:

1. **Schema bug to fix in Task 1:** `case_changes.confidence` and `profile_changes.confidence` were declared `integer` in `src/lib/db/schema.ts`, but the provenance wrapper stores `confidence: z.number().min(0).max(1)` — a float in `[0, 1]`. Switch the columns to `numeric` (or store the wrapper value × 100 as integer; we go with `numeric` for direct round-trip).
2. **No migrations exist yet:** `drizzle/` directory was never created. Task 1 generates the first migration (`drizzle/0000_*.sql`), runs it against the real Supabase project, and commits the SQL.
3. **`tsx` not installed:** the manual smoke at Task 12 needs it. Task 0 adds it.

---

## File structure

Files this plan creates or modifies (relative to `/Users/vitalii.kashin/Projects/visa/`):

**Schema fix + migration**
- Modify: `src/lib/db/schema.ts` — change `confidence: integer(...)` to `numeric(...)` on `case_changes` and `profile_changes`.
- Create: `drizzle/0000_*.sql` — generated migration.
- Create: `drizzle/meta/_journal.json`, `drizzle/meta/0000_snapshot.json` — drizzle-kit metadata.

**Path utilities (pure)**
- Create: `src/lib/case/paths.ts` — `validateLeafPath`, `validateLeafValue`, `setAtPath`, `getAtPath`, `flattenForChangeLog`.
- Create: `tests/case/paths.test.ts`.

**Repository (the workhorse)**
- Create: `src/lib/case/repository.ts` — `createCase`, `loadCase`, `applyUpdate`.
- Create: `src/lib/case/types.ts` — shared types (`UpdateCaseInput`, `UpdateCaseResult`, `ContradictionReport`).

**Test infra (reused in 1B-2 and 1B-3)**
- Create: `tests/_db/setup.ts` — `withTestSchema(fn)` lifecycle helper.
- Create: `tests/_db/seed.ts` — minimal `seedOrgAndUser()` for tests that need a foreign key.

**Repository tests**
- Create: `tests/case/repository.test.ts` — the 10 cases from spec §2.5 Tier 2.

**Tool adapter**
- Create: `src/lib/ai/tools/update_case.ts` — Vercel AI SDK `tool({...})` adapter.
- Create: `tests/ai/update_case.test.ts`.

**Smoke script**
- Create: `scripts/smoke-1b1.ts` — manual smoke for the 1B-1 verification gate.

**Env**
- Modify: `src/lib/env.ts` — no new vars in 1B-1; verify `DATABASE_URL` + `DIRECT_URL` still required.

**`.gitignore`**
- Modify: `.gitignore` — add `.env.test.local`.

**Plan/doc cross-reference**
- No edits to `CLAUDE.md` or `PRD.md` in this plan. Add a "Stack gotchas" entry only if something new bites us during execution.

---

## Self-contained working tree assumption

Plan starts from the head of `main` after 1A landed (`b8179c4` or later). `pnpm test`, `pnpm build`, `pnpm exec tsc --noEmit`, `pnpm lint` are all green. `.env.local` exists locally with `DATABASE_URL` and `DIRECT_URL` pointing at the real Supabase EU project.

Each task ends with a commit. Push at the end of Task 13 after the verification gate passes.

---

## Task 0: Add tsx and ai SDK; reserve test env file

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`
- Modify: `.gitignore`

- [ ] **Step 1: Add `tsx` (smoke script runner) and `ai` (Vercel AI SDK v5) and `dotenv` (drizzle.config.ts already imports it conditionally)**

Run:
```bash
pnpm add -D tsx@^4
pnpm add ai@^5
```

Expected: both land in `package.json`. `ai` goes into `dependencies` (the tool adapter imports `tool` from it at runtime); `tsx` is a dev tool.

- [ ] **Step 2: Add `.env.test.local` to `.gitignore`**

Open `.gitignore` and confirm there is a line like `.env.*.local` already (1A's `.gitignore` included it). If only `.env.local` is listed, append:

```
.env.test.local
```

- [ ] **Step 3: Add a smoke script entry to package.json scripts**

In `package.json`, add to `scripts`:

```json
"smoke:1b1": "tsx scripts/smoke-1b1.ts"
```

The full `scripts` block becomes (note the trailing comma on the new line is *not* present — JSON):

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "format": "prettier --write .",
  "test": "vitest run",
  "test:watch": "vitest",
  "db:generate": "node --env-file=.env.local node_modules/drizzle-kit/bin.cjs generate",
  "db:migrate": "node --env-file=.env.local node_modules/drizzle-kit/bin.cjs migrate",
  "db:push": "node --env-file=.env.local node_modules/drizzle-kit/bin.cjs push",
  "db:studio": "node --env-file=.env.local node_modules/drizzle-kit/bin.cjs studio",
  "smoke:1b1": "tsx scripts/smoke-1b1.ts"
}
```

- [ ] **Step 4: Verify install + lint stays clean**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: clean. (No new code yet; just dependencies.)

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml .gitignore
git commit -m "chore: add ai sdk v5 and tsx; reserve .env.test.local"
```

---

## Task 1: Fix change-table confidence column type and generate first migration

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `drizzle/0000_*.sql`, `drizzle/meta/_journal.json`, `drizzle/meta/0000_snapshot.json`

- [ ] **Step 1: Switch `confidence` columns from `integer` to `numeric`**

Open `src/lib/db/schema.ts`. Two changes:

(a) Add `numeric` to the imports from `drizzle-orm/pg-core`:

```ts
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  numeric,
  primaryKey,
} from 'drizzle-orm/pg-core';
```

(b) In `profileChanges`, change:

```ts
confidence: integer('confidence'),
```

to:

```ts
confidence: numeric('confidence', { precision: 3, scale: 2 }),
```

(c) In `caseChanges`, do the same swap.

`numeric(3, 2)` stores up to `9.99` — overkill for `[0, 1]` but cheaper to read in queries than `numeric(precision, scale=10)` and survives float round-trips faithfully.

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Generate the first migration**

Run: `pnpm db:generate`

Expected: writes `drizzle/0000_<adjective>_<noun>.sql` and the `drizzle/meta/` snapshot files. The SQL should contain CREATE TABLE for every table in `schema.ts` and the `confidence` columns are `numeric(3, 2)`.

- [ ] **Step 4: Inspect the generated SQL**

Run: `cat drizzle/0000_*.sql | head -80` (use the actual filename) and verify:
- `CREATE TABLE "case_changes"` includes `"confidence" numeric(3, 2)`.
- `CREATE TABLE "profile_changes"` includes `"confidence" numeric(3, 2)`.
- Foreign keys in `case_changes`, `profile_changes`, `activity_log`, `cases`, `case_facts`, `profiles`, `messages`, `tool_calls`, `threads`, `users`, `user_identities` look correct.
- `verification_tokens` has the composite PK `(identifier, token)`.

If any of those look wrong, stop and audit `schema.ts` before continuing.

- [ ] **Step 5: Apply the migration to Supabase**

Run: `pnpm db:migrate`

Expected: drizzle-kit connects via `DIRECT_URL` (port 5432 session pooler — CLAUDE.md), applies the migration, prints success.

If the migration fails because of an IPv6 issue or missing `DIRECT_URL`: re-read CLAUDE.md "Supabase: Two connection URLs required" and fix `.env.local`. Don't proceed without a successful migration — Tasks 4+ depend on real tables existing.

- [ ] **Step 6: Smoke-check the schema in Supabase**

Run a quick `psql`-style check via drizzle-kit:

```bash
node --env-file=.env.local node_modules/drizzle-kit/bin.cjs introspect 2>&1 | head -20 || true
```

Or open Supabase Studio and confirm the tables exist. Either way, confirm `case_changes` and `profile_changes` show `confidence numeric(3,2)`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/schema.ts drizzle
git commit -m "feat: fix change-table confidence to numeric and generate first migration"
```

---

## Task 2: Path utilities — validateLeafPath, validateLeafValue, setAtPath, getAtPath

**Files:**
- Create: `src/lib/case/paths.ts`
- Create: `tests/case/paths.test.ts`

- [ ] **Step 1: Write a failing test for `validateLeafPath`**

`tests/case/paths.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validateLeafPath, validateLeafValue, setAtPath, getAtPath } from '@/lib/case/paths';

describe('validateLeafPath', () => {
  it('resolves a valid case-facts path to a Zod inner schema', () => {
    const r = validateLeafPath('employment.annualGrossSalaryEur');
    expect(r.kind).toBe('case');
    expect(r.inner).toBeInstanceOf(z.ZodNumber);
  });

  it('resolves a valid profile path to a Zod inner schema', () => {
    const r = validateLeafPath('nationality');
    expect(r.kind).toBe('profile');
    expect(r.inner).toBeDefined();
  });

  it('rejects an unknown top-level segment', () => {
    expect(() => validateLeafPath('nonsense.field')).toThrow(/unknown path/i);
  });

  it('rejects a path that resolves to a non-leaf object', () => {
    expect(() => validateLeafPath('employment')).toThrow(/not a leaf/i);
  });

  it('rejects an unknown nested segment', () => {
    expect(() => validateLeafPath('employment.notAField')).toThrow(/unknown path/i);
  });
});

describe('validateLeafValue', () => {
  it('accepts a value matching the inner schema', () => {
    const { inner } = validateLeafPath('employment.annualGrossSalaryEur');
    expect(() => validateLeafValue(inner, 48500)).not.toThrow();
  });

  it('rejects a value of wrong type', () => {
    const { inner } = validateLeafPath('employment.annualGrossSalaryEur');
    expect(() => validateLeafValue(inner, 'forty thousand')).toThrow();
  });

  it('rejects an unknown enum value', () => {
    const { inner } = validateLeafPath('employment.contractType');
    expect(() => validateLeafValue(inner, 'casual')).toThrow();
  });

  it('accepts null as a value (clearing a field)', () => {
    const { inner } = validateLeafPath('employment.annualGrossSalaryEur');
    expect(() => validateLeafValue(inner, null)).not.toThrow();
  });
});

describe('setAtPath / getAtPath', () => {
  it('immutably sets a leaf in case facts', () => {
    const before = {};
    const after = setAtPath(before, 'employment.annualGrossSalaryEur', { value: 48500 });
    expect(before).toEqual({});
    expect(getAtPath(after, 'employment.annualGrossSalaryEur')).toEqual({ value: 48500 });
  });

  it('preserves sibling values', () => {
    const before = {
      employment: { employerName: { value: 'Acme' } },
    };
    const after = setAtPath(before, 'employment.annualGrossSalaryEur', { value: 48500 });
    expect(after.employment.employerName).toEqual({ value: 'Acme' });
    expect(after.employment.annualGrossSalaryEur).toEqual({ value: 48500 });
  });

  it('returns undefined for a missing leaf', () => {
    expect(getAtPath({}, 'employment.annualGrossSalaryEur')).toBeUndefined();
  });

  it('synthesises missing intermediate objects on set', () => {
    const after = setAtPath({}, 'education.anabinStatus', { value: 'H+' });
    expect(after).toEqual({ education: { anabinStatus: { value: 'H+' } } });
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm test tests/case/paths.test.ts`
Expected: fail — module `@/lib/case/paths` not found.

- [ ] **Step 3: Write `src/lib/case/paths.ts`**

```ts
import { z } from 'zod';
import { CaseFactsSchema } from '@/lib/case/schema';
import { ProfileSchema } from '@/lib/profile/schema';

export type PathKind = 'case' | 'profile';

export interface ResolvedPath {
  kind: PathKind;
  inner: z.ZodTypeAny;
}

/**
 * Walks the discriminated case+profile tree to confirm `path` resolves to a leaf
 * (a `FieldSchema(inner)` wrapper) and returns the inner schema.
 *
 * Throws if:
 *  - the top segment is not a known root on either schema
 *  - a nested segment is not a known sub-shape
 *  - the path resolves to an intermediate object, not a Field-wrapped leaf
 */
export function validateLeafPath(path: string): ResolvedPath {
  const segments = path.split('.');
  if (segments.length === 0 || segments.some((s) => s.length === 0)) {
    throw new Error(`invalid path: ${path}`);
  }

  // Try profile first (single-segment root paths win there).
  const profileTry = walk(unwrap(ProfileSchema), segments);
  if (profileTry.kind === 'leaf') return { kind: 'profile', inner: profileTry.inner };

  const caseTry = walk(unwrap(CaseFactsSchema), segments);
  if (caseTry.kind === 'leaf') return { kind: 'case', inner: caseTry.inner };

  if (profileTry.kind === 'intermediate' || caseTry.kind === 'intermediate') {
    throw new Error(`path is not a leaf: ${path}`);
  }
  throw new Error(`unknown path: ${path}`);
}

type WalkResult =
  | { kind: 'leaf'; inner: z.ZodTypeAny }
  | { kind: 'intermediate' }
  | { kind: 'unknown' };

function walk(node: z.ZodTypeAny, segments: string[]): WalkResult {
  let current: z.ZodTypeAny = node;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i] as string;
    const obj = unwrap(current);
    if (!(obj instanceof z.ZodObject)) return { kind: 'unknown' };
    const shape = obj.shape as Record<string, z.ZodTypeAny>;
    const next = shape[segment];
    if (!next) return { kind: 'unknown' };
    current = next;
  }
  // After consuming all segments, `current` should be a FieldSchema:
  // a ZodObject with .shape.value present. Anything else is an intermediate.
  const u = unwrap(current);
  if (u instanceof z.ZodObject) {
    const shape = u.shape as Record<string, z.ZodTypeAny>;
    const valueSchema = shape['value'];
    if (valueSchema) {
      return { kind: 'leaf', inner: unwrapNullable(valueSchema) };
    }
    return { kind: 'intermediate' };
  }
  return { kind: 'unknown' };
}

/** Strip `.optional()` / `.default()` / `.nullable()` wrappers off a Zod node. */
function unwrap(node: z.ZodTypeAny): z.ZodTypeAny {
  let n: z.ZodTypeAny = node;
  // ZodOptional / ZodDefault / ZodNullable / ZodEffects all expose `_def.innerType` (or similar).
  // Loop a few times to cover Optional<Default<Nullable<...>>>.
  for (let i = 0; i < 5; i++) {
    const def = (n as unknown as { _def?: { innerType?: z.ZodTypeAny } })._def;
    if (def?.innerType && def.innerType !== n) {
      n = def.innerType;
      continue;
    }
    break;
  }
  return n;
}

/** For a leaf value schema like `inner.nullable()`, return the underlying inner. */
function unwrapNullable(node: z.ZodTypeAny): z.ZodTypeAny {
  return unwrap(node);
}

/** Validate that a runtime value matches the leaf's inner schema. */
export function validateLeafValue(inner: z.ZodTypeAny, value: unknown): void {
  if (value === null) return;
  const result = inner.safeParse(value);
  if (!result.success) {
    throw new Error(
      `invalid leaf value: ${result.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
}

/** Immutably set `path` to `value` on `obj`, synthesising intermediate objects. */
export function setAtPath<T extends Record<string, unknown>>(
  obj: T,
  path: string,
  value: unknown,
): T {
  const segments = path.split('.');
  const out: Record<string, unknown> = { ...obj };
  let cursor: Record<string, unknown> = out;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i] as string;
    const existing = cursor[segment];
    const nextCursor: Record<string, unknown> =
      existing && typeof existing === 'object' && existing !== null
        ? { ...(existing as Record<string, unknown>) }
        : {};
    cursor[segment] = nextCursor;
    cursor = nextCursor;
  }
  cursor[segments[segments.length - 1] as string] = value;
  return out as T;
}

/** Get the value at `path` or undefined if any segment is missing. */
export function getAtPath(obj: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.');
  let cursor: unknown = obj;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/** Flatten the tool-input shape to per-row records for the change log. */
export interface FlatChange {
  path: string;
  newValue: unknown;
  resolved: ResolvedPath;
}

export function flattenForChangeLog(updates: Record<string, unknown>): FlatChange[] {
  return Object.entries(updates).map(([path, newValue]) => ({
    path,
    newValue,
    resolved: validateLeafPath(path),
  }));
}
```

- [ ] **Step 4: Run, expect pass**

Run: `pnpm test tests/case/paths.test.ts`
Expected: all green.

If the `unwrap` helper doesn't unwrap a Zod-4 specific wrapper, read the actual schema definitions in `src/lib/case/schema.ts` (e.g., `Optional` returns `FieldSchema(inner).optional()`) and adjust the unwrap loop. Zod 4's `_def.innerType` shape is the same as Zod 3 for these wrappers.

- [ ] **Step 5: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/case/paths.ts tests/case/paths.test.ts
git commit -m "feat: dotted-path validator and immutable get/set for case+profile schemas"
```

---

## Task 3: Repository types

**Files:**
- Create: `src/lib/case/types.ts`

- [ ] **Step 1: Write `src/lib/case/types.ts`**

```ts
import { z } from 'zod';
import { ProvenanceSourceEnum } from '@/lib/case/schema';

export const UpdateCaseInputSchema = z.object({
  caseId: z.string().uuid(),
  source: ProvenanceSourceEnum,
  sourceTurnId: z.string().uuid().nullable(),
  confidence: z.number().min(0).max(1),
  updates: z.record(z.string(), z.unknown()),
  fieldNotes: z.record(z.string(), z.string()).optional(),
});
export type UpdateCaseInput = z.infer<typeof UpdateCaseInputSchema>;

export interface ContradictionReport {
  path: string;
  previousValue: unknown;
  previousConfidence: number;
  newValue: unknown;
  newConfidence: number;
}

export interface UpdateCaseResult {
  caseId: string;
  updatedPaths: string[];
  contradictions: ContradictionReport[];
}
```

(Tests in later tasks will exercise this. No unit tests for this file alone — it's plain types.)

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/case/types.ts
git commit -m "feat: repository input/output types"
```

---

## Task 4: Test infra — withTestSchema and seedOrgAndUser

**Files:**
- Create: `tests/_db/setup.ts`
- Create: `tests/_db/seed.ts`
- Create: `.env.test.local.example`

- [ ] **Step 1: Write `.env.test.local.example`**

```
# Same as .env.local — same Supabase project. Tests run in throwaway schemas.
DATABASE_URL=postgres://postgres.<ref>:<pass>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
DIRECT_URL=postgres://postgres.<ref>:<pass>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
```

The user copies this to `.env.test.local` and fills in real credentials. Tests will load it manually (vitest doesn't auto-load .env files).

- [ ] **Step 2: Write `tests/_db/setup.ts`**

```ts
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
    const raw = readFileSync(join(migrationsDir, file), 'utf8');
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
```

Two notes on this:
- We use `DIRECT_URL` (port 5432, session pooler) not `DATABASE_URL` (transaction pooler) because creating/dropping schemas under transaction pooling is unreliable.
- Splitting on `--> statement-breakpoint` is what drizzle-kit's own runner does. If a future migration uses `DO $$ ... $$;` blocks, this naive split could misbehave; revisit then.

- [ ] **Step 3: Write `tests/_db/seed.ts`**

```ts
import { sql } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import type { TestDbHandle } from './setup';

export interface SeededIds {
  organizationId: string;
  userId: string;
}

/** Insert a single org + user in the test schema. Returns their UUIDs. */
export async function seedOrgAndUser(handle: TestDbHandle): Promise<SeededIds> {
  const { db, schemaName } = handle;
  await db.execute(sql.raw(`SET search_path = "${schemaName}"`));
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: 'Test Org', kind: 'personal' })
    .returning({ id: schema.organizations.id });
  if (!org) throw new Error('failed to insert organization');
  const [user] = await db
    .insert(schema.users)
    .values({ organizationId: org.id, isAnonymous: true })
    .returning({ id: schema.users.id });
  if (!user) throw new Error('failed to insert user');
  return { organizationId: org.id, userId: user.id };
}
```

- [ ] **Step 4: Write a smoke test that exercises the test infra itself**

`tests/_db/setup.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestSchema, type TestDbHandle } from './setup';
import { seedOrgAndUser } from './seed';
import * as schema from '@/lib/db/schema';

describe('test schema lifecycle', () => {
  let handle: TestDbHandle;

  beforeAll(async () => {
    handle = await createTestSchema();
  }, 30_000);

  afterAll(async () => {
    await handle.cleanup();
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
});
```

- [ ] **Step 5: Run, expect pass**

Run: `pnpm test tests/_db/setup.test.ts`

Expected: green. If the test errors with `DIRECT_URL not set`, copy `.env.test.local.example` to `.env.test.local` and fill in the real values. Stop and ask the user before continuing if the credentials aren't available.

If the migration parser splits on `--> statement-breakpoint` incorrectly (e.g., a CREATE TABLE statement runs alone but a CREATE TYPE preceded it without a breakpoint), inspect the generated `drizzle/0000_*.sql` and either:
- Add a manual breakpoint by hand-editing the SQL, OR
- Use `drizzle.execute(sql.raw(rawWholeFile))` if the dialect tolerates multi-statement strings on `pg`. We try the split first; fallback is the unsplit path.

- [ ] **Step 6: Commit**

```bash
git add tests/_db .env.test.local.example
git commit -m "test: per-file Postgres test schema lifecycle helper"
```

---

## Task 5: Repository — createCase + loadCase

**Files:**
- Create: `src/lib/case/repository.ts`
- Create: `tests/case/repository.test.ts`

- [ ] **Step 1: Write the failing test for `createCase` and `loadCase`**

`tests/case/repository.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestSchema, type TestDbHandle } from '@/../tests/_db/setup';
import { seedOrgAndUser, type SeededIds } from '@/../tests/_db/seed';
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
```

(Note: profile may not exist for every user. We model `loadCase().profile` as `Profile | null`; tests reflect this.)

- [ ] **Step 2: Run, expect failure**

Run: `pnpm test tests/case/repository.test.ts`
Expected: fail — `@/lib/case/repository` not found.

- [ ] **Step 3: Write `src/lib/case/repository.ts` (createCase + loadCase only)**

```ts
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@/lib/db/schema';
import { CaseFactsSchema, type CaseFacts } from '@/lib/case/schema';
import { ProfileSchema, type Profile } from '@/lib/profile/schema';
import { db as defaultDb } from '@/lib/db/client';

type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface CreateCaseInput {
  userId: string;
  visaType: string;
  targetCountry: string;
  targetConsulate?: string | null;
  targetMoveDate?: string | null;
}

export interface LoadedCase {
  case: {
    id: string;
    userId: string;
    status: string;
    visaType: string;
    targetCountry: string;
    targetConsulate: string | null;
    targetMoveDate: string | null;
  };
  profile: Profile | null;
  caseFacts: CaseFacts;
}

export interface Repository {
  createCase(input: CreateCaseInput): Promise<{ caseId: string }>;
  loadCase(caseId: string): Promise<LoadedCase>;
}

/**
 * Build a repository scoped to a Drizzle client and (optionally) a Postgres schema.
 * The schema arg matters for tests, which run against a throwaway schema. In prod,
 * pass `null` and the default `public` search_path applies.
 */
export function makeRepository(db: Db = defaultDb, schemaName: string | null = null): Repository {
  async function ensureSearchPath(): Promise<void> {
    if (schemaName) {
      await db.execute(sql.raw(`SET search_path = "${schemaName}"`));
    }
  }

  return {
    async createCase(input) {
      await ensureSearchPath();
      const [row] = await db
        .insert(schema.cases)
        .values({
          userId: input.userId,
          status: 'draft',
          visaType: input.visaType,
          targetCountry: input.targetCountry,
          targetConsulate: input.targetConsulate ?? null,
          targetMoveDate: input.targetMoveDate ?? null,
        })
        .returning({ id: schema.cases.id });
      if (!row) throw new Error('createCase: insert returned no row');
      await db.insert(schema.caseFacts).values({ caseId: row.id, data: {} as CaseFacts });
      return { caseId: row.id };
    },

    async loadCase(caseId) {
      await ensureSearchPath();
      const cases = await db.select().from(schema.cases).where(eq(schema.cases.id, caseId));
      if (cases.length === 0) throw new Error(`case not found: ${caseId}`);
      const c = cases[0]!;
      const facts = await db.select().from(schema.caseFacts).where(eq(schema.caseFacts.caseId, caseId));
      const factsRow = facts[0];
      const parsedFacts = CaseFactsSchema.parse(factsRow?.data ?? {});
      const profiles = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, c.userId));
      const profileRow = profiles[0];
      const parsedProfile = profileRow ? ProfileSchema.parse(profileRow.data) : null;
      return {
        case: {
          id: c.id,
          userId: c.userId,
          status: c.status,
          visaType: c.visaType,
          targetCountry: c.targetCountry,
          targetConsulate: c.targetConsulate,
          targetMoveDate: c.targetMoveDate,
        },
        profile: parsedProfile,
        caseFacts: parsedFacts,
      };
    },
  };
}
```

- [ ] **Step 4: Run, expect pass**

Run: `pnpm test tests/case/repository.test.ts`
Expected: green.

If parsing the empty `{}` against `CaseFactsSchema` throws because every sub-shape (`employment`, etc.) is `.optional()`: it should pass. If it doesn't, the issue is `CaseFactsSchema` requiring a non-empty object somewhere — read the test output and adjust the empty-init in `createCase` to satisfy the schema.

- [ ] **Step 5: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/case/repository.ts tests/case/repository.test.ts
git commit -m "feat: case repository createCase + loadCase with zod parse on read"
```

---

## Task 6: Repository — applyUpdate (single path, happy path)

**Files:**
- Modify: `src/lib/case/repository.ts`
- Modify: `tests/case/repository.test.ts`

- [ ] **Step 1: Add the failing test for `applyUpdate` happy path**

Append to `tests/case/repository.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm test tests/case/repository.test.ts`
Expected: fail — `repo.applyUpdate is not a function`.

- [ ] **Step 3: Extend `src/lib/case/repository.ts`**

Add imports at the top of the file:

```ts
import { CaseFactsSchema, type CaseFacts } from '@/lib/case/schema';
import { ProfileSchema, type Profile } from '@/lib/profile/schema';
import { validateLeafPath, validateLeafValue, setAtPath, getAtPath } from '@/lib/case/paths';
import type {
  UpdateCaseInput,
  UpdateCaseResult,
  ContradictionReport,
} from '@/lib/case/types';
```

(Move existing `CaseFactsSchema` / `ProfileSchema` imports to a single block.)

Extend the `Repository` interface:

```ts
export interface Repository {
  createCase(input: CreateCaseInput): Promise<{ caseId: string }>;
  loadCase(caseId: string): Promise<LoadedCase>;
  applyUpdate(input: UpdateCaseInput): Promise<UpdateCaseResult>;
}
```

Add to the return object inside `makeRepository`:

```ts
async applyUpdate(input) {
  const { caseId, source, sourceTurnId, confidence, updates, fieldNotes } = input;
  await ensureSearchPath();

  // 1. Validate every path before opening a transaction.
  const flat = Object.entries(updates).map(([path, newValue]) => {
    const resolved = validateLeafPath(path);
    validateLeafValue(resolved.inner, newValue);
    return { path, newValue, kind: resolved.kind };
  });

  const updatedAt = new Date().toISOString();
  const contradictions: ContradictionReport[] = [];

  await db.transaction(async (tx) => {
    if (schemaName) await tx.execute(sql.raw(`SET search_path = "${schemaName}"`));

    // Lock the rows we'll mutate.
    const factsRows = await tx.execute(
      sql.raw(`SELECT data FROM "${schemaName ?? 'public'}".case_facts WHERE case_id = '${caseId}' FOR UPDATE`),
    );
    const factsRow = factsRows.rows[0] as { data: CaseFacts } | undefined;
    if (!factsRow) throw new Error(`case_facts not found for case ${caseId}`);

    const caseRows = await tx.execute(
      sql.raw(`SELECT user_id FROM "${schemaName ?? 'public'}".cases WHERE id = '${caseId}'`),
    );
    const caseRow = caseRows.rows[0] as { user_id: string } | undefined;
    if (!caseRow) throw new Error(`case not found: ${caseId}`);
    const userId = caseRow.user_id;

    const profileRows = await tx.execute(
      sql.raw(`SELECT data FROM "${schemaName ?? 'public'}".profiles WHERE user_id = '${userId}' FOR UPDATE`),
    );
    const profileRow = profileRows.rows[0] as { data: Profile } | undefined;
    let nextFacts = factsRow.data ?? ({} as CaseFacts);
    let nextProfile = profileRow?.data ?? null;

    for (const { path, newValue, kind } of flat) {
      const wrapper = {
        value: newValue,
        source,
        sourceTurnId,
        confidence,
        updatedAt,
      };
      const target = kind === 'case' ? nextFacts : (nextProfile ?? {});
      const existing = getAtPath(target as Record<string, unknown>, path) as
        | { value: unknown; confidence: number }
        | undefined;
      if (existing && existing.confidence >= confidence && !deepEqual(existing.value, newValue)) {
        contradictions.push({
          path,
          previousValue: existing.value,
          previousConfidence: existing.confidence,
          newValue,
          newConfidence: confidence,
        });
      }
      const merged = setAtPath(target as Record<string, unknown>, path, wrapper);
      if (kind === 'case') nextFacts = merged as CaseFacts;
      else nextProfile = merged as Profile;

      const oldValueLog = existing?.value ?? null;
      const newValueLog = newValue;
      const changesTable = kind === 'case' ? 'case_changes' : 'profile_changes';
      const ownerColumn = kind === 'case' ? 'case_id' : 'user_id';
      const ownerId = kind === 'case' ? caseId : userId;
      await tx.execute(
        sql`INSERT INTO ${sql.raw(`"${schemaName ?? 'public'}".${changesTable}`)}
            (${sql.raw(ownerColumn)}, field_path, old_value, new_value, source, source_turn_id, confidence)
            VALUES (${ownerId}, ${path}, ${JSON.stringify(oldValueLog)}::jsonb, ${JSON.stringify(newValueLog)}::jsonb, ${source}, ${sourceTurnId}, ${confidence})`,
      );
    }

    // Safety belt: never write malformed JSONB.
    CaseFactsSchema.parse(nextFacts);
    if (nextProfile !== null) ProfileSchema.parse(nextProfile);

    await tx.execute(
      sql`UPDATE ${sql.raw(`"${schemaName ?? 'public'}".case_facts`)}
          SET data = ${JSON.stringify(nextFacts)}::jsonb, updated_at = NOW()
          WHERE case_id = ${caseId}`,
    );
    if (nextProfile !== null) {
      await tx.execute(
        sql`INSERT INTO ${sql.raw(`"${schemaName ?? 'public'}".profiles`)} (user_id, data)
            VALUES (${userId}, ${JSON.stringify(nextProfile)}::jsonb)
            ON CONFLICT (user_id) DO UPDATE
            SET data = EXCLUDED.data, updated_at = NOW()`,
      );
    }

    const payload = {
      kind: 'case.facts.updated',
      paths: flat.map((f) => f.path),
      source,
      sourceTurnId,
      contradictions: contradictions.length,
    };
    await tx.execute(
      sql`INSERT INTO ${sql.raw(`"${schemaName ?? 'public'}".activity_log`)} (case_id, user_id, kind, payload)
          VALUES (${caseId}, ${userId}, ${'case.facts.updated'}, ${JSON.stringify(payload)}::jsonb)`,
    );

    void fieldNotes; // reserved for future use; reading them here would write to a notes table that doesn't exist yet.
  });

  return {
    caseId,
    updatedPaths: flat.map((f) => f.path),
    contradictions,
  };
},
```

Add a small helper to the same file:

```ts
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
```

(JSON.stringify-based deep equal is fine here — values are JSON-serialisable by construction.)

- [ ] **Step 4: Run the new test, expect pass**

Run: `pnpm test tests/case/repository.test.ts`
Expected: green for the new test, plus the earlier createCase/loadCase tests still green.

If `Drizzle` doesn't support `db.transaction(async tx => {...})` against the `node-postgres` driver: it does as of 0.45. If the call shape differs in the version we have, `pnpm exec ts-node-dev` the test and read the error; `db.transaction` is the canonical API.

If `sql.raw` interpolation breaks on the test schema name (special chars): the schema name is `test_<base36>_<base36>` which is alphanumeric + underscore, so safe — but if a future change adds dashes, switch to a properly quoted identifier.

- [ ] **Step 5: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/case/repository.ts tests/case/repository.test.ts
git commit -m "feat: applyUpdate writes case_facts, case_changes, activity_log in one transaction"
```

---

## Task 7: applyUpdate — multi-path and round-trip

**Files:**
- Modify: `tests/case/repository.test.ts`

- [ ] **Step 1: Add tests for multi-path writes and round-trip**

Append to the `applyUpdate` describe block in `tests/case/repository.test.ts`:

```ts
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
```

- [ ] **Step 2: Run, expect pass without code changes**

Run: `pnpm test tests/case/repository.test.ts`
Expected: green.

If multi-path fails because `validateLeafValue` doesn't accept one of the values — read the error, the most likely culprit is a Zod enum that's case-sensitive or a tighter type constraint we forgot.

- [ ] **Step 3: Commit**

```bash
git add tests/case/repository.test.ts
git commit -m "test: applyUpdate multi-path writes and round-trip"
```

---

## Task 8: applyUpdate — profile-level paths land in the profile table

**Files:**
- Modify: `tests/case/repository.test.ts`

- [ ] **Step 1: Add the failing test**

Append:

```ts
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
  const profile = profileRows.rows[0] as { data: { nationality?: { value: string } } } | undefined;
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
```

- [ ] **Step 2: Run**

Run: `pnpm test tests/case/repository.test.ts`

The test exercises the path the code already takes (`kind === 'profile'`). One known issue: `nextProfile = profileRow?.data ?? null` then `setAtPath` is called on `null` if the user has no profile yet. The current code handles this with `target = … (nextProfile ?? {})` but the *next-iteration* read uses `nextProfile`. Re-read the loop body:

```ts
const target = kind === 'case' ? nextFacts : (nextProfile ?? {});
```

That's correct: we initialise to `{}` if no profile exists. After the first profile-level write, `nextProfile` becomes the merged object, so subsequent paths see the prior writes. Good.

The other quirk: `ProfileSchema.parse(nextProfile)` is called only `if (nextProfile !== null)`. Since after the write `nextProfile` is the merged object (no longer `null`), this is fine — but `ProfileSchema` requires `schemaVersion: z.literal(1)` plus all the identity fields. A profile created from a single `nationality` write won't have `schemaVersion`/`fullName`/etc.

**Fix:** Profiles must carry `schemaVersion` from creation, and most fields are `FieldSchema(...)` (not `.optional()`), so a partial write violates the schema.

The cleanest move: relax the read-side parse — accept partial profiles in 1B-1, since intake hasn't filled them yet. Update `ProfileSchema` to make the identity fields `.optional()` (mirroring `CaseFactsSchema`) AND add `schemaVersion: z.literal(1).default(1)`.

- [ ] **Step 3: Soften `src/lib/profile/schema.ts`**

Open `src/lib/profile/schema.ts`. Wrap each identity field with the same `Optional` helper used in `case/schema.ts`:

```ts
import { z } from 'zod';
import { FieldSchema, ProvenanceSourceEnum } from '@/lib/case/schema';

export { ProvenanceSourceEnum };

export const Iso2 = z.string().length(2);

export const CurrentAddressValue = z.object({
  line1: z.string().nullable(),
  city: z.string().nullable(),
  stateOrProvince: z.string().nullable(),
  country: Iso2.nullable(),
  postalCode: z.string().nullable(),
});

const Optional = <T extends z.ZodTypeAny>(inner: T) => FieldSchema(inner).optional();

export const ProfileSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  fullName: Optional(z.string()),
  dateOfBirth: Optional(z.string().date()),
  placeOfBirth: Optional(z.string()),
  gender: Optional(z.enum(['male', 'female', 'diverse'])),
  nationality: Optional(Iso2),
  passportNumber: Optional(z.string()),
  passportExpiry: Optional(z.string().date()),
  currentAddress: Optional(CurrentAddressValue),
});

export type Profile = z.infer<typeof ProfileSchema>;
```

- [ ] **Step 4: Update the profile insert in repository to seed `schemaVersion`**

In `src/lib/case/repository.ts`, where `nextProfile` is initialised:

```ts
let nextProfile = profileRow?.data ?? ({ schemaVersion: 1 } as Profile);
```

Change the `if (nextProfile !== null)` check (which now isn't needed since we always have an object) — but only write to the profiles table if at least one profile-level path was in this call. Replace the profile-write block with:

```ts
const wroteProfilePath = flat.some((f) => f.kind === 'profile');
if (wroteProfilePath) {
  ProfileSchema.parse(nextProfile);
  await tx.execute(
    sql`INSERT INTO ${sql.raw(`"${schemaName ?? 'public'}".profiles`)} (user_id, data)
        VALUES (${userId}, ${JSON.stringify(nextProfile)}::jsonb)
        ON CONFLICT (user_id) DO UPDATE
        SET data = EXCLUDED.data, updated_at = NOW()`,
  );
}
```

And remove the line `let nextProfile = profileRow?.data ?? null;` in favour of always `{ schemaVersion: 1 }`.

- [ ] **Step 5: Update `loadCase` to handle a missing profile correctly**

`loadCase` in repository.ts currently does:

```ts
const parsedProfile = profileRow ? ProfileSchema.parse(profileRow.data) : null;
```

Keep that — `loaded.profile` stays `Profile | null` and the existing repository test `expect(loaded.profile).toBeNull()` continues to pass when no profile-level path has been written.

- [ ] **Step 6: Run, expect pass**

Run: `pnpm test tests/case/repository.test.ts`
Expected: green for the new test and all earlier ones.

- [ ] **Step 7: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: clean. The `tests/personas/eligibility.test.ts` from 1A constructs profiles by hand — it includes all the fields, so making them optional doesn't break it.

- [ ] **Step 8: Commit**

```bash
git add src/lib/profile/schema.ts src/lib/case/repository.ts tests/case/repository.test.ts
git commit -m "feat: profile-path writes; relax ProfileSchema to optional fields for partial intake"
```

---

## Task 9: applyUpdate — contradictions and validation errors

**Files:**
- Modify: `tests/case/repository.test.ts`

- [ ] **Step 1: Add tests**

Append to the `applyUpdate` describe block:

```ts
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

  // Both writes persisted (we surface contradictions, we don't block).
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
```

- [ ] **Step 2: Run, expect pass**

Run: `pnpm test tests/case/repository.test.ts`
Expected: green.

The path-validation tests rely on `validateLeafPath` running before the transaction opens (Step 3 in Task 6's repository code) — which it does. No transaction → no inserts → counts stay zero.

- [ ] **Step 3: Commit**

```bash
git add tests/case/repository.test.ts
git commit -m "test: applyUpdate contradiction detection and validation rejection"
```

---

## Task 10: applyUpdate — concurrent writes serialise per case

**Files:**
- Modify: `tests/case/repository.test.ts`

- [ ] **Step 1: Add the test**

Append:

```ts
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
```

- [ ] **Step 2: Run**

Run: `pnpm test tests/case/repository.test.ts`
Expected: green.

If both writes race and one ends up clobbering the other (so `loaded.caseFacts.employment.employerName` is missing), the row lock isn't being held. Re-read the transaction body: the `SELECT … FOR UPDATE` on `case_facts` is what serialises. If the test fails, audit the SQL — the `FOR UPDATE` clause must be present.

If the test is flaky (sometimes pass, sometimes fail), there may be a `Pool` concurrency issue. The test pool is `max: 4`, so two concurrent writes have separate connections — exactly what we want for a real lock test. If still flaky, switch to `max: 1` for the test pool to remove the variable; but a real lock should hold regardless.

- [ ] **Step 3: Commit**

```bash
git add tests/case/repository.test.ts
git commit -m "test: applyUpdate row lock serialises concurrent same-case writes"
```

---

## Task 11: Tool adapter — update_case

**Files:**
- Create: `src/lib/ai/tools/update_case.ts`
- Create: `tests/ai/update_case.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/ai/update_case.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { makeUpdateCaseTool } from '@/lib/ai/tools/update_case';

describe('update_case tool adapter', () => {
  it('exposes a Vercel AI SDK tool with name + description + zod input', () => {
    const repo = { applyUpdate: vi.fn() } as unknown as Parameters<typeof makeUpdateCaseTool>[0];
    const tool = makeUpdateCaseTool(repo);
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(40);
    expect(tool.inputSchema).toBeDefined();
  });

  it('calls repository.applyUpdate with the parsed input', async () => {
    const applyUpdate = vi.fn().mockResolvedValue({
      caseId: 'c0000000-0000-4000-8000-000000000000',
      updatedPaths: ['employment.annualGrossSalaryEur'],
      contradictions: [],
    });
    const tool = makeUpdateCaseTool({ applyUpdate } as never);

    const out = await tool.execute({
      caseId: 'c0000000-0000-4000-8000-000000000000',
      source: 'user_stated',
      sourceTurnId: 't0000000-0000-4000-8000-000000000000',
      confidence: 0.9,
      updates: { 'employment.annualGrossSalaryEur': 48500 },
    }, {} as never);

    expect(applyUpdate).toHaveBeenCalledOnce();
    expect(out).toEqual({
      type: 'update_case_result',
      version: 1,
      data: {
        caseId: 'c0000000-0000-4000-8000-000000000000',
        updatedPaths: ['employment.annualGrossSalaryEur'],
        contradictions: [],
      },
    });
  });

  it('rejects invalid input via the Zod schema before calling the repository', async () => {
    const applyUpdate = vi.fn();
    const tool = makeUpdateCaseTool({ applyUpdate } as never);
    const result = tool.inputSchema.safeParse({
      caseId: 'not-a-uuid',
      source: 'user_stated',
      sourceTurnId: null,
      confidence: 0.9,
      updates: {},
    });
    expect(result.success).toBe(false);
    expect(applyUpdate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm test tests/ai/update_case.test.ts`
Expected: fail — `@/lib/ai/tools/update_case` not found.

- [ ] **Step 3: Write `src/lib/ai/tools/update_case.ts`**

```ts
import { tool } from 'ai';
import { UpdateCaseInputSchema, type UpdateCaseResult } from '@/lib/case/types';
import type { Repository } from '@/lib/case/repository';

const description = [
  'Persist one or more leaf-level updates to the case facts or user profile.',
  'Updates is a flat object whose keys are dotted paths into the case/profile tree',
  '(e.g. "employment.annualGrossSalaryEur", "education.anabinStatus", "nationality").',
  'All updates in one call share a single source/confidence/sourceTurnId.',
  'Returns the list of updated paths and any contradictions detected against existing values.',
  'NEVER pass year-specific thresholds, fees, or processing times via this tool.',
  'NEVER fabricate paths — if you are unsure, ask the user instead of guessing.',
].join(' ');

export function makeUpdateCaseTool(repo: Pick<Repository, 'applyUpdate'>) {
  return tool({
    description,
    inputSchema: UpdateCaseInputSchema,
    async execute(input: typeof UpdateCaseInputSchema._type) {
      const result: UpdateCaseResult = await repo.applyUpdate(input);
      return {
        type: 'update_case_result' as const,
        version: 1 as const,
        data: result,
      };
    },
  });
}
```

The discriminated-union return shape (`{type, version, data}`) matches the architectural rule from CLAUDE.md (#8).

- [ ] **Step 4: Run, expect pass**

Run: `pnpm test tests/ai/update_case.test.ts`
Expected: green.

If the `tool()` call signature differs in the installed `ai` version (it changed between v4 and v5), check `node_modules/ai/dist/index.d.ts` for the `tool` export and adjust. v5's signature is `tool({ description, inputSchema, execute })` — `inputSchema` (Zod) replaces v4's `parameters`. CLAUDE.md flags this.

- [ ] **Step 5: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/tools/update_case.ts tests/ai/update_case.test.ts
git commit -m "feat: update_case ai sdk tool adapter (zod-validated, discriminated-union output)"
```

---

## Task 12: Manual smoke script

**Files:**
- Create: `scripts/smoke-1b1.ts`

- [ ] **Step 1: Write the smoke script**

`scripts/smoke-1b1.ts`:

```ts
/**
 * Manual smoke for Phase 1B-1.
 * Runs against the real (non-test) Supabase project via .env.local.
 *
 *   pnpm smoke:1b1
 *
 * Creates an org+user, creates a case, runs two applyUpdate calls
 * (one with a contradiction), reads back via loadCase, prints summary,
 * then DELETEs the data it created so the project stays clean.
 */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { makeRepository } from '@/lib/case/repository';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set; run with `node --env-file=.env.local` or via pnpm smoke:1b1');
  const pool = new Pool({ connectionString: url, max: 2 });
  const db = drizzle(pool, { schema });

  // 1. seed an org + user
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: 'Smoke Org', kind: 'personal' })
    .returning({ id: schema.organizations.id });
  if (!org) throw new Error('failed to seed org');
  const [user] = await db
    .insert(schema.users)
    .values({ organizationId: org.id, isAnonymous: true })
    .returning({ id: schema.users.id });
  if (!user) throw new Error('failed to seed user');
  console.log('seeded user', user.id, 'in org', org.id);

  // 2. create a case
  const repo = makeRepository(db, null);
  const { caseId } = await repo.createCase({
    userId: user.id,
    visaType: 'blue_card',
    targetCountry: 'DE',
    targetConsulate: 'bengaluru',
  });
  console.log('created case', caseId);

  // 3. write a salary
  const r1 = await repo.applyUpdate({
    caseId,
    source: 'user_stated',
    sourceTurnId: '00000000-0000-4000-8000-000000000001',
    confidence: 0.9,
    updates: { 'employment.annualGrossSalaryEur': 48500, 'education.anabinStatus': 'H+' },
  });
  console.log('write 1:', r1);

  // 4. correct it (contradiction expected)
  const r2 = await repo.applyUpdate({
    caseId,
    source: 'user_corrected',
    sourceTurnId: '00000000-0000-4000-8000-000000000002',
    confidence: 0.9,
    updates: { 'employment.annualGrossSalaryEur': 55000 },
  });
  console.log('write 2:', r2);

  // 5. read it back
  const loaded = await repo.loadCase(caseId);
  console.log('caseFacts.employment.annualGrossSalaryEur:', loaded.caseFacts.employment?.annualGrossSalaryEur);
  console.log('caseFacts.education.anabinStatus:', loaded.caseFacts.education?.anabinStatus);

  // 6. clean up
  await db.delete(schema.activityLog).where(eq(schema.activityLog.caseId, caseId));
  await db.delete(schema.caseChanges).where(eq(schema.caseChanges.caseId, caseId));
  await db.delete(schema.caseFacts).where(eq(schema.caseFacts.caseId, caseId));
  await db.delete(schema.cases).where(eq(schema.cases.id, caseId));
  await db.delete(schema.profileChanges).where(eq(schema.profileChanges.userId, user.id));
  await db.delete(schema.profiles).where(eq(schema.profiles.userId, user.id));
  await db.delete(schema.users).where(eq(schema.users.id, user.id));
  await db.delete(schema.organizations).where(eq(schema.organizations.id, org.id));
  console.log('cleaned up.');

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Adjust `pnpm smoke:1b1` to load .env.local**

Update `package.json` scripts:

```json
"smoke:1b1": "node --env-file=.env.local --import tsx scripts/smoke-1b1.ts"
```

(`--import tsx` is Node 20+'s loader hook for tsx. If the node version doesn't support `--import`, fall back to `tsx --env-file=.env.local scripts/smoke-1b1.ts`.)

- [ ] **Step 3: Run the smoke**

Run: `pnpm smoke:1b1`

Expected output (abridged):
```
seeded user <uuid> in org <uuid>
created case <uuid>
write 1: { caseId, updatedPaths: ['employment.annualGrossSalaryEur', 'education.anabinStatus'], contradictions: [] }
write 2: { caseId, updatedPaths: ['employment.annualGrossSalaryEur'], contradictions: [{ path: 'employment.annualGrossSalaryEur', previousValue: 48500, ... newValue: 55000 }] }
caseFacts.employment.annualGrossSalaryEur: { value: 55000, source: 'user_corrected', confidence: 0.9, ... }
caseFacts.education.anabinStatus: { value: 'H+', source: 'user_stated', confidence: 0.9, ... }
cleaned up.
```

If the smoke leaves rows behind (e.g., the cleanup throws), open Supabase Studio, find the orphan rows, and delete them by hand. Then audit the cleanup block — order matters because of foreign keys.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-1b1.ts package.json
git commit -m "test: manual smoke script for 1b-1 against real supabase"
```

---

## Task 13: Verification gate + push

**Files:** none modified.

- [ ] **Step 1: Full test run**

Run: `pnpm test`
Expected: every suite green — `paths.test.ts`, `setup.test.ts`, `repository.test.ts`, `update_case.test.ts`, plus all 1A suites (`env.test.ts`, `case-schema.test.ts`, `case-facts.test.ts`, `rules-loader.test.ts`, `eligibility.test.ts`, `personas/schema.test.ts`, `personas/eligibility.test.ts`, `db-schema.test.ts`).

If `tests/personas/eligibility.test.ts` regressed because Task 8 made `ProfileSchema` fields optional: the harness in `tests/personas/eligibility.test.ts` builds profiles with all fields populated, so it still parses. If it doesn't, audit `loadPersonas` and the `toProfile` helper.

- [ ] **Step 2: Build + type-check + lint**

Run: `pnpm build && pnpm exec tsc --noEmit && pnpm lint`
Expected: clean.

- [ ] **Step 3: Smoke against real Supabase**

Run: `pnpm smoke:1b1`
Expected: prints the contradiction in write 2; `caseFacts.employment.annualGrossSalaryEur.value === 55000`; cleanup succeeds.

- [ ] **Step 4: Inspect status + log**

Run: `git status && git log --oneline -15`
Expected: clean tree, ~13 commits since `b8179c4`.

- [ ] **Step 5: Push**

Run: `git push origin main`
Expected: pushes to `github.com/vitazok/visa`.

---

## Verification gate (end of 1B-1)

- [ ] `pnpm test` green
- [ ] `pnpm build` green
- [ ] `pnpm exec tsc --noEmit` clean
- [ ] `pnpm lint` clean
- [ ] `pnpm smoke:1b1` round-trips a case end-to-end against real Supabase
- [ ] `drizzle/0000_*.sql` committed and applied to the real Supabase project

---

## Out of scope (intentionally deferred to 1B-2 / 1B-3)

- Auth.js v5 magic-link, `visa_session` cookie, anonymous→authed merge → **1B-2**
- AI SDK streaming chat route, `useChat` client, 3-col workspace, Inngest scaffold → **1B-3**
- Real `buildAgentContext` (Phase 2)
- Other tools (Phase 2+)
- `prompts/agent/v0-stub.md` (1B-3)

---

## Self-review

**Spec coverage** (against `2026-05-27-phase-1b-design.md` §2):

| Spec section | Task | Notes |
|---|---|---|
| §2.1 `repository.ts` API (createCase) | Task 5 | |
| §2.1 `repository.ts` API (loadCase) | Task 5 | |
| §2.1 `repository.ts` API (applyUpdate) | Tasks 6–10 | TDD slice by slice |
| §2.1 `paths.ts` | Task 2 | |
| §2.1 `tools/update_case.ts` | Task 11 | |
| §2.2 dotted-path tool input shape | Task 3 (`UpdateCaseInputSchema`), Task 11 (wired) | |
| §2.3 read-side Zod parse | Task 5 (`loadCase`) | |
| §2.3 write-side Zod parse safety belt | Task 6 (`CaseFactsSchema.parse(merged)`) | |
| §2.3 `SELECT … FOR UPDATE` | Task 6 | Verified by Task 10's concurrency test |
| §2.3 activity_log payload shape | Task 6 (one row per applyUpdate, paths in payload) | |
| §2.4 contradiction detection | Task 9 | |
| §2.5 Tier 1 paths tests | Task 2 | |
| §2.5 Tier 2 cases 1–10 | Tasks 5, 6, 7, 8, 9, 10 | |
| §2.5 Tier 3 tool adapter tests | Task 11 | |
| §2.5 `withTestSchema` infra | Task 4 (named `createTestSchema` — same shape) | |
| §2.6 verification gate | Task 13 | |

**Placeholder scan:** No "TBD", no "implement appropriately", no "similar to Task N". Every code step shows code; every command shows expected output; every commit message is concrete.

**Type consistency:** `Repository`, `UpdateCaseInput`, `UpdateCaseResult`, `ContradictionReport`, `ResolvedPath`, `validateLeafPath`, `validateLeafValue`, `setAtPath`, `getAtPath`, `flattenForChangeLog` — names used identically across Tasks 2, 3, 6, 11. `makeRepository(db, schemaName)` signature defined in Task 5, used identically in Tasks 6, 11, 12.

**Known soft spots:**
1. Task 2's `unwrap` helper depends on Zod 4's `_def.innerType` shape. If Zod 4 renamed it, the helper breaks; the test at Step 1 will catch it. Mitigation: read `node_modules/zod/lib/index.d.ts` for the actual property name.
2. Task 6's SQL uses `sql.raw` with the test schema name interpolated. The schema name is generated server-side (alphanumeric + underscore) so it's safe for now, but a future change should switch to a properly quoted identifier.
3. Task 8's relaxation of `ProfileSchema` could surprise Phase 2 if the eligibility engine asserts on profile fields. The persona test suite catches that — Task 13 Step 1 re-runs it.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-27-phase-1b-1-persistence.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch with checkpoints

Which approach?
