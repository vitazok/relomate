# Phase 3B — Approvals & Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a human review extracted document fields and confirm them, flowing the confirmed values into `CaseFacts`/`Profile` via the single authoritative `applyUpdate` write path, gated by a generic approvals primitive reused by Phase 4.

**Architecture:** A polymorphic `approvals` table + repository tracks "what needs review." The 3A extraction workflow gains one `create-approval` step (the only touch to 3A). A config-driven field→leaf-path mapping (in `documents.yaml`) plus a typed transform registry turns extracted fields into leaf updates. A dedicated RSC review route renders the source document beside editable fields; `confirmExtraction`/`rejectExtraction` server actions (with node-testable core functions) perform the write, resolve the approval, and advance document status.

**Tech Stack:** Next.js 16 (App Router, RSC + server actions), Drizzle ORM (Postgres/Supabase), Zod, Vitest (node env), Tailwind/shadcn, Inngest.

---

## CRITICAL grounding notes (read before starting)

1. **Profile leaf paths are BARE, not prefixed.** `listLeafPaths()`/`validateLeafPath()` resolve profile leaves at the root: the valid path for the passport number is `passportNumber`, for full name `fullName`, for nationality `nationality`, for DOB `dateOfBirth`, for expiry `passportExpiry`. **NOT** `profile.passportNumber`. The design spec used a `profile.` prefix for readability — ignore that; use bare names in `documents.yaml` `target:` values and everywhere else. (Verified against `src/lib/case/paths.ts:52-76` and `src/lib/profile/schema.ts`.)
2. **Vitest `environment` is `'node'`** (`vitest.config.ts:6`). Do NOT write React-render tests. Test pure functions and DB repositories. UI logic that needs testing is extracted into pure functions.
3. **DB tests run serially.** Full suite: `pnpm exec vitest run --no-file-parallelism` (the `EMAXPOOLSREACHED` pooler limit, documented in CLAUDE.md). Single-file runs are fine in parallel.
4. **Test DB mock pattern (mandatory):** `vi.mock('@/lib/db/client', () => ({ get db() { return testHandle.db; } }))` — the **getter** is essential (vi.mock is hoisted). Never put `schema` in the factory.
5. **`config/rules/documents.yaml` has TWO consumers:** `src/lib/extraction/schema.ts` (`FieldSpecYaml`, strips unknown keys) and `src/lib/rules/types.ts` `DocumentItem` (Zod **strips** unknown keys by default, so adding `extraction.fields.*.target` does NOT break `getDocumentRules()`). We extend `FieldSpecYaml` to capture the new keys.
6. **Provenance sources** `'document'` and `'user_corrected'` already exist in `ProvenanceSourceEnum` (`src/lib/case/schema.ts:3-10`). `UpdateCaseInput.sourceTurnId` is `z.string().uuid().nullable()` — `null` is valid.

---

## File structure

**New files:**
- `src/lib/approvals/types.ts` — `ApprovalStatus`, `SubjectType`, `ApprovalDecision`, Zod schemas.
- `src/lib/approvals/repository.ts` — `makeApprovalRepository(db?)`.
- `src/lib/documents/confidence.ts` — pure `classifyConfidence(score, bands)` (client-safe, no fs).
- `src/lib/documents/review-config.ts` — server-only loader: `getConfidenceBands()`, `getNationalityIso2Map()` (module-cached).
- `src/lib/documents/transforms.ts` — transform registry (`composeFullName`, `toIso2`).
- `src/lib/documents/confirm-mapping.ts` — pure `buildConfirmUpdates(spineItemId, fields)`.
- `src/lib/documents/confirm-core.ts` — node-testable `confirmExtractionCore`/`rejectExtractionCore`.
- `src/lib/documents/review-view-model.ts` — pure `buildReviewRows(extracted, schema, bands)`.
- `config/rules/review.yaml` — `confidenceBands` + `nationalityToIso2` seed.
- `src/app/case/[id]/documents/[docId]/review/page.tsx` — RSC review route.
- `src/app/case/[id]/documents/[docId]/review/ReviewForm.tsx` — `'use client'` form.
- `src/app/case/[id]/documents/[docId]/review/actions.ts` — `'use server'` thin wrappers.
- `drizzle/0004_*.sql` — generated `approvals` migration.
- Tests: `tests/approvals/repository.test.ts`, `tests/documents/transforms.test.ts`, `tests/documents/confirm-mapping.test.ts`, `tests/documents/confirm-core.test.ts`, `tests/documents/confidence.test.ts`, `tests/extraction/target-validation.test.ts`.

**Modified files:**
- `src/lib/documents/types.ts` — `DocumentStatusEnum` += `confirmed`, `rejected`.
- `src/lib/db/schema.ts` — `approvals` table.
- `src/lib/extraction/types.ts` — `ExtractionFieldSpec` += `target?`, `transform?`, `part?`.
- `src/lib/extraction/schema.ts` — load + validate `target`/`transform`/`part`; `assertValidTargets`.
- `config/rules/documents.yaml` — passport extraction fields gain `target`/`transform`/`part`.
- `src/lib/inngest/functions/extract-document.ts` — `create-approval` step.
- `tests/inngest/extract-document.test.ts` — assert the new step.
- `src/components/workspace/renderers/registry.tsx` — `DocumentExtractionStatus` deep link + terminal states.

---

## Task 1: Document status enum + approvals table schema + migration

**Files:**
- Modify: `src/lib/documents/types.ts:13-21`
- Create: `src/lib/approvals/types.ts`
- Modify: `src/lib/db/schema.ts`
- Create: `drizzle/0004_*.sql` (via `pnpm db:generate`)

- [ ] **Step 1: Extend the document status enum**

In `src/lib/documents/types.ts`, replace the `DocumentStatusEnum` definition:

```ts
export const DocumentStatusEnum = z.enum([
  'pending_upload',
  'uploaded',
  'classifying',
  'extracting',
  'awaiting_confirmation',
  'confirmed',
  'rejected',
  'failed',
]);
export type DocumentStatus = z.infer<typeof DocumentStatusEnum>;
```

- [ ] **Step 2: Create approvals types**

Create `src/lib/approvals/types.ts`:

```ts
import { z } from 'zod';

export const ApprovalStatusEnum = z.enum(['pending', 'approved', 'rejected']);
export type ApprovalStatus = z.infer<typeof ApprovalStatusEnum>;

export const SubjectTypeEnum = z.enum(['document', 'draft']);
export type SubjectType = z.infer<typeof SubjectTypeEnum>;

// PII-safe: KEYS only (leaf paths), never values.
export const ApprovalDecisionSchema = z.object({
  confirmedPaths: z.array(z.string()),
  editedPaths: z.array(z.string()),
  rejectedReason: z.string().nullable(),
});
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
```

- [ ] **Step 3: Add the approvals table to the Drizzle schema**

In `src/lib/db/schema.ts`, update the imports at the top:

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
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
```

Add a type-only import alongside the existing ones:

```ts
import type { ApprovalDecision } from '@/lib/approvals/types';
```

Then add the table (place it after the `documents` table definition, before `verificationTokens`):

```ts
export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    caseId: uuid('case_id').references(() => cases.id).notNull(),
    userId: uuid('user_id').references(() => users.id).notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    status: text('status').notNull().default('pending'),
    decision: jsonb('decision').$type<ApprovalDecision | null>(),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // At most one OPEN (pending) approval per subject. Resolved rows don't conflict,
    // so a subject can be re-reviewed later (e.g. re-upload after reject).
    pendingPerSubject: uniqueIndex('approvals_pending_subject_unique')
      .on(t.subjectType, t.subjectId)
      .where(sql`${t.status} = 'pending'`),
  }),
);
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `drizzle/0004_*.sql` is created. Open it and confirm it contains a `CREATE TABLE "approvals"`, the two FK constraints to `cases`/`users` (and `resolved_by` → `users`), and a partial unique index:

```sql
CREATE UNIQUE INDEX "approvals_pending_subject_unique" ON "approvals" ("subject_type","subject_id") WHERE "approvals"."status" = 'pending';
```

If `db:generate` needs a DB connection and none is available, hand-author `drizzle/0004_approvals.sql` with the equivalent SQL (the test harness in `tests/_db/setup.ts` strips `"public".` prefixes and splits on `--> statement-breakpoint`, so follow the 0003 format exactly).

- [ ] **Step 5: Verify the schema compiles and migration applies in a test schema**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (no type errors).

Run: `pnpm exec vitest run tests/documents/repository.test.ts`
Expected: PASS — this exercises `createTestSchema()`, which applies all `drizzle/*.sql` including the new `0004`. A SQL error in the migration fails here.

- [ ] **Step 6: Commit**

```bash
git add src/lib/documents/types.ts src/lib/approvals/types.ts src/lib/db/schema.ts drizzle/
git commit -m "feat: add approvals table + confirmed/rejected document statuses"
```

---

## Task 2: Approvals repository

**Files:**
- Create: `src/lib/approvals/repository.ts`
- Test: `tests/approvals/repository.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/approvals/repository.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedAnonUser } from '../_db/seed-auth';
import { makeRepository } from '@/lib/case/repository';
import { makeApprovalRepository } from '@/lib/approvals/repository';

let testHandle: TestDbHandle;
vi.mock('@/lib/db/client', () => ({ get db() { return testHandle.db; } }));

describe('approval repository', () => {
  let caseId: string;
  let userId: string;

  beforeAll(async () => {
    testHandle = await createTestSchema();
    userId = (await seedAnonUser(testHandle)).userId;
    const repo = makeRepository(testHandle.db, testHandle.schemaName);
    caseId = (await repo.createCase({ userId, visaType: 'blue_card', targetCountry: 'DE' })).caseId;
  }, 30_000);

  afterAll(async () => { if (testHandle) await testHandle.cleanup(); });

  it('createPending inserts a pending row and is idempotent per subject', async () => {
    const approvals = makeApprovalRepository(testHandle.db);
    const subjectId = crypto.randomUUID();
    const id1 = await approvals.createPending({ caseId, userId, subjectType: 'document', subjectId });
    const id2 = await approvals.createPending({ caseId, userId, subjectType: 'document', subjectId });
    expect(id2).toBe(id1); // idempotent — returns the existing open approval

    const row = await approvals.getBySubject('document', subjectId);
    expect(row?.status).toBe('pending');
    expect(row?.caseId).toBe(caseId);
  });

  it('listPending returns only pending approvals for the case', async () => {
    const approvals = makeApprovalRepository(testHandle.db);
    const s = crypto.randomUUID();
    await approvals.createPending({ caseId, userId, subjectType: 'document', subjectId: s });
    const pending = await approvals.listPending(caseId);
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending.every((p) => p.status === 'pending' && p.caseId === caseId)).toBe(true);
  });

  it('resolve flips pending → approved with a PII-safe decision', async () => {
    const approvals = makeApprovalRepository(testHandle.db);
    const subjectId = crypto.randomUUID();
    const id = await approvals.createPending({ caseId, userId, subjectType: 'document', subjectId });
    await approvals.resolve(id, {
      status: 'approved',
      decision: { confirmedPaths: ['passportNumber'], editedPaths: ['nationality'], rejectedReason: null },
      resolvedBy: userId,
    });
    const row = await approvals.getById(id);
    expect(row?.status).toBe('approved');
    expect(row?.resolvedBy).toBe(userId);
    expect(row?.decision).toEqual({
      confirmedPaths: ['passportNumber'],
      editedPaths: ['nationality'],
      rejectedReason: null,
    });
    // After resolve, the subject has no open approval (partial unique freed).
    expect(await approvals.getBySubject('document', subjectId)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/approvals/repository.test.ts`
Expected: FAIL — `Cannot find module '@/lib/approvals/repository'`.

- [ ] **Step 3: Implement the repository**

Create `src/lib/approvals/repository.ts`:

```ts
import { and, eq, desc } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import { db as defaultDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import type { ApprovalStatus, SubjectType, ApprovalDecision } from '@/lib/approvals/types';

type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface CreatePendingInput {
  caseId: string;
  userId: string;
  subjectType: SubjectType;
  subjectId: string;
}

export interface ResolveInput {
  status: Exclude<ApprovalStatus, 'pending'>;
  decision: ApprovalDecision;
  resolvedBy: string;
}

export interface ApprovalRow {
  id: string;
  caseId: string;
  userId: string;
  subjectType: SubjectType;
  subjectId: string;
  status: ApprovalStatus;
  decision: ApprovalDecision | null;
  resolvedBy: string | null;
}

export interface ApprovalRepository {
  createPending(input: CreatePendingInput): Promise<string>;
  getById(id: string): Promise<ApprovalRow | null>;
  getBySubject(subjectType: SubjectType, subjectId: string): Promise<ApprovalRow | null>;
  listPending(caseId: string): Promise<ApprovalRow[]>;
  resolve(id: string, input: ResolveInput): Promise<void>;
}

function toRow(r: typeof schema.approvals.$inferSelect): ApprovalRow {
  return {
    id: r.id,
    caseId: r.caseId,
    userId: r.userId,
    subjectType: r.subjectType as SubjectType,
    subjectId: r.subjectId,
    status: r.status as ApprovalStatus,
    decision: r.decision ?? null,
    resolvedBy: r.resolvedBy ?? null,
  };
}

export function makeApprovalRepository(db?: Db): ApprovalRepository {
  const dbInstance = db ?? defaultDb;
  return {
    async createPending(input) {
      // Sequential re-delivery safety: return the existing open approval if one exists.
      // The partial unique index is the DB-level backstop for a true concurrent race.
      const existing = await this.getBySubject(input.subjectType, input.subjectId);
      if (existing && existing.status === 'pending') return existing.id;
      const [row] = await dbInstance
        .insert(schema.approvals)
        .values({
          caseId: input.caseId,
          userId: input.userId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          status: 'pending',
        })
        .returning({ id: schema.approvals.id });
      if (!row) throw new Error('createPending: no row returned');
      return row.id;
    },
    async getById(id) {
      const rows = await dbInstance.select().from(schema.approvals).where(eq(schema.approvals.id, id));
      return rows[0] ? toRow(rows[0]) : null;
    },
    async getBySubject(subjectType, subjectId) {
      const rows = await dbInstance
        .select()
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.subjectType, subjectType),
            eq(schema.approvals.subjectId, subjectId),
            eq(schema.approvals.status, 'pending'),
          ),
        );
      return rows[0] ? toRow(rows[0]) : null;
    },
    async listPending(caseId) {
      const rows = await dbInstance
        .select()
        .from(schema.approvals)
        .where(and(eq(schema.approvals.caseId, caseId), eq(schema.approvals.status, 'pending')))
        .orderBy(desc(schema.approvals.createdAt));
      return rows.map(toRow);
    },
    async resolve(id, input) {
      const updated = await dbInstance
        .update(schema.approvals)
        .set({
          status: input.status,
          decision: input.decision,
          resolvedBy: input.resolvedBy,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.approvals.id, id))
        .returning({ id: schema.approvals.id });
      if (!updated[0]) throw new Error(`resolve: approval not found: ${id}`);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/approvals/repository.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/approvals/repository.ts tests/approvals/repository.test.ts
git commit -m "feat: add approvals repository with idempotent createPending"
```

---

## Task 3: `create-approval` workflow step

**Files:**
- Modify: `src/lib/inngest/functions/extract-document.ts:91-105` (add a step before/after `log-extracted`)
- Test: `tests/inngest/extract-document.test.ts` (add one test)

- [ ] **Step 1: Write the failing test**

Add this test to `tests/inngest/extract-document.test.ts` (inside the `describe`, after the existing tests). Add the import at the top: `import { makeApprovalRepository } from '@/lib/approvals/repository';`

```ts
  it('creates a pending approval for the document when extraction lands', async () => {
    const { extractDocumentHandler } = await import('@/lib/inngest/functions/extract-document');
    const storage = makeFakeStorageAdapter();
    const key = `cases/${caseId}/documents/d5/passport.pdf`;
    await storage.__putForTest(key, new Uint8Array([1]), 'application/pdf');
    const documentId = await seedDoc(caseId, userId, key);
    const provider = makeFakeExtractionProvider({
      classifyResult: { spineItemId: 'passport', confidence: 0.9 },
      extractResult: {
        fields: { surname: { value: 'Rao', confidence: 0.9 } },
        provider: 'anthropic_vision',
        modelVersion: 'm',
      },
    });

    await extractDocumentHandler({
      event: { name: 'document.uploaded', data: { documentId, caseId, userId } },
      step,
      deps: { storage, provider },
    });

    const approval = await makeApprovalRepository(testHandle.db).getBySubject('document', documentId);
    expect(approval?.status).toBe('pending');
    expect(approval?.caseId).toBe(caseId);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/inngest/extract-document.test.ts -t "creates a pending approval"`
Expected: FAIL — `approval` is `null` (no step creates it yet).

- [ ] **Step 3: Add the step to the workflow**

In `src/lib/inngest/functions/extract-document.ts`, add the import near the top:

```ts
import { makeApprovalRepository } from '@/lib/approvals/repository';
```

Add `const approvals = makeApprovalRepository();` next to the existing `const docs = makeDocumentRepository();` (around line 29).

Then add a new step immediately after the `store` step (after line 88, before the `log-extracted` step):

```ts
    // Step 4b — open a pending approval so the document surfaces in the review inbox (3B).
    await step.run('create-approval', () =>
      approvals.createPending({ caseId, userId, subjectType: 'document', subjectId: documentId }),
    );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/inngest/extract-document.test.ts`
Expected: PASS — all existing tests plus the new one. (The "does NOT write case_facts" test must still pass — creating an approval is not a case-state write.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/inngest/functions/extract-document.ts tests/inngest/extract-document.test.ts
git commit -m "feat: open a pending approval when document extraction lands"
```

---

## Task 4: Extend the extraction schema with target/transform/part + load-time validation

**Files:**
- Modify: `src/lib/extraction/types.ts:3-11`
- Modify: `src/lib/extraction/schema.ts`
- Test: `tests/extraction/target-validation.test.ts`

- [ ] **Step 1: Write the failing test (pure validation function)**

Create `tests/extraction/target-validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { assertValidTargets } from '@/lib/extraction/schema';
import type { ExtractionSchema } from '@/lib/extraction/types';

describe('assertValidTargets', () => {
  it('passes when every target resolves to a real leaf path', () => {
    const schemas = new Map<string, ExtractionSchema>([
      ['passport', {
        spineItemId: 'passport',
        fields: {
          passportNumber: { type: 'string', sensitive: true, target: 'passportNumber' },
          dateOfBirth: { type: 'date', sensitive: false, target: 'dateOfBirth' },
        },
      }],
    ]);
    expect(() => assertValidTargets(schemas)).not.toThrow();
  });

  it('throws when a target is not a valid leaf path', () => {
    const schemas = new Map<string, ExtractionSchema>([
      ['passport', {
        spineItemId: 'passport',
        fields: { surname: { type: 'string', sensitive: false, target: 'profile.fullName' } },
      }],
    ]);
    // 'profile.fullName' is NOT a valid path (profile leaves resolve at the root, e.g. 'fullName').
    expect(() => assertValidTargets(schemas)).toThrow(/profile\.fullName/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/extraction/target-validation.test.ts`
Expected: FAIL — `assertValidTargets` is not exported.

- [ ] **Step 3: Extend the field spec type**

In `src/lib/extraction/types.ts`, replace the `ExtractionFieldSpec` interface:

```ts
export interface ExtractionFieldSpec {
  type: ExtractionFieldType;
  sensitive: boolean;
  // Confirm-mapping (3B): the case/profile leaf path this field writes to (bare path,
  // e.g. 'passportNumber' / 'fullName' — NOT 'profile.passportNumber'). Absent → field is
  // reviewable but never written.
  target?: string;
  // Optional named transform (registry key) applied before the write. Absent → 1:1 passthrough.
  transform?: string;
  // Discriminator for fan-in transforms (e.g. composeFullName: part='surname' | 'given').
  part?: string;
}
```

- [ ] **Step 4: Load the new keys and add the validator**

In `src/lib/extraction/schema.ts`:

Update `FieldSpecYaml`:

```ts
const FieldSpecYaml = z.object({
  type: z.enum(['string', 'date', 'number', 'boolean']),
  sensitive: z.boolean().optional().default(false),
  target: z.string().optional(),
  transform: z.string().optional(),
  part: z.string().optional(),
});
```

Update the schema build inside `load()` to carry the new keys (replace the `schemas.set(...)` block):

```ts
    if (item.extraction) {
      schemas.set(item.id, {
        spineItemId: item.id,
        fields: Object.fromEntries(
          Object.entries(item.extraction.fields).map(([k, v]) => [
            k,
            {
              type: v.type,
              sensitive: v.sensitive,
              ...(v.target ? { target: v.target } : {}),
              ...(v.transform ? { transform: v.transform } : {}),
              ...(v.part ? { part: v.part } : {}),
            },
          ]),
        ),
      });
    }
```

After building `schemas`, call the validator before caching (replace `cache = { schemas, spine }; return cache;`):

```ts
  assertValidTargets(schemas);
  cache = { schemas, spine };
  return cache;
```

Add the validator export and the import at the top of the file:

```ts
import { validateLeafPath } from '@/lib/case/paths';
```

```ts
/**
 * Fail-fast guard: every extraction-field `target` must resolve to a real case/profile
 * leaf path. A typo here would otherwise surface only at confirm-time as a write failure.
 */
export function assertValidTargets(schemas: Map<string, ExtractionSchema>): void {
  for (const [spineItemId, schema] of schemas) {
    for (const [fieldKey, spec] of Object.entries(schema.fields)) {
      if (!spec.target) continue;
      try {
        validateLeafPath(spec.target);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Invalid extraction target for ${spineItemId}.${fieldKey}: "${spec.target}" — ${msg}`,
        );
      }
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run tests/extraction/target-validation.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/extraction/types.ts src/lib/extraction/schema.ts tests/extraction/target-validation.test.ts
git commit -m "feat: extraction fields carry target/transform/part with load-time validation"
```

---

## Task 5: Wire passport targets in documents.yaml + review config

**Files:**
- Modify: `config/rules/documents.yaml` (passport `extraction.fields`)
- Create: `config/rules/review.yaml`
- Create: `src/lib/documents/review-config.ts`

- [ ] **Step 1: Add targets/transforms to the passport extraction fields**

In `config/rules/documents.yaml`, find the `passport` item's `extraction.fields` block and replace it with (note bare leaf names — NOT `profile.`-prefixed):

```yaml
    extraction:
      fields:
        surname:        { type: string, target: fullName, transform: composeFullName, part: surname }
        givenNames:     { type: string, target: fullName, transform: composeFullName, part: given }
        passportNumber: { type: string, sensitive: true, target: passportNumber }
        dateOfBirth:    { type: date,   target: dateOfBirth }
        nationality:    { type: string, target: nationality, transform: toIso2 }
        dateOfExpiry:   { type: date,   target: passportExpiry }
```

- [ ] **Step 2: Verify the extraction loader still loads (targets are valid)**

Run: `pnpm exec vitest run tests/extraction/target-validation.test.ts tests/inngest/extract-document.test.ts`
Expected: PASS. (If `assertValidTargets` throws here, a target name is wrong — the valid bare profile leaves are `fullName`, `dateOfBirth`, `placeOfBirth`, `gender`, `nationality`, `passportNumber`, `passportExpiry`, `currentAddress`.)

Note: restart `pnpm dev` after this YAML edit — the extraction schema is module-cached (CLAUDE.md gotcha).

- [ ] **Step 3: Create the review config YAML**

Create `config/rules/review.yaml`:

```yaml
schemaVersion: 1
# Confidence band thresholds for the review UI badges (rule 7: no hardcoded thresholds in code).
# A field's per-field extraction confidence >= high → green; >= low → amber; below → red.
confidenceBands:
  high: 0.9
  low: 0.7
# Minimal country-name → ISO 3166-1 alpha-2 seed. MVP is India-source; extend as needed.
# Used by the toIso2 transform. Keys are matched case-insensitively.
nationalityToIso2:
  india: IN
  indian: IN
  ind: IN
  germany: DE
  german: DE
  deu: DE
```

- [ ] **Step 4: Create the review-config loader**

Create `src/lib/documents/review-config.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';

const RULES_DIR = join(process.cwd(), 'config', 'rules');

export interface ConfidenceBands {
  high: number;
  low: number;
}

const ReviewYaml = z.object({
  schemaVersion: z.literal(1),
  confidenceBands: z.object({ high: z.number().min(0).max(1), low: z.number().min(0).max(1) }),
  nationalityToIso2: z.record(z.string(), z.string().length(2)),
});

interface Loaded {
  confidenceBands: ConfidenceBands;
  nationalityToIso2: Map<string, string>;
}

let cache: Loaded | null = null;

function load(): Loaded {
  if (cache) return cache;
  const raw = readFileSync(join(RULES_DIR, 'review.yaml'), 'utf8');
  const parsed = ReviewYaml.safeParse(yaml.load(raw));
  if (!parsed.success) throw new Error(`Invalid config/rules/review.yaml: ${parsed.error.message}`);
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(parsed.data.nationalityToIso2)) map.set(k.toLowerCase(), v.toUpperCase());
  cache = { confidenceBands: parsed.data.confidenceBands, nationalityToIso2: map };
  return cache;
}

export function getConfidenceBands(): ConfidenceBands {
  return load().confidenceBands;
}

export function getNationalityIso2Map(): Map<string, string> {
  return load().nationalityToIso2;
}

/** Test-only: clear the module cache. */
export function __resetReviewConfigCacheForTests(): void {
  cache = null;
}
```

- [ ] **Step 5: Verify it loads**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add config/rules/documents.yaml config/rules/review.yaml src/lib/documents/review-config.ts
git commit -m "feat: wire passport targets + review config (confidence bands, ISO2 seed)"
```

---

## Task 6: Transform registry

**Files:**
- Create: `src/lib/documents/transforms.ts`
- Test: `tests/documents/transforms.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/documents/transforms.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applyTransform } from '@/lib/documents/transforms';

describe('transforms', () => {
  it('composeFullName joins given + surname', () => {
    const out = applyTransform('composeFullName', [
      { key: 'surname', value: 'Sharma', part: 'surname' },
      { key: 'givenNames', value: 'Priya', part: 'given' },
    ]);
    expect(out).toBe('Priya Sharma');
  });

  it('composeFullName tolerates a missing part', () => {
    const out = applyTransform('composeFullName', [{ key: 'surname', value: 'Sharma', part: 'surname' }]);
    expect(out).toBe('Sharma');
  });

  it('composeFullName returns null when nothing usable', () => {
    expect(applyTransform('composeFullName', [{ key: 'surname', value: '', part: 'surname' }])).toBeNull();
  });

  it('toIso2 maps a known nationality name (case-insensitive)', () => {
    expect(applyTransform('toIso2', [{ key: 'nationality', value: 'India' }])).toBe('IN');
    expect(applyTransform('toIso2', [{ key: 'nationality', value: 'indian' }])).toBe('IN');
  });

  it('toIso2 passes through a valid 2-letter code', () => {
    expect(applyTransform('toIso2', [{ key: 'nationality', value: 'de' }])).toBe('DE');
  });

  it('toIso2 returns null for an unknown nationality', () => {
    expect(applyTransform('toIso2', [{ key: 'nationality', value: 'Atlantis' }])).toBeNull();
  });

  it('an unknown transform name throws', () => {
    expect(() => applyTransform('nope', [{ key: 'x', value: 'y' }])).toThrow(/unknown transform/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/documents/transforms.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the registry**

Create `src/lib/documents/transforms.ts`:

```ts
import { getNationalityIso2Map } from '@/lib/documents/review-config';

export interface TransformField {
  key: string;
  value: unknown;
  part?: string;
}

// Returns the transformed value, or null when the inputs cannot be resolved (the caller
// then leaves the field UNMAPPED so the user is forced to pick/correct rather than writing junk).
export type Transform = (fields: TransformField[]) => unknown | null;

const composeFullName: Transform = (fields) => {
  const str = (part: string) => {
    const f = fields.find((x) => x.part === part);
    const v = typeof f?.value === 'string' ? f.value.trim() : '';
    return v;
  };
  const given = str('given');
  const surname = str('surname');
  const full = [given, surname].filter(Boolean).join(' ').trim();
  return full.length > 0 ? full : null;
};

const toIso2: Transform = (fields) => {
  const raw = fields[0]?.value;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const upper = trimmed.toUpperCase();
    // Accept a 2-letter code only if it's a value we know (in the seed map's values).
    const known = new Set([...getNationalityIso2Map().values()]);
    if (known.has(upper)) return upper;
  }
  return getNationalityIso2Map().get(trimmed.toLowerCase()) ?? null;
};

const registry: Record<string, Transform> = {
  composeFullName,
  toIso2,
};

export function applyTransform(name: string, fields: TransformField[]): unknown | null {
  const fn = registry[name];
  if (!fn) throw new Error(`unknown transform: ${name}`);
  return fn(fields);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/documents/transforms.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/documents/transforms.ts tests/documents/transforms.test.ts
git commit -m "feat: add confirm-time transform registry (composeFullName, toIso2)"
```

---

## Task 7: confirm-mapping (`buildConfirmUpdates`)

**Files:**
- Create: `src/lib/documents/confirm-mapping.ts`
- Test: `tests/documents/confirm-mapping.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/documents/confirm-mapping.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildConfirmUpdates } from '@/lib/documents/confirm-mapping';

// Uses the REAL passport extraction schema from config/rules/documents.yaml.
describe('buildConfirmUpdates (passport)', () => {
  const base = [
    { key: 'surname', value: 'Sharma', edited: false },
    { key: 'givenNames', value: 'Priya', edited: false },
    { key: 'passportNumber', value: 'X1234567', edited: false },
    { key: 'dateOfBirth', value: '1990-04-12', edited: false },
    { key: 'nationality', value: 'India', edited: false },
    { key: 'dateOfExpiry', value: '2030-09-01', edited: false },
  ];

  it('maps fields to bare leaf paths with transforms applied', () => {
    const { updates, perPathSource, unmapped } = buildConfirmUpdates('passport', base);
    expect(updates).toMatchObject({
      fullName: 'Priya Sharma',
      passportNumber: 'X1234567',
      dateOfBirth: '1990-04-12',
      nationality: 'IN',
      passportExpiry: '2030-09-01',
    });
    expect(unmapped).toEqual([]);
    expect(perPathSource.passportNumber).toBe('document');
  });

  it('marks a path user_corrected when any contributing field was edited', () => {
    const fields = base.map((f) => (f.key === 'givenNames' ? { ...f, value: 'Priyanka', edited: true } : f));
    const { updates, perPathSource } = buildConfirmUpdates('passport', fields);
    expect(updates.fullName).toBe('Priyanka Sharma');
    expect(perPathSource.fullName).toBe('user_corrected');
    expect(perPathSource.passportNumber).toBe('document');
  });

  it('leaves a field unmapped when its transform cannot resolve', () => {
    const fields = base.map((f) => (f.key === 'nationality' ? { ...f, value: 'Atlantis', edited: true } : f));
    const { updates, unmapped } = buildConfirmUpdates('passport', fields);
    expect(updates.nationality).toBeUndefined();
    expect(unmapped).toContain('nationality');
  });

  it('ignores fields with no target', () => {
    const fields = [...base, { key: 'mystery', value: 'z', edited: false }];
    const { updates } = buildConfirmUpdates('passport', fields);
    expect(Object.keys(updates)).not.toContain('mystery');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/documents/confirm-mapping.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the mapper**

Create `src/lib/documents/confirm-mapping.ts`:

```ts
import { getExtractionSchema } from '@/lib/extraction/schema';
import { applyTransform } from '@/lib/documents/transforms';

export interface ReviewedField {
  key: string;
  value: unknown;
  edited: boolean;
}

export type FieldSource = 'document' | 'user_corrected';

export interface ConfirmUpdates {
  updates: Record<string, unknown>;
  perPathSource: Record<string, FieldSource>;
  unmapped: string[]; // extraction field keys that were NOT written (no target / failed transform)
}

export function buildConfirmUpdates(
  spineItemId: string | null,
  fields: ReviewedField[],
): ConfirmUpdates {
  const updates: Record<string, unknown> = {};
  const perPathSource: Record<string, FieldSource> = {};
  const unmapped: string[] = [];

  const schema = spineItemId ? getExtractionSchema(spineItemId) : null;
  if (!schema) {
    return { updates, perPathSource, unmapped: fields.map((f) => f.key) };
  }

  // Group reviewed fields by their target leaf path (fields with no target → unmapped).
  const groups = new Map<string, { reviewed: ReviewedField; part?: string; transform?: string }[]>();
  for (const f of fields) {
    const spec = schema.fields[f.key];
    if (!spec || !spec.target) {
      unmapped.push(f.key);
      continue;
    }
    const arr = groups.get(spec.target) ?? [];
    arr.push({ reviewed: f, part: spec.part, transform: spec.transform });
    groups.set(spec.target, arr);
  }

  for (const [target, members] of groups) {
    const transformName = members.find((m) => m.transform)?.transform;
    let value: unknown;
    if (transformName) {
      value = applyTransform(
        transformName,
        members.map((m) => ({ key: m.reviewed.key, value: m.reviewed.value, part: m.part })),
      );
    } else {
      // 1:1 path — exactly one contributing field.
      value = members[0]?.reviewed.value;
    }

    if (value === null || value === undefined || value === '') {
      for (const m of members) unmapped.push(m.reviewed.key);
      continue;
    }

    updates[target] = value;
    perPathSource[target] = members.some((m) => m.reviewed.edited) ? 'user_corrected' : 'document';
  }

  return { updates, perPathSource, unmapped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/documents/confirm-mapping.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/documents/confirm-mapping.ts tests/documents/confirm-mapping.test.ts
git commit -m "feat: add buildConfirmUpdates mapper (fields -> leaf paths + per-path source)"
```

---

## Task 8: Confirm/reject core + server actions

**Files:**
- Create: `src/lib/documents/confirm-core.ts`
- Create: `src/app/case/[id]/documents/[docId]/review/actions.ts`
- Test: `tests/documents/confirm-core.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/documents/confirm-core.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedAnonUser } from '../_db/seed-auth';
import { makeRepository } from '@/lib/case/repository';
import { makeDocumentRepository } from '@/lib/documents/repository';
import { makeApprovalRepository } from '@/lib/approvals/repository';
import { confirmExtractionCore, rejectExtractionCore } from '@/lib/documents/confirm-core';

let testHandle: TestDbHandle;
vi.mock('@/lib/db/client', () => ({ get db() { return testHandle.db; } }));

async function seedAwaitingDoc(caseId: string, userId: string) {
  const docs = makeDocumentRepository(testHandle.db);
  const id = await docs.insert({
    caseId, userId, r2Key: 'k', fileName: 'passport.pdf', contentType: 'application/pdf', byteSize: 3,
  });
  await docs.setStatus(id, 'uploaded');
  await docs.setExtraction(id, {
    spineItemId: 'passport',
    detectedType: 'passport',
    classification: { type: 'passport', confidence: 0.9 },
    extracted: {
      fields: {
        surname: { value: 'Sharma', confidence: 0.95 },
        givenNames: { value: 'Priya', confidence: 0.95 },
        passportNumber: { value: 'X1234567', confidence: 0.92 },
        dateOfBirth: { value: '1990-04-12', confidence: 0.9 },
        nationality: { value: 'India', confidence: 0.6 },
        dateOfExpiry: { value: '2030-09-01', confidence: 0.9 },
      },
      provider: 'anthropic_vision',
      modelVersion: 'm',
    },
  });
  await makeApprovalRepository(testHandle.db).createPending({
    caseId, userId, subjectType: 'document', subjectId: id,
  });
  return id;
}

describe('confirmExtractionCore', () => {
  let caseId: string;
  let userId: string;

  beforeAll(async () => {
    testHandle = await createTestSchema();
    userId = (await seedAnonUser(testHandle)).userId;
    const repo = makeRepository(testHandle.db, testHandle.schemaName);
    caseId = (await repo.createCase({ userId, visaType: 'blue_card', targetCountry: 'DE' })).caseId;
  }, 30_000);

  afterAll(async () => { if (testHandle) await testHandle.cleanup(); });

  function deps() {
    return {
      repo: makeRepository(testHandle.db, testHandle.schemaName),
      docs: makeDocumentRepository(testHandle.db),
      approvals: makeApprovalRepository(testHandle.db),
    };
  }

  it('writes confirmed fields to the profile at confidence 1.0 with per-field source', async () => {
    const documentId = await seedAwaitingDoc(caseId, userId);
    const res = await confirmExtractionCore(deps(), {
      documentId, caseId, userId,
      fields: [
        { key: 'surname', value: 'Sharma', edited: false },
        { key: 'givenNames', value: 'Priya', edited: false },
        { key: 'passportNumber', value: 'X1234567', edited: false },
        { key: 'dateOfBirth', value: '1990-04-12', edited: false },
        { key: 'nationality', value: 'India', edited: true }, // user picked IN from a low-confidence field
        { key: 'dateOfExpiry', value: '2030-09-01', edited: false },
      ],
    });
    expect(res.ok).toBe(true);

    const loaded = await deps().repo.loadCase(caseId);
    const p = loaded.profile!;
    expect(p.fullName?.value).toBe('Priya Sharma');
    expect(p.fullName?.confidence).toBe(1);
    expect(p.fullName?.source).toBe('document');
    expect(p.passportNumber?.value).toBe('X1234567');
    expect(p.nationality?.value).toBe('IN');
    expect(p.nationality?.source).toBe('user_corrected');

    const doc = await deps().docs.getById(documentId);
    expect(doc?.status).toBe('confirmed');
    const approval = await deps().approvals.getById(
      // re-find by listing resolved is awkward; assert no pending remains
      (await deps().approvals.listPending(caseId)).find((a) => a.subjectId === documentId)?.id ?? 'none',
    );
    expect(approval).toBeNull(); // no pending approval remains for this doc
  });

  it('is a no-op when the document is not awaiting_confirmation (double-confirm guard)', async () => {
    const documentId = await seedAwaitingDoc(caseId, userId);
    await confirmExtractionCore(deps(), { documentId, caseId, userId, fields: [
      { key: 'passportNumber', value: 'A1', edited: false },
    ] });
    const second = await confirmExtractionCore(deps(), { documentId, caseId, userId, fields: [
      { key: 'passportNumber', value: 'A2', edited: false },
    ] });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe('wrong_status');
    // The first write stands; the second value did not overwrite.
    const loaded = await deps().repo.loadCase(caseId);
    expect(loaded.profile?.passportNumber?.value).toBe('A1');
  });

  it('forbids confirming another user’s document', async () => {
    const documentId = await seedAwaitingDoc(caseId, userId);
    const other = await seedAnonUser(testHandle);
    const res = await confirmExtractionCore(deps(), {
      documentId, caseId, userId: other.userId, fields: [{ key: 'passportNumber', value: 'X', edited: false }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('forbidden');
  });

  it('rejectExtractionCore resolves rejected, sets doc rejected, writes no case state', async () => {
    const documentId = await seedAwaitingDoc(caseId, userId);
    const before = await deps().repo.loadCase(caseId);
    const res = await rejectExtractionCore(deps(), { documentId, caseId, userId, reason: 'wrong doc' });
    expect(res.ok).toBe(true);
    const doc = await deps().docs.getById(documentId);
    expect(doc?.status).toBe('rejected');
    const after = await deps().repo.loadCase(caseId);
    expect(after.profile).toEqual(before.profile); // unchanged
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/documents/confirm-core.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the core**

Create `src/lib/documents/confirm-core.ts`:

```ts
import type { Repository } from '@/lib/case/repository';
import type { DocumentRepository } from '@/lib/documents/repository';
import type { ApprovalRepository } from '@/lib/approvals/repository';
import { buildConfirmUpdates, type ReviewedField, type FieldSource } from '@/lib/documents/confirm-mapping';

export interface ConfirmDeps {
  repo: Repository;
  docs: DocumentRepository;
  approvals: ApprovalRepository;
}

export interface ConfirmInput {
  documentId: string;
  caseId: string;
  userId: string;
  fields: ReviewedField[];
}

export type ConfirmError = 'not_found' | 'forbidden' | 'wrong_status' | 'validation';

export type ConfirmResult =
  | { ok: true; updatedPaths: string[]; unmapped: string[] }
  | { ok: false; error: ConfirmError; message?: string };

async function loadOwnedAwaitingDoc(deps: ConfirmDeps, input: ConfirmInput) {
  const doc = await deps.docs.getById(input.documentId);
  if (!doc || doc.caseId !== input.caseId) return { error: 'not_found' as const };
  if (doc.userId !== input.userId) return { error: 'forbidden' as const };
  if (doc.status !== 'awaiting_confirmation') return { error: 'wrong_status' as const };
  return { doc };
}

export async function confirmExtractionCore(deps: ConfirmDeps, input: ConfirmInput): Promise<ConfirmResult> {
  const loaded = await loadOwnedAwaitingDoc(deps, input);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { doc } = loaded;

  const { updates, perPathSource, unmapped } = buildConfirmUpdates(doc.spineItemId, input.fields);

  // Group paths by source → at most two applyUpdate calls (zero change to applyUpdate itself).
  const bySource: Record<FieldSource, Record<string, unknown>> = { document: {}, user_corrected: {} };
  for (const [path, value] of Object.entries(updates)) {
    bySource[perPathSource[path] ?? 'document'][path] = value;
  }

  const confirmedPaths: string[] = [];
  const editedPaths: string[] = [];
  try {
    for (const source of ['document', 'user_corrected'] as const) {
      const group = bySource[source];
      if (Object.keys(group).length === 0) continue;
      const result = await deps.repo.applyUpdate({
        caseId: input.caseId,
        source,
        sourceTurnId: null,
        confidence: 1.0,
        updates: group,
      });
      for (const p of result.updatedPaths) {
        confirmedPaths.push(p);
        if (source === 'user_corrected') editedPaths.push(p);
      }
    }
  } catch (err) {
    // A leaf value failed Zod validation in applyUpdate — surface as a field-level error,
    // NOT a crash. Nothing downstream has run, so the approval/doc stay reviewable for retry.
    return { ok: false, error: 'validation', message: err instanceof Error ? err.message : String(err) };
  }

  const approval = await deps.approvals.getBySubject('document', input.documentId);
  if (approval) {
    await deps.approvals.resolve(approval.id, {
      status: 'approved',
      decision: { confirmedPaths, editedPaths, rejectedReason: null },
      resolvedBy: input.userId,
    });
  }

  await deps.docs.setStatus(input.documentId, 'confirmed');

  // PII-safe audit row: leaf KEYS only, never values.
  await deps.repo.appendActivity({
    caseId: input.caseId,
    userId: input.userId,
    kind: 'case.approval.resolved',
    payload: { subjectType: 'document', subjectId: input.documentId, status: 'approved', confirmedPaths, editedPaths },
  });

  return { ok: true, updatedPaths: confirmedPaths, unmapped };
}

export interface RejectInput {
  documentId: string;
  caseId: string;
  userId: string;
  reason?: string;
}

export async function rejectExtractionCore(deps: ConfirmDeps, input: RejectInput): Promise<ConfirmResult> {
  const loaded = await loadOwnedAwaitingDoc(deps, input);
  if ('error' in loaded) return { ok: false, error: loaded.error };

  const approval = await deps.approvals.getBySubject('document', input.documentId);
  if (approval) {
    await deps.approvals.resolve(approval.id, {
      status: 'rejected',
      decision: { confirmedPaths: [], editedPaths: [], rejectedReason: input.reason ?? null },
      resolvedBy: input.userId,
    });
  }
  await deps.docs.setStatus(input.documentId, 'rejected');
  await deps.repo.appendActivity({
    caseId: input.caseId,
    userId: input.userId,
    kind: 'case.approval.resolved',
    payload: { subjectType: 'document', subjectId: input.documentId, status: 'rejected' },
  });
  return { ok: true, updatedPaths: [], unmapped: [] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/documents/confirm-core.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Create the server-action wrappers**

Create `src/app/case/[id]/documents/[docId]/review/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAuthedUserId } from '@/lib/auth/session';
import { makeRepository } from '@/lib/case/repository';
import { makeDocumentRepository } from '@/lib/documents/repository';
import { makeApprovalRepository } from '@/lib/approvals/repository';
import {
  confirmExtractionCore,
  rejectExtractionCore,
  type ConfirmError,
} from '@/lib/documents/confirm-core';
import type { ReviewedField } from '@/lib/documents/confirm-mapping';

export interface ReviewActionState {
  error?: ConfirmError;
  message?: string;
}

function deps() {
  return {
    repo: makeRepository(),
    docs: makeDocumentRepository(),
    approvals: makeApprovalRepository(),
  };
}

export async function confirmExtraction(input: {
  documentId: string;
  caseId: string;
  fields: ReviewedField[];
}): Promise<ReviewActionState> {
  const userId = await requireAuthedUserId();
  const res = await confirmExtractionCore(deps(), { ...input, userId });
  if (!res.ok) return { error: res.error, message: res.message };
  revalidatePath(`/case/${input.caseId}`);
  redirect(`/case/${input.caseId}`); // throws NEXT_REDIRECT — must NOT be inside a try/catch
}

export async function rejectExtraction(input: {
  documentId: string;
  caseId: string;
  reason?: string;
}): Promise<ReviewActionState> {
  const userId = await requireAuthedUserId();
  const res = await rejectExtractionCore(deps(), { ...input, userId });
  if (!res.ok) return { error: res.error, message: res.message };
  revalidatePath(`/case/${input.caseId}`);
  redirect(`/case/${input.caseId}`);
}
```

- [ ] **Step 6: Verify it compiles**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/documents/confirm-core.ts src/app/case/[id]/documents/[docId]/review/actions.ts tests/documents/confirm-core.test.ts
git commit -m "feat: confirm/reject extraction core + server actions"
```

---

## Task 9: Review route (RSC) + view-model + ReviewForm

**Files:**
- Create: `src/lib/documents/confidence.ts`
- Test: `tests/documents/confidence.test.ts`
- Create: `src/lib/documents/review-view-model.ts`
- Create: `src/app/case/[id]/documents/[docId]/review/page.tsx`
- Create: `src/app/case/[id]/documents/[docId]/review/ReviewForm.tsx`

- [ ] **Step 1: Write the failing test for confidence classification**

Create `tests/documents/confidence.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyConfidence } from '@/lib/documents/confidence';

const bands = { high: 0.9, low: 0.7 };

describe('classifyConfidence', () => {
  it('classifies by band', () => {
    expect(classifyConfidence(0.95, bands)).toBe('high');
    expect(classifyConfidence(0.9, bands)).toBe('high');
    expect(classifyConfidence(0.8, bands)).toBe('mid');
    expect(classifyConfidence(0.7, bands)).toBe('mid');
    expect(classifyConfidence(0.5, bands)).toBe('low');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/documents/confidence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement classifyConfidence (pure, client-safe — no fs)**

Create `src/lib/documents/confidence.ts`:

```ts
import type { ConfidenceBands } from '@/lib/documents/review-config';

export type ConfidenceLevel = 'high' | 'mid' | 'low';

export function classifyConfidence(score: number, bands: ConfidenceBands): ConfidenceLevel {
  if (score >= bands.high) return 'high';
  if (score >= bands.low) return 'mid';
  return 'low';
}
```

(Importing the `ConfidenceBands` *type* from `review-config` is type-only and erases at build — it does not pull the fs loader into a client bundle.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/documents/confidence.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the view-model builder**

Create `src/lib/documents/review-view-model.ts`:

```ts
import type { ExtractionSchema } from '@/lib/extraction/types';
import type { ConfidenceBands } from '@/lib/documents/review-config';
import { classifyConfidence, type ConfidenceLevel } from '@/lib/documents/confidence';

export interface ReviewRow {
  key: string;
  label: string;
  value: string;
  confidence: number;
  level: ConfidenceLevel;
  sensitive: boolean;
  mapped: boolean; // false → reviewable but not written (no target)
}

export interface ExtractedFieldsView {
  [key: string]: { value: unknown; confidence: number };
}

function labelFor(key: string): string {
  // Humanize a camelCase extraction key: 'dateOfExpiry' → 'Date Of Expiry'.
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

export function buildReviewRows(
  fields: ExtractedFieldsView,
  schema: ExtractionSchema | null,
  bands: ConfidenceBands,
): ReviewRow[] {
  return Object.entries(fields).map(([key, f]) => {
    const spec = schema?.fields[key];
    return {
      key,
      label: labelFor(key),
      value: f.value == null ? '' : String(f.value),
      confidence: f.confidence,
      level: classifyConfidence(f.confidence, bands),
      sensitive: spec?.sensitive ?? false,
      mapped: Boolean(spec?.target),
    };
  });
}
```

- [ ] **Step 6: Create the RSC review page**

Create `src/app/case/[id]/documents/[docId]/review/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/auth/session';
import { makeDocumentRepository } from '@/lib/documents/repository';
import { makeR2StorageAdapter } from '@/lib/storage/r2';
import { getExtractionSchema } from '@/lib/extraction/schema';
import { getConfidenceBands } from '@/lib/documents/review-config';
import { buildReviewRows } from '@/lib/documents/review-view-model';
import { ReviewForm } from './ReviewForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string; docId: string }>;
}) {
  const { id: caseId, docId } = await params;
  const userId = await getCurrentUserId();
  if (!userId) redirect('/signin');

  const docs = makeDocumentRepository();
  const doc = await docs.getById(docId);
  if (!doc || doc.caseId !== caseId) notFound();
  if (doc.userId !== userId) redirect('/');
  if (doc.status !== 'awaiting_confirmation') redirect(`/case/${caseId}`);

  const sourceUrl = await makeR2StorageAdapter().presignDownload(doc.r2Key);
  const schema = doc.spineItemId ? getExtractionSchema(doc.spineItemId) : null;
  const rows = buildReviewRows(doc.extracted?.fields ?? {}, schema, getConfidenceBands());

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <a href={`/case/${caseId}`} className="text-xs text-zinc-500 hover:underline">
        ← Back to case
      </a>
      <h1 className="mt-2 mb-4 text-lg font-medium text-zinc-900">Review extracted details</h1>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <section className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <div className="mb-2 text-xs font-medium text-zinc-500">Source document</div>
          {doc.contentType.startsWith('image/') ? (
            // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL, not a static asset
            <img src={sourceUrl} alt={doc.fileName} className="max-h-[70vh] w-full object-contain" />
          ) : (
            <object data={sourceUrl} type={doc.contentType} className="h-[70vh] w-full">
              <a href={sourceUrl} target="_blank" rel="noreferrer" className="text-sm text-blue-600 underline">
                Open original ↗
              </a>
            </object>
          )}
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block text-xs text-blue-600 underline"
          >
            Open original ↗
          </a>
        </section>
        <ReviewForm caseId={caseId} documentId={docId} rows={rows} />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Create the ReviewForm client component**

Create `src/app/case/[id]/documents/[docId]/review/ReviewForm.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import type { ReviewRow } from '@/lib/documents/review-view-model';
import { confirmExtraction, rejectExtraction } from './actions';

const LEVEL_STYLES: Record<ReviewRow['level'], string> = {
  high: 'bg-green-100 text-green-800',
  mid: 'bg-amber-100 text-amber-800',
  low: 'bg-red-100 text-red-800',
};

export function ReviewForm({
  caseId,
  documentId,
  rows,
}: {
  caseId: string;
  documentId: string;
  rows: ReviewRow[];
}) {
  const initial = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [showSensitive, setShowSensitive] = useState<Record<string, boolean>>({});
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    const fields = rows
      .filter((r) => r.mapped)
      .map((r) => ({ key: r.key, value: values[r.key], edited: values[r.key] !== r.value }));
    startTransition(async () => {
      const res = await confirmExtraction({ caseId, documentId, fields });
      // On success the action redirects; only an error state returns here.
      if (res?.error) setError(res.message ?? 'Could not save. Please check the highlighted fields.');
    });
  }

  function reject() {
    setError(null);
    startTransition(async () => {
      const res = await rejectExtraction({ caseId, documentId });
      if (res?.error) setError(res.message ?? 'Could not dismiss.');
    });
  }

  return (
    <section className="rounded-md border border-zinc-200 bg-white p-3">
      <div className="mb-2 text-xs font-medium text-zinc-500">Extracted fields — review &amp; correct</div>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.key}>
            <div className="flex items-center justify-between">
              <label htmlFor={`f-${r.key}`} className="text-xs text-zinc-600">
                {r.label}
                {!r.mapped && <span className="ml-1 text-zinc-400">(not saved)</span>}
              </label>
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${LEVEL_STYLES[r.level]}`}>
                {Math.round(r.confidence * 100)}%
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <input
                id={`f-${r.key}`}
                type={r.sensitive && !showSensitive[r.key] ? 'password' : 'text'}
                value={values[r.key] ?? ''}
                disabled={!r.mapped}
                onChange={(e) => setValues((v) => ({ ...v, [r.key]: e.target.value }))}
                className="w-full rounded border border-zinc-300 px-2 py-1 text-sm disabled:bg-zinc-100 disabled:text-zinc-400"
              />
              {r.sensitive && (
                <button
                  type="button"
                  onClick={() => setShowSensitive((s) => ({ ...s, [r.key]: !s[r.key] }))}
                  className="text-xs text-zinc-500 hover:underline"
                >
                  {showSensitive[r.key] ? 'hide' : 'show'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-zinc-500">Confirming saves these to your case.</p>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}

      <div className="mt-3 flex items-center justify-between">
        <button type="button" onClick={reject} disabled={pending} className="text-xs text-zinc-500 hover:underline">
          Reject
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Confirm & save'}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 8: Verify everything compiles and lints**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

Run: `pnpm exec eslint src/app/case/\[id\]/documents src/lib/documents`
Expected: PASS (no errors).

- [ ] **Step 9: Commit**

```bash
git add src/lib/documents/confidence.ts src/lib/documents/review-view-model.ts tests/documents/confidence.test.ts "src/app/case/[id]/documents"
git commit -m "feat: document review route with source preview + editable fields"
```

---

## Task 10: Renderer deep link + terminal states

**Files:**
- Modify: `src/components/workspace/renderers/registry.tsx` (`DocumentExtractionStatus`)

- [ ] **Step 1: Update the renderer**

In `src/components/workspace/renderers/registry.tsx`, replace the `DocumentExtractionStatus` renderer:

```tsx
export const DocumentExtractionStatus: Renderer = ({ output }) => {
  const data = output.data as {
    documentId: string;
    caseId?: string;
    fileName?: string;
    status?: string;
  };
  const name = data.fileName ?? 'document';

  if (data.status === 'awaiting_confirmation' && data.caseId) {
    return (
      <span className="block rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">
        {name} is ready —{' '}
        <a
          href={`/case/${data.caseId}/documents/${data.documentId}/review`}
          className="text-blue-600 underline"
        >
          Review &amp; confirm
        </a>
      </span>
    );
  }

  if (data.status === 'confirmed') {
    return <span className="block px-2 py-1 text-xs text-green-700">✓ Added to your case</span>;
  }

  if (data.status === 'rejected') {
    return <span className="block px-2 py-1 text-xs text-zinc-400">Dismissed</span>;
  }

  return (
    <span className="block rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">
      Processing {name}…
    </span>
  );
};
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

Note: this renderer currently has no live emitter (the working status path is the `DocumentUpload` polling card, per the 3A write-up). The deep link is wired here so a future emitter (3C Documents section) lights it up; the review route is independently reachable via direct URL today.

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace/renderers/registry.tsx
git commit -m "feat: extraction-status renderer deep-links to review + terminal states"
```

---

## Task 11: Full verification

- [ ] **Step 1: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 2: Lint**

Run: `pnpm exec eslint .`
Expected: PASS, no errors.

- [ ] **Step 3: Full test suite (serial — see EMAXPOOLSREACHED gotcha)**

Run: `pnpm exec vitest run --no-file-parallelism`
Expected: PASS — all prior tests plus the new 3B tests green. Confirm the persona suite is still green (additive change).

- [ ] **Step 4: Manual smoke (optional but recommended)**

If R2 + a provider are provisioned: with `pnpm dev` + `npx inngest-cli@latest dev` running, upload a passport via the chat composer uploader, wait for `awaiting_confirmation`, then visit `/case/<id>/documents/<docId>/review`, correct a field, and Confirm. Verify the tracker reflects the new identity facts on `/case/<id>`.

- [ ] **Step 5: Final commit (if any uncommitted verification fixes)**

```bash
git add -A
git commit -m "chore: phase 3B verification pass"
```

---

## Self-review checklist (completed by plan author)

**Spec coverage:**
- §5 approvals primitive → Tasks 1, 2 (table, types, repo). ✓
- §5.4 workflow create-approval step → Task 3. ✓
- §6 field mapping + transforms → Tasks 4, 5, 6, 7. ✓
- §7 confirm/reject actions + ≤2-call split + ordering → Task 8 (`confirmExtractionCore` groups by source, two `applyUpdate` calls; write → resolve → setStatus order). ✓
- §8 review route (RSC + form, preview, confidence badges, sensitive, unmapped) → Task 9. ✓
- §9.1 renderer deep link + terminal states → Task 10. ✓
- §9.2 tests (mapping, transforms, approvals repo, confirm round-trip incl. reject + double-confirm guard, create-approval step, target validation) → Tasks 2,3,4,6,7,8,9. ✓
- §9.3 error handling (validation → field error not 500; idempotent retry; double-confirm guard) → Task 8 core + test. ✓
- §11 rules: single write path (applyUpdate), confidence 1.0 + per-field source, PII keys-only audit, mutable approvals + activity audit. ✓

**Placeholder scan:** none — every code step shows complete code.

**Type consistency:** `ReviewedField`/`FieldSource` defined in `confirm-mapping.ts`, imported by `confirm-core.ts` and `actions.ts`. `ConfidenceBands` defined in `review-config.ts`, type-imported by `confidence.ts`/`review-view-model.ts`. `ApprovalDecision` defined in `approvals/types.ts`, used by schema + repo. `ConfirmResult`/`ConfirmError` consistent across core + actions. ✓

**Known deviation from spec (intentional, corrected):** spec §5.2/§6.1 wrote leaf paths as `profile.fullName`; the implementation uses BARE paths (`fullName`) because `validateLeafPath` resolves profile leaves at the root. Flagged in the CRITICAL grounding notes and the spec will be patched.
