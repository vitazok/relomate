# Phase 1B-3 — Chat + Workspace + Inngest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the runtime spine: a 3-column workspace at `/case/[id]`, an AI SDK v5 streaming chat that registers `update_case` as the only tool, and an Inngest webhook with one trivial echo function. After this phase ships, Phase 2 plugs in real tools and the real system prompt without touching this plumbing.

**Architecture:** Next.js 16 App Router with Server Components for the workspace shell, one client island for chat. Streaming via AI SDK v5 (`streamText` + `useChat`). Persistence in two independent transactions per turn (tool-side `update_case`, chat-side `appendChatTurn`). Inngest emit fired from the chat route's `onFinish` after persistence commits. Single Anthropic client; system prompt + tool both carry ephemeral cache breakpoints.

**Tech Stack:** Next.js 16, React 19, AI SDK v5 (`ai@5.0.192`), `@ai-sdk/react`, `@ai-sdk/anthropic`, `inngest`, `inngest/next`, Tailwind 4, shadcn/ui, Drizzle, Postgres (Supabase EU), Vitest.

**Spec:** `docs/superpowers/specs/2026-05-28-phase-1b-3-chat-workspace-design.md`. This plan implements that spec verbatim. When in doubt about *what* to build, the spec is canonical; when in doubt about *how* to build it task-by-task, this plan is.

---

## Conventions used by every task

- **TDD:** failing test → minimal implementation → passing test → commit. Skip the test step only when explicitly noted (UI components and route adapters that the manual smoke covers).
- **Test infra:** the existing `tests/_db/setup.ts` (per-file Postgres test schemas), `tests/_db/seed.ts` (`seedOrgAndUser`), and `tests/_db/seed-auth.ts` (`seedAnonUser`, `seedCaseFor`) are reused throughout.
- **DB writes from new modules** follow the lazy-default pattern from `src/lib/case/repository.ts` so tests can pass a schema-scoped `db` without triggering env validation at import time.
- **Commit messages:** conventional commits (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`). Co-Authored-By footer added by tooling — don't write it manually.
- **Verification commands:** `pnpm test` (full suite), `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`. Run all four before pushing.
- **Anthropic key:** every task that touches `streamText` adds `ANTHROPIC_API_KEY` to `.env.test.local` (any non-empty string is accepted by the Zod schema; we mock `streamText` in tests so the key is never validated against Anthropic).

---

## Task 1 — Add deps, install shadcn, scaffold prompts dir

**Files:**
- Modify: `package.json` (add `@ai-sdk/anthropic`, `@ai-sdk/react`, `inngest`)
- Modify: `pnpm-workspace.yaml` (add any allowBuilds entries the install requests)
- Create: `prompts/agent/v0-stub.md`
- Create: `src/components/ui/.gitkeep` (shadcn target dir)
- Modify: `components.json` (created by `shadcn init`)
- Modify: `src/app/globals.css` (Tailwind 4 `@theme` block from shadcn init)
- Modify: `tsconfig.json` (shadcn init may add a path alias — only accept if it does not conflict with the existing `@/*` alias)
- Modify: `.env.test.local` and `.env.local.example` (add the three new env keys)

- [ ] **Step 1: Add the AI SDK + Inngest deps**

```bash
pnpm add @ai-sdk/anthropic @ai-sdk/react inngest
```

Check that `package.json` ends up with these in `dependencies` and `pnpm-lock.yaml` updates. If pnpm warns about build scripts (e.g. `inngest`'s native deps), add them to `pnpm-workspace.yaml` under `allowBuilds:` (CLAUDE.md gotcha — it's `allowBuilds`, not `onlyBuiltDependencies`).

- [ ] **Step 2: Init shadcn for Tailwind 4**

shadcn's init is interactive. Run it with `--yes` to accept all defaults, then verify the generated `components.json`:

```bash
pnpm dlx shadcn@latest init --yes
```

Open `components.json` and confirm:
- `"style": "new-york"` (or `"default"` — either is fine).
- `"rsc": true`.
- `"tailwind": { "config": "" }` (Tailwind 4 mode — config goes into `globals.css` `@theme`).
- `"aliases": { "components": "@/components", "utils": "@/lib/utils" }`.

If any value differs (e.g., shadcn defaults to a different alias), edit the file to match.

Open `src/app/globals.css` and confirm shadcn injected an `@theme` block with CSS variables for colors. If the existing globals.css used a different Tailwind 3 directive style, reconcile by keeping the shadcn-generated `@theme` block.

- [ ] **Step 3: Add the four shadcn primitives**

```bash
pnpm dlx shadcn@latest add button card scroll-area input
```

Confirm `src/components/ui/{button,card,scroll-area,input}.tsx` were created. Each pulls in its Radix peer dep transitively.

- [ ] **Step 4: Create the system-prompt stub**

Create `prompts/agent/v0-stub.md` with this exact content:

```
You are a case-management assistant for German Blue Card applications.

Your only available tool is `update_case`. Call it whenever the user mentions
a fact about themselves: their employment, education, family, current location.

Use dotted paths like `employment.annualGrossSalaryEur`, `employment.employerName`,
`education.degreeCountry`, `education.anabinStatus`, `nationality`.

Do not quote thresholds, fees, or processing times. Do not give legal advice.
This is a stub for development; the real system prompt arrives in Phase 2.
```

- [ ] **Step 5: Add new env keys**

Modify `.env.local.example` (create if missing) to include:

```
ANTHROPIC_API_KEY=
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
```

Modify `.env.test.local` to include `ANTHROPIC_API_KEY=test-key-not-validated`. Inngest keys can stay empty for tests.

- [ ] **Step 6: Verify everything still builds**

Run:
```bash
pnpm exec tsc --noEmit
pnpm test
```

Expected: clean. The new components.json/globals.css changes shouldn't break TS; tests don't import from `src/components/ui/*` yet.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: add AI SDK v5 + Inngest deps; init shadcn for Tailwind 4; add v0-stub prompt"
```

---

## Task 2 — Extend env schema with the three new keys

**Files:**
- Modify: `src/lib/env.ts`
- Test: `tests/env.test.ts` (extend existing)

- [ ] **Step 1: Read the existing env.ts pattern**

The file already declares `optionalString` / `optionalUrl` helpers and a `superRefine` that requires production-only keys. We mirror that pattern for Inngest, and add `ANTHROPIC_API_KEY` as required-everywhere.

- [ ] **Step 2: Write the failing test cases**

Open `tests/env.test.ts` and add three new test cases inside the existing `describe`:

```ts
it('rejects missing ANTHROPIC_API_KEY in any environment', () => {
  const result = parseEnv({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgres://localhost:5432/db',
    AUTH_SECRET: 'a'.repeat(32),
  });
  expect(result.ok).toBe(false);
  expect(result.errors?.some((e) => e.path.includes('ANTHROPIC_API_KEY'))).toBe(true);
});

it('accepts missing INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY in development', () => {
  const result = parseEnv({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgres://localhost:5432/db',
    AUTH_SECRET: 'a'.repeat(32),
    ANTHROPIC_API_KEY: 'sk-ant-test',
  });
  expect(result.ok).toBe(true);
});

it('rejects missing INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY in production', () => {
  const result = parseEnv({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://localhost:5432/db',
    AUTH_SECRET: 'a'.repeat(32),
    ANTHROPIC_API_KEY: 'sk-ant-test',
    AUTH_RESEND_KEY: 're_test',
    EMAIL_FROM: 'noreply@example.com',
    AUTH_URL: 'https://example.com',
  });
  expect(result.ok).toBe(false);
  expect(result.errors?.some((e) => e.path.includes('INNGEST_EVENT_KEY'))).toBe(true);
  expect(result.errors?.some((e) => e.path.includes('INNGEST_SIGNING_KEY'))).toBe(true);
});
```

If the existing `env.test.ts` does not already export a `parseEnv` test helper, refactor `src/lib/env.ts` to export the schema (already exported as `EnvSchema` if needed) and add a tiny `parseEnv(input)` helper inside `tests/env.test.ts`:

```ts
function parseEnv(input: Record<string, unknown>) {
  const result = EnvSchema.safeParse(input);
  return { ok: result.success, errors: result.success ? undefined : result.error.issues };
}
```

If `EnvSchema` isn't already exported from `src/lib/env.ts`, export it now (one-line change).

- [ ] **Step 3: Run tests, expect failure**

```bash
pnpm test tests/env.test.ts
```

Expected: the three new tests fail (current schema lacks the new fields).

- [ ] **Step 4: Add the three keys to `EnvSchema`**

Modify `src/lib/env.ts`:

```ts
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().url(),
    DIRECT_URL: optionalUrl,
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 chars'),
    AUTH_URL: optionalUrl,
    AUTH_RESEND_KEY: optionalString,
    EMAIL_FROM: optionalEmail,
    ANTHROPIC_API_KEY: z.string().min(1),
    INNGEST_EVENT_KEY: optionalString,
    INNGEST_SIGNING_KEY: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      // ...existing AUTH_RESEND_KEY / EMAIL_FROM / AUTH_URL checks...
      if (!env.INNGEST_EVENT_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['INNGEST_EVENT_KEY'],
          message: 'INNGEST_EVENT_KEY is required in production',
        });
      }
      if (!env.INNGEST_SIGNING_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['INNGEST_SIGNING_KEY'],
          message: 'INNGEST_SIGNING_KEY is required in production',
        });
      }
    }
  });
```

If `EnvSchema` was internal, also export it: `export const EnvSchema = z.object({...}).superRefine(...);`

- [ ] **Step 5: Run tests, expect pass**

```bash
pnpm test tests/env.test.ts
```

All three new tests + existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/env.ts tests/env.test.ts
git commit -m "feat: add ANTHROPIC_API_KEY + Inngest env keys"
```

---

## Task 3 — Anthropic provider singleton + system-prompt loader

**Files:**
- Create: `src/lib/ai/provider.ts`
- Create: `src/lib/ai/chat/system-prompt.ts`
- Test: `tests/ai/system-prompt.test.ts`

- [ ] **Step 1: Write the failing test for system-prompt loader**

Create `tests/ai/system-prompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { systemPrompt, PROMPT_VERSION } from '@/lib/ai/chat/system-prompt';

describe('system prompt loader', () => {
  it('exposes the v0-stub.md content as a constant string', () => {
    const onDisk = readFileSync(
      join(process.cwd(), 'prompts/agent/v0-stub.md'),
      'utf8',
    );
    expect(systemPrompt).toBe(onDisk);
  });

  it('exposes a version constant for activity logs', () => {
    expect(PROMPT_VERSION).toBe('v0-stub');
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm test tests/ai/system-prompt.test.ts
```

Expected: cannot resolve `@/lib/ai/chat/system-prompt`.

- [ ] **Step 3: Implement the loader**

Create `src/lib/ai/chat/system-prompt.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PROMPT_VERSION = 'v0-stub';

export const systemPrompt: string = readFileSync(
  join(process.cwd(), 'prompts/agent/v0-stub.md'),
  'utf8',
);
```

- [ ] **Step 4: Implement the Anthropic provider singleton**

Create `src/lib/ai/provider.ts`:

```ts
import { createAnthropic } from '@ai-sdk/anthropic';
import { env } from '@/lib/env';

export const anthropic = createAnthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

export const MODEL_ID = 'claude-sonnet-4-7';
```

(No test for `provider.ts` — it's a thin wrapper. Tests that need to mock the model call mock `streamText` from `ai`, not the provider.)

- [ ] **Step 5: Run tests, expect pass**

```bash
pnpm test tests/ai/system-prompt.test.ts
pnpm exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/provider.ts src/lib/ai/chat/system-prompt.ts tests/ai/system-prompt.test.ts
git commit -m "feat: anthropic provider + system-prompt v0-stub loader"
```

---

## Task 4 — `buildAgentContext` stub

**Files:**
- Create: `src/lib/ai/chat/context-builder.ts`
- Test: `tests/ai/context-builder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ai/context-builder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildAgentContext } from '@/lib/ai/chat/context-builder';
import type { CaseFacts } from '@/lib/case/schema';

describe('buildAgentContext (stub)', () => {
  it('returns caseFactsJson as JSON.stringify of the input', async () => {
    const caseFacts: CaseFacts = {} as CaseFacts;
    const ctx = await buildAgentContext({ caseId: 'c1', caseFacts });
    expect(ctx.caseFactsJson).toBe(JSON.stringify(caseFacts));
  });

  it('preserves nested values verbatim', async () => {
    const caseFacts = { employment: { employerName: { value: 'Acme', source: 'user_stated', confidence: 0.9, sourceTurnId: 't1', updatedAt: '2026-05-28' } } } as unknown as CaseFacts;
    const ctx = await buildAgentContext({ caseId: 'c1', caseFacts });
    expect(JSON.parse(ctx.caseFactsJson)).toEqual(caseFacts);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm test tests/ai/context-builder.test.ts
```

- [ ] **Step 3: Implement the stub**

Create `src/lib/ai/chat/context-builder.ts`:

```ts
import type { CaseFacts } from '@/lib/case/schema';

export interface AgentContext {
  caseFactsJson: string;
}

export async function buildAgentContext(input: {
  caseId: string;
  caseFacts: CaseFacts;
}): Promise<AgentContext> {
  return { caseFactsJson: JSON.stringify(input.caseFacts) };
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm test tests/ai/context-builder.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/chat/context-builder.ts tests/ai/context-builder.test.ts
git commit -m "feat: buildAgentContext stub returns caseFactsJson"
```

---

## Task 5 — Refactor `update_case` tool factory to take defaults

**Files:**
- Modify: `src/lib/ai/tools/update_case.ts`
- Modify: `src/lib/case/types.ts` (add LLM-facing schema)
- Modify: `tests/ai/update_case.test.ts`

- [ ] **Step 1: Add `UpdateCaseInputSchemaForLLM` to `src/lib/case/types.ts`**

```ts
export const UpdateCaseInputSchemaForLLM = UpdateCaseInputSchema.omit({
  caseId: true,
  sourceTurnId: true,
});
export type UpdateCaseInputForLLM = z.infer<typeof UpdateCaseInputSchemaForLLM>;
```

- [ ] **Step 2: Update the existing `tests/ai/update_case.test.ts`**

Change the three tests so the factory accepts a `defaults` argument and the tool's input no longer includes `caseId` / `sourceTurnId`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { makeUpdateCaseTool } from '@/lib/ai/tools/update_case';

const defaults = {
  defaultCaseId: 'c0000000-0000-4000-8000-000000000000',
  defaultSourceTurnId: 't0000000-0000-4000-8000-000000000000',
};

describe('update_case tool adapter', () => {
  it('exposes a Vercel AI SDK tool with description and zod input', () => {
    const tool = makeUpdateCaseTool({ applyUpdate: vi.fn() }, defaults);
    expect(typeof tool.description).toBe('string');
    expect((tool.description ?? '').length).toBeGreaterThan(40);
    expect(tool.inputSchema).toBeDefined();
  });

  it('calls repository.applyUpdate with the route-injected caseId + sourceTurnId', async () => {
    const applyUpdate = vi.fn().mockResolvedValue({
      caseId: defaults.defaultCaseId,
      updatedPaths: ['employment.annualGrossSalaryEur'],
      contradictions: [],
    });
    const tool = makeUpdateCaseTool({ applyUpdate }, defaults);
    if (!tool.execute) throw new Error('expected execute on tool');

    const out = await tool.execute(
      {
        source: 'user_stated',
        confidence: 0.9,
        updates: { 'employment.annualGrossSalaryEur': 48500 },
      },
      {} as never,
    );

    expect(applyUpdate).toHaveBeenCalledOnce();
    const call = applyUpdate.mock.calls[0][0];
    expect(call.caseId).toBe(defaults.defaultCaseId);
    expect(call.sourceTurnId).toBe(defaults.defaultSourceTurnId);
    expect(out).toEqual({
      type: 'update_case_result',
      version: 1,
      data: {
        caseId: defaults.defaultCaseId,
        updatedPaths: ['employment.annualGrossSalaryEur'],
        contradictions: [],
      },
    });
  });

  it('LLM-facing schema does not accept caseId or sourceTurnId', () => {
    const applyUpdate = vi.fn();
    const tool = makeUpdateCaseTool({ applyUpdate }, defaults);
    const schema = tool.inputSchema as { safeParse: (v: unknown) => { success: boolean; data?: unknown } };
    const result = schema.safeParse({
      caseId: 'c0000000-0000-4000-8000-000000000000',
      source: 'user_stated',
      confidence: 0.9,
      updates: { 'employment.annualGrossSalaryEur': 48500 },
    });
    // Zod's `.omit()` produces a schema that strips unknown keys by default;
    // assert that the parsed result doesn't carry caseId through.
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).caseId).toBeUndefined();
  });

  it('exposes anthropic ephemeral cacheControl on providerOptions', () => {
    const tool = makeUpdateCaseTool({ applyUpdate: vi.fn() }, defaults);
    expect(tool.providerOptions?.anthropic).toEqual({ cacheControl: { type: 'ephemeral' } });
  });
});
```

- [ ] **Step 3: Run tests, expect failure**

```bash
pnpm test tests/ai/update_case.test.ts
```

Expected failures: `defaults` arg unknown, `providerOptions` missing, schema still requires `caseId`.

- [ ] **Step 4: Refactor `src/lib/ai/tools/update_case.ts`**

```ts
import { tool } from 'ai';
import {
  UpdateCaseInputSchemaForLLM,
  type UpdateCaseInputForLLM,
  type UpdateCaseResult,
} from '@/lib/case/types';
import type { Repository } from '@/lib/case/repository';

const description = [
  'Persist one or more leaf-level updates to the case facts or user profile.',
  'Updates is a flat object whose keys are dotted paths into the case/profile tree',
  '(e.g. "employment.annualGrossSalaryEur", "education.anabinStatus", "nationality").',
  'All updates in one call share a single source/confidence.',
  'Returns the list of updated paths and any contradictions detected against existing values.',
  'NEVER pass year-specific thresholds, fees, or processing times via this tool.',
  'NEVER fabricate paths — if you are unsure, ask the user instead of guessing.',
].join(' ');

export interface UpdateCaseToolDefaults {
  defaultCaseId: string;
  defaultSourceTurnId: string;
}

export function makeUpdateCaseTool(
  repo: Pick<Repository, 'applyUpdate'>,
  defaults: UpdateCaseToolDefaults,
) {
  return tool({
    description,
    inputSchema: UpdateCaseInputSchemaForLLM,
    providerOptions: {
      anthropic: { cacheControl: { type: 'ephemeral' } },
    },
    async execute(input: UpdateCaseInputForLLM) {
      const result: UpdateCaseResult = await repo.applyUpdate({
        ...input,
        caseId: defaults.defaultCaseId,
        sourceTurnId: defaults.defaultSourceTurnId,
      });
      return {
        type: 'update_case_result' as const,
        version: 1 as const,
        data: result,
      };
    },
  });
}
```

- [ ] **Step 5: Run tests, expect pass**

```bash
pnpm test tests/ai/update_case.test.ts
pnpm exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/tools/update_case.ts src/lib/case/types.ts tests/ai/update_case.test.ts
git commit -m "refactor: update_case tool takes route-injected caseId+turnId; expose anthropic cache breakpoint"
```

---

## Task 6 — Extend `createCase` to insert a thread row

**Files:**
- Modify: `src/lib/case/repository.ts`
- Modify: `tests/case/repository.test.ts`

- [ ] **Step 1: Update the `LoadedCase` and `Repository` types to include `threadId`**

In `src/lib/case/repository.ts`:

```ts
export interface LoadedCase {
  case: { /* unchanged */ };
  profile: Profile | null;
  caseFacts: CaseFacts;
  threadId: string;
}

export interface Repository {
  createCase(input: CreateCaseInput): Promise<{ caseId: string; threadId: string }>;
  loadCase(caseId: string): Promise<LoadedCase>;
  applyUpdate(input: UpdateCaseInput): Promise<UpdateCaseResult>;
}
```

- [ ] **Step 2: Write the failing tests in `tests/case/repository.test.ts`**

Add two new `it` blocks:

```ts
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
```

Also update any existing test assertions that destructure `{ caseId }` from `createCase` — they continue to work because `threadId` is just an additional return key.

- [ ] **Step 3: Run tests, expect failure**

```bash
pnpm test tests/case/repository.test.ts
```

- [ ] **Step 4: Implement the change**

In `src/lib/case/repository.ts` `createCase`:

```ts
async createCase(input) {
  const result = await dbInstance.transaction(async (tx) => {
    const [row] = await tx
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
    await tx.insert(schema.caseFacts).values({ caseId: row.id, data: {} as CaseFacts });
    const [thread] = await tx
      .insert(schema.threads)
      .values({ caseId: row.id, title: null })
      .returning({ id: schema.threads.id });
    if (!thread) throw new Error('createCase: thread insert returned no row');
    return { caseId: row.id, threadId: thread.id };
  });
  return result;
},
```

In `loadCase`, add the thread fetch:

```ts
const threadRows = await dbInstance
  .select({ id: schema.threads.id })
  .from(schema.threads)
  .where(eq(schema.threads.caseId, caseId));
const threadId = threadRows[0]?.id;
if (!threadId) throw new Error(`thread not found for case ${caseId}`);
return {
  case: { /* ... */ },
  profile: parsedProfile,
  caseFacts: parsedFacts,
  threadId,
};
```

- [ ] **Step 5: Run tests, expect pass**

```bash
pnpm test tests/case/repository.test.ts
pnpm exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/case/repository.ts tests/case/repository.test.ts
git commit -m "feat: createCase inserts a thread row; loadCase returns threadId"
```

---

## Task 7 — `appendChatTurn` persistence helper

**Files:**
- Create: `src/lib/ai/chat/persistence.ts`
- Test: `tests/ai/chat/persistence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ai/chat/persistence.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestSchema, type TestDbHandle } from '../../_db/setup';
import { seedAnonUser } from '../../_db/seed-auth';
import { makeRepository } from '@/lib/case/repository';
import { appendChatTurn } from '@/lib/ai/chat/persistence';
import * as schema from '@/lib/db/schema';

describe('appendChatTurn', () => {
  let handle: TestDbHandle;
  let userId: string;
  let caseId: string;
  let threadId: string;

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
    threadId = created.threadId;
  }, 30_000);

  afterAll(async () => { await handle.cleanup(); });

  it('writes one user + one assistant message and zero tool_calls when no tools fired', async () => {
    const userMessageId = crypto.randomUUID();
    await appendChatTurn(
      {
        threadId,
        userMessageId,
        userMessageContent: 'hello',
        assistantText: 'hi there',
        assistantParts: [{ type: 'text', text: 'hi there' }],
        toolCalls: [],
        toolResults: [],
        promptVersion: 'v0-stub',
        modelVersion: 'claude-sonnet-4-7',
      },
      handle.db,
    );

    const messages = await handle.db.select().from(schema.messages).where(eq(schema.messages.threadId, threadId));
    expect(messages).toHaveLength(2);
    const user = messages.find((m) => m.role === 'user');
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(user?.id).toBe(userMessageId);
    expect(user?.content).toBe('hello');
    expect(assistant?.content).toBe('hi there');
    expect(assistant?.modelVersion).toBe('claude-sonnet-4-7');
    expect(assistant?.promptVersion).toBe('v0-stub');

    const tools = await handle.db.select().from(schema.toolCalls);
    expect(tools).toHaveLength(0);
  });

  it('writes one tool_calls row per tool result on the assistant message', async () => {
    const userMessageId = crypto.randomUUID();
    await appendChatTurn(
      {
        threadId,
        userMessageId,
        userMessageContent: 'I make 55k',
        assistantText: 'Recorded.',
        assistantParts: [{ type: 'text', text: 'Recorded.' }],
        toolCalls: [
          { toolCallId: 'call-1', toolName: 'update_case', input: { source: 'user_stated', confidence: 0.9, updates: {} } },
        ],
        toolResults: [
          { toolCallId: 'call-1', toolName: 'update_case', output: { type: 'update_case_result', version: 1, data: { caseId, updatedPaths: ['employment.annualGrossSalaryEur'], contradictions: [] } } },
        ],
        promptVersion: 'v0-stub',
        modelVersion: 'claude-sonnet-4-7',
      },
      handle.db,
    );

    const tools = await handle.db.select().from(schema.toolCalls);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.toolName).toBe('update_case');
    const output = tools[0]?.output as { data: { updatedPaths: string[] } };
    expect(output.data.updatedPaths).toEqual(['employment.annualGrossSalaryEur']);
  });

  it('updates threads.lastMessageAt on every turn', async () => {
    const userMessageId = crypto.randomUUID();
    const before = await handle.db.select({ ts: schema.threads.lastMessageAt }).from(schema.threads).where(eq(schema.threads.id, threadId));
    await appendChatTurn(
      {
        threadId,
        userMessageId,
        userMessageContent: 'x',
        assistantText: 'y',
        assistantParts: [{ type: 'text', text: 'y' }],
        toolCalls: [],
        toolResults: [],
        promptVersion: 'v0-stub',
        modelVersion: 'claude-sonnet-4-7',
      },
      handle.db,
    );
    const after = await handle.db.select({ ts: schema.threads.lastMessageAt }).from(schema.threads).where(eq(schema.threads.id, threadId));
    expect(after[0]?.ts).not.toBeNull();
    if (before[0]?.ts && after[0]?.ts) {
      expect(after[0].ts.getTime()).toBeGreaterThanOrEqual(before[0].ts.getTime());
    }
  });

  it('throws (and rolls back) when threadId does not exist', async () => {
    await expect(
      appendChatTurn(
        {
          threadId: '00000000-0000-0000-0000-000000000000',
          userMessageId: crypto.randomUUID(),
          userMessageContent: 'x',
          assistantText: 'y',
          assistantParts: [],
          toolCalls: [],
          toolResults: [],
          promptVersion: 'v0-stub',
          modelVersion: 'claude-sonnet-4-7',
        },
        handle.db,
      ),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm test tests/ai/chat/persistence.test.ts
```

Expected: cannot resolve `@/lib/ai/chat/persistence`.

- [ ] **Step 3: Implement the helper**

Create `src/lib/ai/chat/persistence.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@/lib/db/schema';

type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface ToolCallInput {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface ToolCallOutput {
  toolCallId: string;
  toolName: string;
  output?: unknown;
  error?: string;
}

export interface AppendChatTurnInput {
  threadId: string;
  userMessageId: string;
  userMessageContent: string;
  assistantText: string;
  assistantParts: unknown;
  toolCalls: ToolCallInput[];
  toolResults: ToolCallOutput[];
  promptVersion: string;
  modelVersion: string;
}

function getDefaultDb(): Db {
  return require('@/lib/db/client').db;
}

export async function appendChatTurn(
  input: AppendChatTurnInput,
  db: Db = getDefaultDb(),
): Promise<{ assistantMessageId: string }> {
  const assistantMessageId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(schema.messages).values({
      id: input.userMessageId,
      threadId: input.threadId,
      role: 'user',
      content: input.userMessageContent,
      parts: null,
      channel: 'web',
    });

    await tx.insert(schema.messages).values({
      id: assistantMessageId,
      threadId: input.threadId,
      role: 'assistant',
      content: input.assistantText,
      parts: input.assistantParts as never,
      channel: 'web',
      modelVersion: input.modelVersion,
      promptVersion: input.promptVersion,
    });

    if (input.toolCalls.length > 0) {
      const resultByCallId = new Map(input.toolResults.map((r) => [r.toolCallId, r]));
      for (const call of input.toolCalls) {
        const result = resultByCallId.get(call.toolCallId);
        await tx.insert(schema.toolCalls).values({
          messageId: assistantMessageId,
          toolName: call.toolName,
          input: call.input as never,
          output: (result?.output ?? null) as never,
          error: result?.error ?? null,
          durationMs: null,
        });
      }
    }

    await tx
      .update(schema.threads)
      .set({ lastMessageAt: new Date() })
      .where(eq(schema.threads.id, input.threadId));
  });

  return { assistantMessageId };
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
pnpm test tests/ai/chat/persistence.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/chat/persistence.ts tests/ai/chat/persistence.test.ts
git commit -m "feat: appendChatTurn writes user+assistant+tool_calls in one tx"
```

---

## Task 8 — Inngest client + `logCaseEvent` function

**Files:**
- Create: `src/lib/inngest/client.ts`
- Create: `src/lib/inngest/functions/log-case-event.ts`
- Test: `tests/inngest/log-case-event.test.ts`

- [ ] **Step 1: Write the failing test**

We test the handler callback directly (independent of how Inngest internally exposes it on the `createFunction`-returned object). The implementation in Step 4 exports the callback as a separate function so the test can invoke it without going through Inngest's runtime.

Create `tests/inngest/log-case-event.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedAnonUser } from '../_db/seed-auth';
import { makeRepository } from '@/lib/case/repository';
import * as schema from '@/lib/db/schema';

let testHandle: TestDbHandle;
vi.mock('@/lib/db/client', () => ({
  get db() { return testHandle.db; },
  schema,
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

  afterAll(async () => { await testHandle.cleanup(); });

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
    expect((rows[0]?.payload as { paths: string[] }).paths).toEqual(['employment.annualGrossSalaryEur']);
    expect(rows[0]?.caseId).toBe(caseId);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm test tests/inngest/log-case-event.test.ts
```

- [ ] **Step 3: Implement the client**

Create `src/lib/inngest/client.ts`:

```ts
import { Inngest } from 'inngest';
import { env } from '@/lib/env';

export const inngest = new Inngest({
  id: 'visa',
  ...(env.INNGEST_EVENT_KEY && { eventKey: env.INNGEST_EVENT_KEY }),
  ...(env.INNGEST_SIGNING_KEY && { signingKey: env.INNGEST_SIGNING_KEY }),
});

export type CaseFactsUpdatedEvent = {
  name: 'case.facts.updated';
  data: { caseId: string; paths: string[]; sourceTurnId: string };
};
```

- [ ] **Step 4: Implement the function**

Create `src/lib/inngest/functions/log-case-event.ts`. The handler callback is exported separately from the Inngest-wrapped function so the test in Step 1 can invoke it directly:

```ts
import { inngest, type CaseFactsUpdatedEvent } from '@/lib/inngest/client';
import { db } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';

interface StepLike {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
}

export async function logCaseEventHandler({
  event,
  step,
}: {
  event: CaseFactsUpdatedEvent;
  step: StepLike;
}): Promise<void> {
  await step.run('write-activity-log', async () => {
    await db.insert(schema.activityLog).values({
      caseId: event.data.caseId,
      userId: null,
      kind: 'inngest.echo',
      payload: { paths: event.data.paths, sourceTurnId: event.data.sourceTurnId },
    });
  });
}

export const logCaseEvent = inngest.createFunction(
  { id: 'log-case-event' },
  { event: 'case.facts.updated' },
  logCaseEventHandler,
);
```

- [ ] **Step 5: Run test, expect pass**

```bash
pnpm test tests/inngest/log-case-event.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/inngest tests/inngest
git commit -m "feat: inngest client + logCaseEvent echo function"
```

---

## Task 9 — `/api/inngest` webhook route

**Files:**
- Create: `src/app/api/inngest/route.ts`

- [ ] **Step 1: Implement the route**

Create `src/app/api/inngest/route.ts`:

```ts
import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { logCaseEvent } from '@/lib/inngest/functions/log-case-event';

export const runtime = 'nodejs';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [logCaseEvent],
});
```

(No automated test — Inngest's `serve` is third-party glue. The Task 14 manual smoke verifies it end-to-end via the Inngest dev CLI.)

- [ ] **Step 2: Build check**

```bash
pnpm exec tsc --noEmit
pnpm build
```

`pnpm build` triggers Next's prod env validation; ensure `.env.local` has `ANTHROPIC_API_KEY` set so the build doesn't refuse.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/inngest
git commit -m "feat: mount inngest webhook at /api/inngest"
```

---

## Task 10 — `/api/case/new` route

**Files:**
- Create: `src/app/api/case/new/route.ts`
- Test: `tests/api/case-new.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/api/case-new.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import * as schema from '@/lib/db/schema';

let testHandle: TestDbHandle;

const cookieStore = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => {
      const v = cookieStore.get(name);
      return v ? { name, value: v } : undefined;
    },
    set: (name: string, value: string) => { cookieStore.set(name, value); },
    delete: (name: string) => { cookieStore.delete(name); },
  }),
}));

vi.mock('@/lib/db/client', () => ({
  get db() { return testHandle.db; },
  schema,
}));

describe('POST /api/case/new', () => {
  beforeAll(async () => { testHandle = await createTestSchema(); });
  afterAll(async () => { await testHandle.cleanup(); });
  beforeEach(() => { cookieStore.clear(); vi.clearAllMocks(); });

  it('mints anon session, creates case + thread, redirects to /case/<id>', async () => {
    const { POST } = await import('@/app/api/case/new/route');
    const res = await POST(new Request('http://localhost/api/case/new', { method: 'POST' }));

    expect([303, 307].includes(res.status)).toBe(true);
    const location = res.headers.get('location') ?? '';
    const match = /\/case\/([0-9a-f-]{36})/.exec(location);
    expect(match).not.toBeNull();

    expect(cookieStore.get('visa_session')).toBeDefined();

    const cases = await testHandle.db.select().from(schema.cases);
    expect(cases).toHaveLength(1);
    const threads = await testHandle.db.select().from(schema.threads);
    expect(threads).toHaveLength(1);
  });

  it('reuses an existing anon session if the cookie is valid', async () => {
    const { POST } = await import('@/app/api/case/new/route');
    const first = await POST(new Request('http://localhost/api/case/new', { method: 'POST' }));
    expect(first.status).toBeGreaterThanOrEqual(300);
    const cookieAfterFirst = cookieStore.get('visa_session');

    const second = await POST(new Request('http://localhost/api/case/new', { method: 'POST' }));
    expect(second.status).toBeGreaterThanOrEqual(300);
    expect(cookieStore.get('visa_session')).toBe(cookieAfterFirst);

    const users = await testHandle.db.select().from(schema.users);
    expect(users).toHaveLength(1);  // anon user reused
    const cases = await testHandle.db.select().from(schema.cases);
    expect(cases).toHaveLength(2);  // two cases, same user
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm test tests/api/case-new.test.ts
```

- [ ] **Step 3: Implement the route**

Create `src/app/api/case/new/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { ensureAnonymousSession } from '@/lib/auth/session';
import { makeRepository } from '@/lib/case/repository';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { userId } = await ensureAnonymousSession();
  const repo = makeRepository();
  const { caseId } = await repo.createCase({
    userId,
    visaType: 'eu_blue_card_germany',
    targetCountry: 'DE',
    targetConsulate: 'bengaluru',
  });
  return NextResponse.redirect(new URL(`/case/${caseId}`, req.url), { status: 303 });
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
pnpm test tests/api/case-new.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/case/new tests/api/case-new.test.ts
git commit -m "feat: POST /api/case/new mints anon session + creates case + redirects"
```

---

## Task 11 — `/api/chat` route + tests

**Files:**
- Create: `src/app/api/chat/route.ts`
- Test: `tests/api/chat.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/api/chat.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedAnonUser } from '../_db/seed-auth';
import { encodeSession } from '@/lib/auth/cookie';
import { makeRepository } from '@/lib/case/repository';
import * as schema from '@/lib/db/schema';

const cookieStore = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => {
      const v = cookieStore.get(name);
      return v ? { name, value: v } : undefined;
    },
    set: (name: string, value: string) => { cookieStore.set(name, value); },
    delete: (name: string) => { cookieStore.delete(name); },
  }),
}));

const inngestSendSpy = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: inngestSendSpy },
}));

let testHandle: TestDbHandle;
vi.mock('@/lib/db/client', () => ({
  get db() { return testHandle.db; },
  schema,
}));

// Mock streamText to call onFinish synchronously with a fixture and return a no-op stream response.
let streamTextOnFinish: ((event: unknown) => Promise<void>) | undefined;
let streamTextFixture: unknown = {};
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    streamText: vi.fn((opts: { onFinish?: (e: unknown) => Promise<void> }) => {
      streamTextOnFinish = opts.onFinish;
      return {
        toUIMessageStreamResponse: () => new Response(new ReadableStream(), { status: 200 }),
      };
    }),
  };
});

describe('POST /api/chat', () => {
  let userId: string;
  let caseId: string;
  let threadId: string;

  beforeAll(async () => {
    testHandle = await createTestSchema();
    const seeded = await seedAnonUser(testHandle);
    userId = seeded.userId;
    const repo = makeRepository(testHandle.db, testHandle.schemaName);
    const created = await repo.createCase({
      userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
      targetConsulate: 'bengaluru',
    });
    caseId = created.caseId;
    threadId = created.threadId;
  }, 30_000);

  afterAll(async () => { await testHandle.cleanup(); });
  beforeEach(() => { cookieStore.clear(); vi.clearAllMocks(); streamTextOnFinish = undefined; streamTextFixture = {}; });

  it('returns 401 when no session cookie present', async () => {
    const { POST } = await import('@/app/api/chat/route');
    const res = await POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ caseId, messages: [] }),
    }));
    expect(res.status).toBe(401);
  });

  it('returns 403 when caseId is owned by a different user', async () => {
    const otherSeeded = await seedAnonUser(testHandle);
    cookieStore.set(
      'visa_session',
      encodeSession({ userId: otherSeeded.userId, iat: Date.now(), exp: Date.now() + 60_000 }),
    );
    const { POST } = await import('@/app/api/chat/route');
    const res = await POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ caseId, messages: [] }),
    }));
    expect(res.status).toBe(403);
  });

  it('persists user + assistant rows and emits inngest event when update_case fires', async () => {
    cookieStore.set(
      'visa_session',
      encodeSession({ userId, iat: Date.now(), exp: Date.now() + 60_000 }),
    );
    const { POST } = await import('@/app/api/chat/route');
    const res = await POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        caseId,
        messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'I make 55k' }] }],
      }),
    }));
    expect(res.status).toBe(200);
    if (!streamTextOnFinish) throw new Error('streamText onFinish was not captured');

    // Simulate the AI SDK calling onFinish at the end of the stream.
    await streamTextOnFinish({
      text: 'Recorded.',
      content: [{ type: 'text', text: 'Recorded.' }],
      toolCalls: [
        { toolCallId: 'call-1', toolName: 'update_case', input: { source: 'user_stated', confidence: 0.9, updates: { 'employment.annualGrossSalaryEur': 55000 } } },
      ],
      toolResults: [
        { toolCallId: 'call-1', toolName: 'update_case', output: { type: 'update_case_result', version: 1, data: { caseId, updatedPaths: ['employment.annualGrossSalaryEur'], contradictions: [] } } },
      ],
      steps: [],
    });

    const messages = await testHandle.db.select().from(schema.messages).where(eq(schema.messages.threadId, threadId));
    expect(messages.length).toBeGreaterThanOrEqual(2);
    const tools = await testHandle.db.select().from(schema.toolCalls);
    expect(tools.length).toBeGreaterThanOrEqual(1);

    expect(inngestSendSpy).toHaveBeenCalledOnce();
    const sent = inngestSendSpy.mock.calls[0][0];
    expect(sent.name).toBe('case.facts.updated');
    expect(sent.data.caseId).toBe(caseId);
    expect(sent.data.paths).toEqual(['employment.annualGrossSalaryEur']);
  });

  it('does not emit an inngest event when the assistant fired no tools', async () => {
    cookieStore.set(
      'visa_session',
      encodeSession({ userId, iat: Date.now(), exp: Date.now() + 60_000 }),
    );
    const { POST } = await import('@/app/api/chat/route');
    const res = await POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        caseId,
        messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
      }),
    }));
    expect(res.status).toBe(200);

    await streamTextOnFinish!({
      text: 'Hi!',
      content: [{ type: 'text', text: 'Hi!' }],
      toolCalls: [],
      toolResults: [],
      steps: [],
    });

    expect(inngestSendSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm test tests/api/chat.test.ts
```

- [ ] **Step 3: Implement the route**

Create `src/app/api/chat/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { streamText, convertToModelMessages, stepCountIs } from 'ai';
import { anthropic, MODEL_ID } from '@/lib/ai/provider';
import { systemPrompt, PROMPT_VERSION } from '@/lib/ai/chat/system-prompt';
import { buildAgentContext } from '@/lib/ai/chat/context-builder';
import { appendChatTurn } from '@/lib/ai/chat/persistence';
import { makeUpdateCaseTool } from '@/lib/ai/tools/update_case';
import { makeRepository } from '@/lib/case/repository';
import { getCurrentUserId } from '@/lib/auth/session';
import { inngest } from '@/lib/inngest/client';

export const runtime = 'nodejs';

const BodySchema = z.object({
  caseId: z.string().uuid(),
  messages: z.array(z.unknown()),
});

function extractLastUserText(messages: { role?: string; content?: unknown }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        const text = m.content.find((p: { type?: string; text?: string }) => p?.type === 'text');
        if (text && typeof text.text === 'string') return text.text;
      }
    }
  }
  return '';
}

export async function POST(req: Request) {
  const body = BodySchema.parse(await req.json());
  const userId = await getCurrentUserId();
  if (!userId) return new NextResponse('unauthorized', { status: 401 });

  const repo = makeRepository();
  const loaded = await repo.loadCase(body.caseId);
  if (loaded.case.userId !== userId) return new NextResponse('forbidden', { status: 403 });

  const userMessageId = crypto.randomUUID();
  const modelMessages = await convertToModelMessages(body.messages as never);
  await buildAgentContext({ caseId: body.caseId, caseFacts: loaded.caseFacts });

  const result = streamText({
    model: anthropic(MODEL_ID),
    system: systemPrompt,
    messages: modelMessages,
    tools: {
      update_case: makeUpdateCaseTool(repo, {
        defaultCaseId: body.caseId,
        defaultSourceTurnId: userMessageId,
      }),
    },
    stopWhen: stepCountIs(5),
    providerOptions: {
      anthropic: { cacheControl: { type: 'ephemeral' } },
    },
    async onFinish(event) {
      try {
        await appendChatTurn({
          threadId: loaded.threadId,
          userMessageId,
          userMessageContent: extractLastUserText(modelMessages as never),
          assistantText: event.text,
          assistantParts: event.content,
          toolCalls: event.toolCalls.map((c) => ({
            toolCallId: c.toolCallId,
            toolName: c.toolName,
            input: c.input,
          })),
          toolResults: event.toolResults.map((r) => ({
            toolCallId: r.toolCallId,
            toolName: r.toolName,
            output: r.output,
          })),
          promptVersion: PROMPT_VERSION,
          modelVersion: MODEL_ID,
        });
      } catch (err) {
        console.error('appendChatTurn failed', err);
      }

      const updateCalls = event.toolResults.filter((r) => r.toolName === 'update_case');
      for (const call of updateCalls) {
        const data = (call.output as { data?: { updatedPaths?: string[] } })?.data;
        try {
          await inngest.send({
            name: 'case.facts.updated',
            data: {
              caseId: body.caseId,
              paths: data?.updatedPaths ?? [],
              sourceTurnId: userMessageId,
            },
          });
        } catch (err) {
          console.error('inngest emit failed', err);
        }
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
pnpm test tests/api/chat.test.ts
pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chat tests/api/chat.test.ts
git commit -m "feat: POST /api/chat — streaming with update_case + onFinish persistence + inngest emit"
```

---

## Task 12 — Workspace shell components (Layout, Nav, Overview)

**Files:**
- Create: `src/components/workspace/Layout.tsx`
- Create: `src/components/workspace/Nav.tsx`
- Create: `src/components/workspace/Overview.tsx`

(No automated tests — these are pure-render components. The Task 14 manual smoke verifies they render correctly.)

- [ ] **Step 1: Implement `Nav.tsx`**

```tsx
import Link from 'next/link';

const SECTIONS = [
  { href: '#overview', label: 'Overview', active: true },
  { href: '#profile', label: 'Profile', active: false },
  { href: '#documents', label: 'Documents', active: false },
  { href: '#drafts', label: 'Drafts', active: false },
  { href: '#forms', label: 'Forms', active: false },
  { href: '#timeline', label: 'Timeline', active: false },
  { href: '#tasks', label: 'Tasks', active: false },
  { href: '#activity', label: 'Activity', active: false },
];

export function Nav() {
  return (
    <nav className="flex flex-col gap-1 border-r border-zinc-200 p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase text-zinc-500">Case</h2>
      {SECTIONS.map((s) => (
        s.active ? (
          <Link key={s.href} href={s.href} className="rounded px-2 py-1 text-sm font-medium bg-zinc-100">
            {s.label}
          </Link>
        ) : (
          <span key={s.href} className="rounded px-2 py-1 text-sm text-zinc-400 cursor-not-allowed" title="Coming soon">
            {s.label}
          </span>
        )
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Implement `Overview.tsx`**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CaseFacts } from '@/lib/case/schema';

const SECTION_ORDER: Array<keyof CaseFacts> = ['employment', 'education', 'family', 'risk'];

function isFieldValue(v: unknown): v is { value: unknown; source: string; confidence: number; updatedAt: string } {
  return typeof v === 'object' && v !== null && 'value' in v && 'source' in v;
}

export function Overview({ caseFacts }: { caseFacts: CaseFacts }) {
  const populatedSections = SECTION_ORDER.filter((k) => {
    const v = caseFacts[k] as unknown;
    return v && typeof v === 'object' && Object.keys(v).length > 0;
  });

  if (populatedSections.length === 0) {
    return (
      <main className="overflow-y-auto p-8">
        <h1 className="text-2xl font-semibold mb-2">Your case file</h1>
        <p className="text-zinc-600">
          Your case file is empty. Tell the agent on the right what's going on.
        </p>
      </main>
    );
  }

  return (
    <main className="overflow-y-auto p-8 space-y-4">
      <h1 className="text-2xl font-semibold">Your case file</h1>
      {populatedSections.map((section) => {
        const data = caseFacts[section] as Record<string, unknown>;
        return (
          <Card key={section}>
            <CardHeader>
              <CardTitle className="capitalize">{section}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {Object.entries(data).map(([key, value]) => (
                <div key={key} className="flex justify-between text-sm">
                  <span className="text-zinc-600">{key}</span>
                  <span className="font-mono">
                    {isFieldValue(value) ? String(value.value) : JSON.stringify(value)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </main>
  );
}
```

- [ ] **Step 3: TypeScript check on Nav + Overview alone**

```bash
pnpm exec tsc --noEmit
```

Expected: clean. (Layout.tsx is added in Task 13 alongside ChatPanel so the import graph stays consistent at every commit.)

- [ ] **Step 4: Commit**

```bash
git add src/components/workspace/Nav.tsx src/components/workspace/Overview.tsx
git commit -m "feat: workspace shell — Nav + Overview"
```

---

## Task 13 — `ChatPanel` client island + `Layout`

**Files:**
- Create: `src/components/workspace/ChatPanel.tsx`
- Create: `src/components/workspace/Layout.tsx`

(No automated tests — exercised by the Task 14 manual smoke. AI SDK v5's React hooks are not trivial to mock and the route handler tests already cover the server-side contract.)

- [ ] **Step 1: Implement `ChatPanel.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

function messageContainsUpdateCase(message: UIMessage): boolean {
  if (!Array.isArray(message.parts)) return false;
  for (const part of message.parts) {
    const t = (part as { type?: string }).type ?? '';
    if (t.startsWith('tool-update_case')) return true;
    if (t === 'tool-call' && (part as { toolName?: string }).toolName === 'update_case') return true;
  }
  return false;
}

export function ChatPanel({ caseId, initialMessages }: { caseId: string; initialMessages: UIMessage[] }) {
  const router = useRouter();
  const [input, setInput] = useState('');

  const transport = new DefaultChatTransport({
    api: '/api/chat',
    body: { caseId },
  });

  const { messages, sendMessage, status } = useChat({
    transport,
    initialMessages,
    onFinish: ({ message }) => {
      if (messageContainsUpdateCase(message)) {
        router.refresh();
      }
    },
  });

  return (
    <aside className="flex h-screen flex-col border-l border-zinc-200">
      <header className="border-b border-zinc-200 p-3 text-xs font-semibold uppercase text-zinc-500">
        Chat
      </header>
      <ScrollArea className="flex-1 p-3">
        <div className="space-y-3">
          {messages.map((m) => (
            <div key={m.id} className={m.role === 'user' ? 'text-right' : 'text-left'}>
              <div className={`inline-block rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-zinc-900 text-white' : 'bg-zinc-100'}`}>
                {Array.isArray(m.parts)
                  ? m.parts.map((p, i) => {
                      const part = p as { type: string; text?: string };
                      if (part.type === 'text') return <span key={i}>{part.text}</span>;
                      if (part.type.startsWith('tool-')) return <span key={i} className="opacity-60 text-xs">[{part.type}]</span>;
                      return null;
                    })
                  : null}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      <form
        className="border-t border-zinc-200 p-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || status !== 'ready') return;
          sendMessage({ text: input });
          setInput('');
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Tell me about your situation…"
        />
        <Button type="submit" disabled={status !== 'ready' || !input.trim()}>Send</Button>
      </form>
    </aside>
  );
}
```

- [ ] **Step 2: Implement `Layout.tsx`**

```tsx
import type { CaseFacts } from '@/lib/case/schema';
import type { UIMessage } from 'ai';
import { Nav } from './Nav';
import { Overview } from './Overview';
import { ChatPanel } from './ChatPanel';

export function Layout({
  caseId,
  caseFacts,
  initialMessages,
}: {
  caseId: string;
  caseFacts: CaseFacts;
  initialMessages: UIMessage[];
}) {
  return (
    <div className="grid h-screen grid-cols-[220px_1fr_360px]">
      <Nav />
      <Overview caseFacts={caseFacts} />
      <ChatPanel caseId={caseId} initialMessages={initialMessages} />
    </div>
  );
}
```

- [ ] **Step 3: Build check**

```bash
pnpm exec tsc --noEmit
```

The expected typing surface: `@ai-sdk/react`'s `useChat` from v5 takes `{ transport, initialMessages, onFinish }`. `sendMessage({ text })` is the documented v5 helper. If TypeScript complains about a specific field, open `node_modules/@ai-sdk/react/dist/index.d.ts` and match the exact `UseChatOptions` interface for the installed version — but do not change the contract documented here without flagging it as a deviation in CLAUDE.md.

- [ ] **Step 4: Commit**

```bash
git add src/components/workspace/ChatPanel.tsx src/components/workspace/Layout.tsx
git commit -m "feat: ChatPanel client island + Layout — useChat + DefaultChatTransport, refresh on update_case"
```

---

## Task 14 — `/case/[id]` page + landing page replacement + final smoke

**Files:**
- Create: `src/app/case/[id]/page.tsx`
- Create: `src/app/case/[id]/not-found.tsx`
- Modify: `src/app/page.tsx`
- Modify: `CLAUDE.md` (add 1B-3 carry-overs, mark phase complete)

- [ ] **Step 1: Implement `/case/[id]/page.tsx`**

```tsx
import { notFound, redirect } from 'next/navigation';
import { eq, asc } from 'drizzle-orm';
import { Layout } from '@/components/workspace/Layout';
import { makeRepository } from '@/lib/case/repository';
import { getCurrentUserId } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import type { UIMessage } from 'ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getCurrentUserId();
  if (!userId) redirect('/');

  const repo = makeRepository();
  let loaded;
  try {
    loaded = await repo.loadCase(id);
  } catch {
    notFound();
  }

  if (loaded.case.userId !== userId) redirect('/');

  const recent = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.threadId, loaded.threadId))
    .orderBy(asc(schema.messages.createdAt))
    .limit(50);

  const initialMessages: UIMessage[] = recent.map((m) => ({
    id: m.id,
    role: m.role as 'user' | 'assistant' | 'system',
    parts: (m.parts as UIMessage['parts']) ?? [{ type: 'text', text: m.content }],
  }));

  return (
    <Layout caseId={loaded.case.id} caseFacts={loaded.caseFacts} initialMessages={initialMessages} />
  );
}
```

- [ ] **Step 2: Implement `not-found.tsx`**

```tsx
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div>
        <h1 className="text-2xl font-semibold">Case not found</h1>
        <p className="mt-2 text-zinc-600">
          <a href="/" className="underline">Start a new case</a>
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Replace `src/app/page.tsx` with the landing CTA**

```tsx
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 gap-4">
      <h1 className="text-3xl font-semibold">Visa</h1>
      <p className="text-zinc-600 max-w-md text-center">
        Build a complete EU Blue Card to Germany application — guided by an agent, reviewed by you.
      </p>
      <form action="/api/case/new" method="post">
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Start a case
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Build check**

```bash
pnpm exec tsc --noEmit
pnpm test
pnpm lint
pnpm build
```

All four green.

- [ ] **Step 5: Manual smoke**

In one terminal:
```bash
pnpm dev
```

In another:
```bash
npx inngest-cli@latest dev
```

Then exercise the loop:
1. Visit `http://localhost:3000`.
2. Click **Start a case**. Expect redirect to `/case/<uuid>`.
3. Three columns visible: left rail with "Overview" highlighted, center showing "Your case file is empty…", right showing empty chat with input + send button.
4. Type "I work at Acme as a senior engineer making €55k a year." and click Send.
5. Watch the assistant stream a reply. Watch a small `[tool-update_case]` marker appear inline.
6. Within ~1s of the tool result completing, the center column re-renders with an "Employment" card listing the new fact.
7. Open the Inngest dev UI (default `http://localhost:8288`). Confirm one `case.facts.updated` event was delivered to `log-case-event` and the function ran successfully.
8. Open Supabase studio (or `pnpm db:studio`) and confirm:
   - 2 rows in `messages` (one user, one assistant).
   - 1+ rows in `tool_calls` referencing the assistant message.
   - 1+ rows in `case_changes`.
   - 2+ rows in `activity_log`: one `case.facts.updated` (from `update_case`), one `inngest.echo` (from `logCaseEvent`).
9. Refresh the page in the browser. The chat history loads from `messages` (initialMessages). The Overview shows the same employment fact.

If any step fails, fix before proceeding to step 6.

- [ ] **Step 6: Update CLAUDE.md**

Open `CLAUDE.md`, find the "Current state" section, and:

a) Mark 1B-3 as complete:

> **1B-3 (complete, pushed YYYY-MM-DD):** Streaming chat + 3-col workspace + Inngest scaffold. Plan at `docs/superpowers/plans/2026-05-28-phase-1b-3-chat-workspace.md`. Verification gate green: `pnpm test` X/X, `pnpm build`, `pnpm exec tsc --noEmit`, `pnpm lint`. Manual smoke green (chat round-trips, Inngest echo writes activity_log row).

b) Add a "1B-3 carry-overs that bind future work" section right below 1B-2's:

> ### 1B-3 carry-overs that bind future work
>
> - **`update_case` tool factory now takes `defaults`.** `makeUpdateCaseTool(repo, { defaultCaseId, defaultSourceTurnId })`. The LLM-facing schema (`UpdateCaseInputSchemaForLLM`) omits `caseId` and `sourceTurnId`; the route injects them. Phase 2 tools that follow the same pattern should pass route-known plumbing as `defaults`, not as LLM input.
> - **`createCase` now also inserts a thread row** in the same transaction. `loadCase` returns `threadId`. There is exactly one thread per case in MVP; multi-thread support waits for a real product reason.
> - **`appendChatTurn` is the single chat-persistence path.** Two transactions per turn: tool-side (`update_case`'s own tx) and chat-side (`appendChatTurn`'s). If chat-side fails after tool-side succeeds, the case file is correct but the message history loses a turn. Acceptable degradation; eval workflow in Phase 7 catches trends.
> - **Inngest emit is in `/api/chat`'s `onFinish`, not in the tool.** Repository stays Inngest-free. If the emit fails, we log + continue; activity_log already has the durable `case.facts.updated` row from `update_case`.
> - **`router.refresh()` lives on `useChat`'s `onFinish`, gated on tool presence.** One refresh per turn that mutated state. Don't move it to `onToolCall` — that would refresh mid-stream.
> - **Anthropic prompt cache: system + tool only in 1B-3.** Both carry `providerOptions.anthropic.cacheControl: { type: 'ephemeral' }`. Per-message and per-context caching wait for Phase 2 (where `buildAgentContext` produces real long-form content worth caching).
> - **`@ai-sdk/anthropic` and `@ai-sdk/react` are deps, not just `ai`.** v5 split the React hook surface into a separate package.
> - **Inngest keys are optional in dev, required in prod.** Same superRefine pattern as `AUTH_RESEND_KEY`. Mirror this for any future workflow-engine env keys.
> - **System prompt versioning:** `prompts/agent/v0-stub.md` loaded as a constant via `readFileSync` at import time. `PROMPT_VERSION = 'v0-stub'` is logged on every assistant message. Phase 2 replaces the file with `v0.md` and bumps the constant.

c) In the "Resume point" subsection, replace the 1B-3 paragraph with a new one pointing to Phase 2:

> ### Resume point for the next agent: Phase 2 (intake + eligibility wiring)
>
> 1B-3 done. Phase 2 work per `IMPLEMENTATION_PLAN.md`:
> - Real `prompts/agent/v0.md` per PRD §8.2 (replace the stub).
> - Real `buildAgentContext` per PRD §8.3 (last N messages, eligibility verdict, knowledge chunks, open tasks).
> - Add the Phase-2 tools listed in `IMPLEMENTATION_PLAN.md` Phase 2: `evaluate_eligibility`, `read_rule`, `lookup_anabin`, `lookup_isco`, `out_of_scope`, `summarize_progress`, `record_event`.
> - Eligibility verdict in the Overview center column (replace the empty-state placeholder when verdict is present).
> - Persona-driven E2E tests in `tests/personas/`.
>
> Start with brainstorming + writing-plans. The chat plumbing is stable; new tools register via `tools: { ... }` on `/api/chat/route.ts` and follow the `update_case` factory shape from Task 5.

- [ ] **Step 7: Commit + push**

```bash
git add src/app/case src/app/page.tsx CLAUDE.md
git commit -m "feat: /case/[id] workspace + landing CTA; mark 1B-3 complete"
git push origin main
```

---

## Task 15 — Self-review pass

- [ ] **Step 1: Re-run all four checks one final time**

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

All green before declaring 1B-3 done.

- [ ] **Step 2: Verify the verification gate from the spec**

Open `docs/superpowers/specs/2026-05-28-phase-1b-3-chat-workspace-design.md` §8 and tick each box mentally:
- [x] `pnpm test` green.
- [x] `pnpm exec tsc --noEmit` clean.
- [x] `pnpm lint` clean.
- [x] `pnpm build` green.
- [x] Manual smoke 1–9 done in Task 14 Step 5.
- [x] CLAUDE.md updated (Task 14 Step 6).

If any box doesn't tick, do not push — fix first.

---

## Spec coverage cross-check

| Spec section | Implemented in |
|---|---|
| §2.1 Module map | Tasks 1, 3–13 (all paths created). |
| §2.2 Trust boundaries | Task 11 (Zod parse, ownership check, server-minted userMessageId, best-effort Inngest emit). |
| §3.1 `GET /` landing | Task 14 Step 3. |
| §3.2 `POST /api/case/new` | Task 10. |
| §3.3 `GET /case/[id]` | Task 14 Steps 1–2. |
| §3.4 `POST /api/chat` | Task 11. |
| §3.5 `GET/POST /api/inngest` | Task 9. |
| §4.1 Layout | Task 12 Step 3. |
| §4.2 Nav | Task 12 Step 1. |
| §4.3 Overview | Task 12 Step 2. |
| §4.4 ChatPanel | Task 13. |
| §4.5 `update_case` refactor | Task 5. |
| §4.6 `appendChatTurn` | Task 7. |
| §4.7 v0-stub system prompt | Task 1 Step 4. |
| §4.8 buildAgentContext stub | Task 4. |
| §4.9 Inngest client + function | Task 8. |
| §5 Data flow | Tasks 7, 11 (combined). |
| §6 Error handling | Task 11 (try/catch on persistence + Inngest). |
| §7.1 Tier-1 unit tests | Tasks 3, 4, 7. |
| §7.2 Repository extensions | Task 6. |
| §7.3 Route handler tests | Tasks 10, 11. |
| §7.4 Inngest function tests | Task 8. |
| §7.5 Manual smoke | Task 14 Step 5. |
| §8 Verification gate | Task 14 Step 4 + Task 15. |
| §9.1 Env additions | Task 2. |
| §9.2 New deps + shadcn | Task 1. |
| §9.3 No new migrations | Confirmed: no `db:generate` step in any task. |
| §9.4 PII discipline | Task 11 (Inngest payload shape, no values logged). |
| §9.6 Commit cadence | Each task ends in a commit. |
