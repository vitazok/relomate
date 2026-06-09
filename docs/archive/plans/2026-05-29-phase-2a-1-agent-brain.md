# Phase 2A.1 — Agent Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the agent a real brain — a context builder that injects case state, a real system prompt, three I/O tools (`read_case`, `add_case_note`, `out_of_scope`), an injectable-model agent-loop seam, and a minimal renderer registry so tool outputs display in chat.

**Architecture:** Extract the `streamText` loop out of `route.ts` into a testable `buildAgentTurn({ model, ... })` factory (the model-injection seam for 2C's fixture replay). Three new tools follow the existing `makeXTool(repo, defaults)` pattern with Zod I/O and `{type, version, data}` outputs. Notes/refusals append to `activity_log` (no new table). A dispatch-on-`type` renderer registry replaces the `[tool-name]` placeholder in `ChatPanel`.

**Tech Stack:** Next.js 16 App Router, Vercel AI SDK v5, Anthropic provider, Drizzle, Zod, Vitest. No new dependencies.

---

## Design notes (read before starting)

- **Spec:** `docs/superpowers/specs/2026-05-29-phase-2a-1-agent-brain-design.md`. Decisions D1–D6 there govern this plan.
- **`MockLanguageModelV2` is NOT available** — `ai/test` requires `msw`, which is not installed, and CLAUDE.md forbids new deps without asking. The seam test (Task 7) uses the existing dependency-free pattern from `tests/api/chat.test.ts`: `vi.mock('ai')` to capture the `streamText` call args + `onFinish`. Real fixture replay is a 2C concern.
- **CLAUDE.md test gotchas apply:** mock `@/lib/db/client` with the **getter** pattern `vi.mock('@/lib/db/client', () => ({ get db() { return testHandle.db; } }))`; do NOT put `schema` in the factory. Tool unit tests pass a fake `repo` directly (no DB) — see `tests/ai/update_case.test.ts`.
- **AI SDK tool `execute` takes two args** — `execute(input, ctx)`. In tests pass `{} as never` for the second.
- **`providerOptions.anthropic.cacheControl: { type: 'ephemeral' }`** goes on every tool (matches `update_case`).
- **Rule 5 (single-threaded writes):** only `update_case` mutates case state. `add_case_note` / `out_of_scope` append to the append-only `activity_log` — not case state, so this is allowed. They must NOT touch `case_facts`, `profiles`, or the eligibility verdict.
- **Tool `execute` second-arg signature:** existing `update_case` types its execute param explicitly. Match that style.

## File structure

**Create:**
- `src/lib/ai/tools/read_case.ts` — `makeReadCaseTool(repo, defaults)`
- `src/lib/ai/tools/add_case_note.ts` — `makeAddCaseNoteTool(repo, defaults)`
- `src/lib/ai/tools/out_of_scope.ts` — `makeOutOfScopeTool(repo, defaults)`
- `src/lib/ai/chat/agent-turn.ts` — `buildAgentTurn(...)` (model seam + loop)
- `src/components/workspace/renderers/registry.tsx` — `resolveRenderer` + per-type renderers
- `prompts/agent/v0.md` — real system prompt
- `tests/ai/read_case.test.ts`, `tests/ai/add_case_note.test.ts`, `tests/ai/out_of_scope.test.ts`
- `tests/ai/agent-turn.test.ts`
- `tests/ai/context-builder.test.ts`
- `tests/case/append-activity.test.ts`
- `tests/components/renderers.test.ts`

**Modify:**
- `src/lib/case/repository.ts` — add `appendActivity` to interface + impl
- `src/lib/ai/chat/context-builder.ts` — real implementation, returns `{ systemContext }`
- `src/lib/ai/chat/system-prompt.ts` — load `v0.md`, `PROMPT_VERSION = 'v0'`
- `src/app/api/chat/route.ts` — delegate to `buildAgentTurn`, register new tools
- `src/components/workspace/ChatPanel.tsx` — dispatch tool parts via registry

---

## Task 1: Repository `appendActivity`

**Files:**
- Modify: `src/lib/case/repository.ts` (interface at `39-43`, impl inside `makeRepository`)
- Test: `tests/case/append-activity.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/case/append-activity.test.ts
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

  afterAll(async () => { await handle.cleanup(); });

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/case/append-activity.test.ts`
Expected: FAIL — `repo.appendActivity is not a function`.

- [ ] **Step 3: Add `appendActivity` to the interface**

In `src/lib/case/repository.ts`, extend the `Repository` interface (currently lines 39-43):

```typescript
export interface Repository {
  createCase(input: CreateCaseInput): Promise<{ caseId: string; threadId: string }>;
  loadCase(caseId: string): Promise<LoadedCase>;
  applyUpdate(input: UpdateCaseInput): Promise<UpdateCaseResult>;
  appendActivity(input: AppendActivityInput): Promise<void>;
}

export interface AppendActivityInput {
  caseId: string;
  userId: string;
  kind: string;
  payload: Record<string, unknown>;
}
```

- [ ] **Step 4: Implement `appendActivity` in `makeRepository`**

Add this method to the returned object (after `applyUpdate`, before the closing `}` of the return — around line 244):

```typescript
    async appendActivity(input) {
      await dbInstance.insert(schema.activityLog).values({
        caseId: input.caseId,
        userId: input.userId,
        kind: input.kind,
        payload: input.payload,
      });
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run tests/case/append-activity.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/case/repository.ts tests/case/append-activity.test.ts
git commit -m "feat: repository.appendActivity for append-only activity rows"
```

---

## Task 2: `read_case` tool

**Files:**
- Create: `src/lib/ai/tools/read_case.ts`
- Test: `tests/ai/read_case.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ai/read_case.test.ts
import { describe, it, expect, vi } from 'vitest';
import { makeReadCaseTool } from '@/lib/ai/tools/read_case';
import type { CaseFacts } from '@/lib/case/schema';

const defaults = { defaultCaseId: 'c0000000-0000-4000-8000-000000000000' };

const facts: CaseFacts = {
  employment: {
    annualGrossSalaryEur: {
      value: 55000, source: 'user_stated', sourceTurnId: null,
      confidence: 0.9, updatedAt: '2026-05-29T00:00:00.000Z',
    },
  },
};

function repoReturning(caseFacts: CaseFacts) {
  return { loadCase: vi.fn().mockResolvedValue({ caseFacts }) };
}

describe('read_case tool', () => {
  it('exposes a tool with description, zod input, and ephemeral cache', () => {
    const tool = makeReadCaseTool(repoReturning(facts), defaults);
    expect((tool.description ?? '').length).toBeGreaterThan(40);
    expect(tool.inputSchema).toBeDefined();
    expect(tool.providerOptions?.anthropic).toEqual({ cacheControl: { type: 'ephemeral' } });
  });

  it('returns the full facts when no selector is given', async () => {
    const tool = makeReadCaseTool(repoReturning(facts), defaults);
    const out = await tool.execute!({}, {} as never);
    expect(out).toEqual({
      type: 'read_case_result',
      version: 1,
      data: { kind: 'full', facts },
    });
  });

  it('returns a single section subtree when section is given', async () => {
    const tool = makeReadCaseTool(repoReturning(facts), defaults);
    const out = await tool.execute!({ section: 'employment' }, {} as never);
    expect(out).toEqual({
      type: 'read_case_result',
      version: 1,
      data: { kind: 'section', section: 'employment', value: facts.employment },
    });
  });

  it('returns path values (null for missing) when paths are given', async () => {
    const tool = makeReadCaseTool(repoReturning(facts), defaults);
    const out = await tool.execute!(
      { paths: ['employment.annualGrossSalaryEur', 'education.highestDegree'] },
      {} as never,
    );
    expect(out).toEqual({
      type: 'read_case_result',
      version: 1,
      data: {
        kind: 'paths',
        values: {
          'employment.annualGrossSalaryEur': facts.employment!.annualGrossSalaryEur,
          'education.highestDegree': null,
        },
      },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/ai/read_case.test.ts`
Expected: FAIL — cannot find module `@/lib/ai/tools/read_case`.

- [ ] **Step 3: Implement the tool**

```typescript
// src/lib/ai/tools/read_case.ts
import { tool } from 'ai';
import { z } from 'zod';
import { getAtPath } from '@/lib/case/paths';
import type { CaseFacts } from '@/lib/case/schema';
import type { Repository } from '@/lib/case/repository';

const description = [
  'Read the current case facts. Most case state is already provided to you in your context,',
  'so call this only when you need the FULL detail or provenance of a specific section or path',
  'that the context summary may have abbreviated.',
  'Pass `section` to read one subtree (employment | education | family | target),',
  'or `paths` to read specific dotted leaves (e.g. "employment.annualGrossSalaryEur").',
  'With no arguments it returns the entire case facts object.',
  'This tool is read-only — it never changes the case.',
].join(' ');

export const ReadCaseInputSchema = z.object({
  section: z.enum(['employment', 'education', 'family', 'target']).optional(),
  paths: z.array(z.string()).optional(),
});
export type ReadCaseInput = z.infer<typeof ReadCaseInputSchema>;

export interface ReadCaseToolDefaults {
  defaultCaseId: string;
}

export function makeReadCaseTool(
  repo: Pick<Repository, 'loadCase'>,
  defaults: ReadCaseToolDefaults,
) {
  return tool({
    description,
    inputSchema: ReadCaseInputSchema,
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    async execute(input: ReadCaseInput) {
      const loaded = await repo.loadCase(defaults.defaultCaseId);
      const facts = loaded.caseFacts;

      if (input.paths && input.paths.length > 0) {
        const values: Record<string, unknown> = {};
        for (const p of input.paths) {
          values[p] = getAtPath(facts as Record<string, unknown>, p) ?? null;
        }
        return { type: 'read_case_result' as const, version: 1 as const, data: { kind: 'paths' as const, values } };
      }

      if (input.section) {
        return {
          type: 'read_case_result' as const,
          version: 1 as const,
          data: {
            kind: 'section' as const,
            section: input.section,
            value: (facts as Record<string, unknown>)[input.section] ?? null,
          },
        };
      }

      return { type: 'read_case_result' as const, version: 1 as const, data: { kind: 'full' as const, facts } };
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/ai/read_case.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/tools/read_case.ts tests/ai/read_case.test.ts
git commit -m "feat: read_case tool (read-only case slice + provenance)"
```

---

## Task 3: `add_case_note` tool

**Files:**
- Create: `src/lib/ai/tools/add_case_note.ts`
- Test: `tests/ai/add_case_note.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ai/add_case_note.test.ts
import { describe, it, expect, vi } from 'vitest';
import { makeAddCaseNoteTool } from '@/lib/ai/tools/add_case_note';

const defaults = {
  defaultCaseId: 'c0000000-0000-4000-8000-000000000000',
  defaultUserId: 'u0000000-0000-4000-8000-000000000000',
  defaultSourceTurnId: 't0000000-0000-4000-8000-000000000000',
};

describe('add_case_note tool', () => {
  it('exposes a tool with description, zod input, and ephemeral cache', () => {
    const tool = makeAddCaseNoteTool({ appendActivity: vi.fn() }, defaults);
    expect((tool.description ?? '').length).toBeGreaterThan(40);
    expect(tool.inputSchema).toBeDefined();
    expect(tool.providerOptions?.anthropic).toEqual({ cacheControl: { type: 'ephemeral' } });
  });

  it('appends a case.note.added activity row and returns noted:true', async () => {
    const appendActivity = vi.fn().mockResolvedValue(undefined);
    const tool = makeAddCaseNoteTool({ appendActivity }, defaults);
    const out = await tool.execute!({ note: 'user anxious about timeline' }, {} as never);

    expect(appendActivity).toHaveBeenCalledOnce();
    expect(appendActivity.mock.calls[0]![0]).toEqual({
      caseId: defaults.defaultCaseId,
      userId: defaults.defaultUserId,
      kind: 'case.note.added',
      payload: { note: 'user anxious about timeline', sourceTurnId: defaults.defaultSourceTurnId },
    });
    expect(out).toEqual({ type: 'add_case_note_result', version: 1, data: { noted: true } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/ai/add_case_note.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the tool**

```typescript
// src/lib/ai/tools/add_case_note.ts
import { tool } from 'ai';
import { z } from 'zod';
import type { Repository } from '@/lib/case/repository';

const description = [
  'Record a free-text observation about the case that is NOT a structured fact —',
  'for example "user is anxious about the timeline" or "user mentioned a prior visa refusal, follow up".',
  'Use update_case for structured facts; use this only for annotations worth remembering.',
  'The note is appended to the case activity log. It does not change any case fact.',
].join(' ');

export const AddCaseNoteInputSchema = z.object({
  note: z.string().min(1),
});
export type AddCaseNoteInput = z.infer<typeof AddCaseNoteInputSchema>;

export interface AddCaseNoteToolDefaults {
  defaultCaseId: string;
  defaultUserId: string;
  defaultSourceTurnId: string;
}

export function makeAddCaseNoteTool(
  repo: Pick<Repository, 'appendActivity'>,
  defaults: AddCaseNoteToolDefaults,
) {
  return tool({
    description,
    inputSchema: AddCaseNoteInputSchema,
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    async execute(input: AddCaseNoteInput) {
      await repo.appendActivity({
        caseId: defaults.defaultCaseId,
        userId: defaults.defaultUserId,
        kind: 'case.note.added',
        payload: { note: input.note, sourceTurnId: defaults.defaultSourceTurnId },
      });
      return { type: 'add_case_note_result' as const, version: 1 as const, data: { noted: true } };
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/ai/add_case_note.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/tools/add_case_note.ts tests/ai/add_case_note.test.ts
git commit -m "feat: add_case_note tool (append-only annotation)"
```

---

## Task 4: `out_of_scope` tool

**Files:**
- Create: `src/lib/ai/tools/out_of_scope.ts`
- Test: `tests/ai/out_of_scope.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ai/out_of_scope.test.ts
import { describe, it, expect, vi } from 'vitest';
import { makeOutOfScopeTool } from '@/lib/ai/tools/out_of_scope';

const defaults = {
  defaultCaseId: 'c0000000-0000-4000-8000-000000000000',
  defaultUserId: 'u0000000-0000-4000-8000-000000000000',
};

describe('out_of_scope tool', () => {
  it('exposes a tool with description, zod input, and ephemeral cache', () => {
    const tool = makeOutOfScopeTool({ appendActivity: vi.fn() }, defaults);
    expect((tool.description ?? '').length).toBeGreaterThan(40);
    expect(tool.inputSchema).toBeDefined();
    expect(tool.providerOptions?.anthropic).toEqual({ cacheControl: { type: 'ephemeral' } });
  });

  it('logs case.out_of_scope and returns the structured refusal', async () => {
    const appendActivity = vi.fn().mockResolvedValue(undefined);
    const tool = makeOutOfScopeTool({ appendActivity }, defaults);
    const out = await tool.execute!(
      { reason: 'Apartment search is outside this Blue Card assistant.', category: 'unsupported_request' },
      {} as never,
    );

    expect(appendActivity).toHaveBeenCalledOnce();
    expect(appendActivity.mock.calls[0]![0]).toEqual({
      caseId: defaults.defaultCaseId,
      userId: defaults.defaultUserId,
      kind: 'case.out_of_scope',
      payload: { reason: 'Apartment search is outside this Blue Card assistant.', category: 'unsupported_request' },
    });
    expect(out).toEqual({
      type: 'out_of_scope_result',
      version: 1,
      data: { reason: 'Apartment search is outside this Blue Card assistant.', category: 'unsupported_request' },
    });
  });

  it('defaults category to null when omitted', async () => {
    const appendActivity = vi.fn().mockResolvedValue(undefined);
    const tool = makeOutOfScopeTool({ appendActivity }, defaults);
    const out = await tool.execute!({ reason: 'Off topic.' }, {} as never);
    expect((out as { data: { category: unknown } }).data.category).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/ai/out_of_scope.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the tool**

```typescript
// src/lib/ai/tools/out_of_scope.ts
import { tool } from 'ai';
import { z } from 'zod';
import type { Repository } from '@/lib/case/repository';

const description = [
  'Decline a request that falls outside what this assistant does.',
  'This assistant only helps with EU Blue Card applications to Germany via the Bengaluru consulate.',
  'Use this when the user asks for something unsupported (apartment hunting, banking, other visa types,',
  'other destination countries, legal representation, etc.).',
  'Provide a short user-facing `reason` and an optional `category`.',
  'This does NOT decide eligibility — it only records that a request was declined.',
].join(' ');

export const OutOfScopeInputSchema = z.object({
  reason: z.string().min(1),
  category: z.string().optional(),
});
export type OutOfScopeInput = z.infer<typeof OutOfScopeInputSchema>;

export interface OutOfScopeToolDefaults {
  defaultCaseId: string;
  defaultUserId: string;
}

export function makeOutOfScopeTool(
  repo: Pick<Repository, 'appendActivity'>,
  defaults: OutOfScopeToolDefaults,
) {
  return tool({
    description,
    inputSchema: OutOfScopeInputSchema,
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    async execute(input: OutOfScopeInput) {
      const category = input.category ?? null;
      await repo.appendActivity({
        caseId: defaults.defaultCaseId,
        userId: defaults.defaultUserId,
        kind: 'case.out_of_scope',
        payload: { reason: input.reason, category },
      });
      return { type: 'out_of_scope_result' as const, version: 1 as const, data: { reason: input.reason, category } };
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/ai/out_of_scope.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/tools/out_of_scope.ts tests/ai/out_of_scope.test.ts
git commit -m "feat: out_of_scope tool (structured refusal; does not set eligibility flag)"
```

---

## Task 5: Real `buildAgentContext`

**Files:**
- Modify: `src/lib/ai/chat/context-builder.ts` (full rewrite)
- Test: `tests/ai/context-builder.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ai/context-builder.test.ts
import { describe, it, expect } from 'vitest';
import { buildAgentContext } from '@/lib/ai/chat/context-builder';
import type { CaseFacts } from '@/lib/case/schema';

const facts: CaseFacts = {
  employment: {
    annualGrossSalaryEur: {
      value: 55000, source: 'user_stated', sourceTurnId: null,
      confidence: 0.9, updatedAt: '2026-05-29T00:00:00.000Z',
    },
  },
};

describe('buildAgentContext', () => {
  it('returns a systemContext string containing the full case facts JSON', async () => {
    const ctx = await buildAgentContext({ caseId: 'case-1', caseFacts: facts });
    expect(typeof ctx.systemContext).toBe('string');
    expect(ctx.systemContext).toContain('55000');
    expect(ctx.systemContext).toContain('employment');
  });

  it('includes a section-presence summary line', async () => {
    const ctx = await buildAgentContext({ caseId: 'case-1', caseFacts: facts });
    // employment has data; education/family/target do not.
    expect(ctx.systemContext).toMatch(/employment: known/i);
    expect(ctx.systemContext).toMatch(/education: not yet/i);
  });

  it('handles empty facts without throwing', async () => {
    const ctx = await buildAgentContext({ caseId: 'case-1', caseFacts: {} });
    expect(ctx.systemContext).toMatch(/education: not yet/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/ai/context-builder.test.ts`
Expected: FAIL — `ctx.systemContext` is undefined (current stub returns `{ caseFactsJson }`).

- [ ] **Step 3: Rewrite the context builder**

```typescript
// src/lib/ai/chat/context-builder.ts
import type { CaseFacts } from '@/lib/case/schema';

export interface AgentContext {
  systemContext: string;
}

const SECTIONS = ['employment', 'education', 'family', 'target'] as const;

function sectionSummary(caseFacts: CaseFacts): string {
  return SECTIONS.map((s) => {
    const subtree = (caseFacts as Record<string, unknown>)[s] as Record<string, unknown> | undefined;
    const hasData = !!subtree && Object.keys(subtree).length > 0;
    return `${s}: ${hasData ? 'known' : 'not yet provided'}`;
  }).join(', ');
}

export async function buildAgentContext(input: {
  caseId: string;
  caseFacts: CaseFacts;
}): Promise<AgentContext> {
  const summary = sectionSummary(input.caseFacts);
  const factsJson = JSON.stringify(input.caseFacts, null, 2);
  const systemContext = [
    '## Current case state',
    '',
    `Sections — ${summary}.`,
    '',
    'Full case facts (each leaf carries value + provenance):',
    '```json',
    factsJson,
    '```',
  ].join('\n');
  return { systemContext };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/ai/context-builder.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/chat/context-builder.ts tests/ai/context-builder.test.ts
git commit -m "feat: real buildAgentContext (full facts + section-presence summary)"
```

> Note: the route still discards this return until Task 8. `tsc` may flag the changed return shape only where consumed; the route currently does `await buildAgentContext(...)` without using the result, so it stays valid.

---

## Task 6: Real `v0.md` prompt + version bump

**Files:**
- Create: `prompts/agent/v0.md`
- Modify: `src/lib/ai/chat/system-prompt.ts`

- [ ] **Step 1: Write the prompt**

Create `prompts/agent/v0.md`:

```markdown
# Role

You are the case-management assistant for an EU Blue Card application to Germany.
You help a skilled worker in India assemble a complete, submission-ready Blue Card
application for the **Bengaluru** German consulate. You work alongside an
always-visible case file — the case file is the product, the chat is one panel.

# Scope

In scope: EU Blue Card to Germany, applicant in India, Bengaluru consulate.

Out of scope (use the `out_of_scope` tool): other visa types, other destination
countries, apartment hunting, banking, tax advice, legal representation,
appointment booking, and anything unrelated to assembling this application.

# How you work

- Build the case by **extracting structured facts** from what the user tells you
  and persisting them with the `update_case` tool.
- Every consequential write is the user's to confirm. When the user contradicts a
  fact already on file, **acknowledge it, confirm the new value, then update** —
  never silently overwrite.
- Be concise and warm. Ask one thing at a time. Don't interrogate.

# Tools

- **update_case** — persist structured facts (employment, education, family,
  target). One call may carry several leaf updates sharing a source/confidence.
- **read_case** — read full detail/provenance of a section or path. Your context
  already contains the current case facts, so use this sparingly.
- **add_case_note** — record a free-text observation that is not a structured
  fact (e.g. "user anxious about timeline").
- **check_eligibility** — run the deterministic eligibility check once you have
  enough information (employment + education at minimum). *(Available from a later
  build step; if it is not yet present, gather facts and tell the user the check
  will run when enough is known.)*
- **lookup_anabin** — look up the recognition status of a foreign degree/
  institution. *(Available from a later build step.)*
- **out_of_scope** — decline a request outside the scope above.

# Hard rules

- **Never quote a number from your own knowledge** — salary thresholds, fees,
  processing times, required years. These change yearly and are computed by tools
  that read verified configuration. If asked "what's the threshold?", run the
  relevant tool; do not state a figure yourself.
- **Never tell a user they "definitely qualify."** Eligibility is deterministic
  and produced by the eligibility check, not by you. Describe uncertainty plainly.
- **No legal advice.** You assemble an application; you are not a lawyer.
- Do not invent facts or paths. If unsure what the user means, ask.
```

- [ ] **Step 2: Update the loader**

Replace `src/lib/ai/chat/system-prompt.ts` contents:

```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PROMPT_VERSION = 'v0';

export const systemPrompt: string = readFileSync(
  join(process.cwd(), 'prompts/agent/v0.md'),
  'utf8',
);
```

- [ ] **Step 3: Verify it loads (typecheck + existing route test still green)**

Run: `pnpm exec vitest run tests/api/chat.test.ts`
Expected: PASS — the route test does not assert `PROMPT_VERSION`'s value, only that rows persist. (If any test pins `'v0-stub'`, update it to `'v0'`.)

- [ ] **Step 4: Commit**

```bash
git add prompts/agent/v0.md src/lib/ai/chat/system-prompt.ts
git commit -m "feat: real agent system prompt v0; bump PROMPT_VERSION to v0"
```

---

## Task 7: `buildAgentTurn` factory (model seam)

**Files:**
- Create: `src/lib/ai/chat/agent-turn.ts`
- Test: `tests/ai/agent-turn.test.ts`

This extracts the loop from `route.ts`. It owns: composing `systemPrompt + context`, building the tool set, `stopWhen`, prompt caching, and `onFinish` (persistence + Inngest emit). The route injects the model.

- [ ] **Step 1: Write the failing test (dependency-free seam test)**

```typescript
// tests/ai/agent-turn.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as AiModule from 'ai';

// Capture streamText args (model seam, tools, system) without a real model.
let captured: { model?: unknown; tools?: Record<string, unknown>; system?: string; onFinish?: (e: unknown) => Promise<void> } = {};
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof AiModule>('ai');
  return {
    ...actual,
    streamText: vi.fn((opts: { model: unknown; tools: Record<string, unknown>; system: string; onFinish?: (e: unknown) => Promise<void> }) => {
      captured = { model: opts.model, tools: opts.tools, system: opts.system, onFinish: opts.onFinish };
      return { toUIMessageStreamResponse: () => new Response(null, { status: 200 }) };
    }),
  };
});

const appendChatTurnSpy = vi.fn().mockResolvedValue({ assistantMessageId: 'a1' });
vi.mock('@/lib/ai/chat/persistence', () => ({
  appendChatTurn: (...args: unknown[]) => appendChatTurnSpy(...args),
}));

const inngestSendSpy = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: inngestSendSpy } }));

import { buildAgentTurn } from '@/lib/ai/chat/agent-turn';

const SENTINEL_MODEL = { __sentinel: true } as never;

function baseParams() {
  return {
    model: SENTINEL_MODEL,
    repo: { appendActivity: vi.fn(), loadCase: vi.fn(), applyUpdate: vi.fn() } as never,
    caseId: 'c0000000-0000-4000-8000-000000000000',
    threadId: 't0000000-0000-4000-8000-000000000000',
    userId: 'u0000000-0000-4000-8000-000000000000',
    userMessageId: 'm0000000-0000-4000-8000-000000000000',
    caseFacts: {},
    modelMessages: [{ role: 'user', content: 'hi' }] as never,
  };
}

describe('buildAgentTurn', () => {
  beforeEach(() => { captured = {}; vi.clearAllMocks(); });

  it('passes the injected model straight through to streamText', async () => {
    await buildAgentTurn(baseParams());
    expect(captured.model).toBe(SENTINEL_MODEL);
  });

  it('registers all four tools', async () => {
    await buildAgentTurn(baseParams());
    expect(Object.keys(captured.tools ?? {}).sort()).toEqual(
      ['add_case_note', 'out_of_scope', 'read_case', 'update_case'].sort(),
    );
  });

  it('injects the case context into the system string', async () => {
    await buildAgentTurn(baseParams());
    expect(captured.system).toContain('Current case state');
  });

  it('persists and emits inngest in onFinish when update_case fired', async () => {
    await buildAgentTurn(baseParams());
    await captured.onFinish!({
      text: 'ok',
      content: [{ type: 'text', text: 'ok' }],
      toolCalls: [{ toolCallId: 'x', toolName: 'update_case', input: {} }],
      toolResults: [{ toolCallId: 'x', toolName: 'update_case', output: { type: 'update_case_result', version: 1, data: { caseId: 'c', updatedPaths: ['employment.jobTitle'], contradictions: [] } } }],
    });
    expect(appendChatTurnSpy).toHaveBeenCalledOnce();
    expect(inngestSendSpy).toHaveBeenCalledOnce();
    expect(inngestSendSpy.mock.calls[0]![0].data.paths).toEqual(['employment.jobTitle']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/ai/agent-turn.test.ts`
Expected: FAIL — cannot find module `@/lib/ai/chat/agent-turn`.

- [ ] **Step 3: Implement the factory**

```typescript
// src/lib/ai/chat/agent-turn.ts
import { streamText, stepCountIs, type LanguageModel, type ModelMessage } from 'ai';
import { systemPrompt } from '@/lib/ai/chat/system-prompt';
import { PROMPT_VERSION } from '@/lib/ai/chat/system-prompt';
import { buildAgentContext } from '@/lib/ai/chat/context-builder';
import { appendChatTurn } from '@/lib/ai/chat/persistence';
import { makeUpdateCaseTool } from '@/lib/ai/tools/update_case';
import { makeReadCaseTool } from '@/lib/ai/tools/read_case';
import { makeAddCaseNoteTool } from '@/lib/ai/tools/add_case_note';
import { makeOutOfScopeTool } from '@/lib/ai/tools/out_of_scope';
import { inngest } from '@/lib/inngest/client';
import type { Repository } from '@/lib/case/repository';
import type { CaseFacts } from '@/lib/case/schema';
import { MODEL_ID } from '@/lib/ai/provider';

export interface BuildAgentTurnParams {
  model: LanguageModel;
  repo: Repository;
  caseId: string;
  threadId: string;
  userId: string;
  userMessageId: string;
  caseFacts: CaseFacts;
  modelMessages: ModelMessage[];
}

function extractLastUserText(messages: { role?: string; content?: unknown }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user') {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        const text = m.content.find((p: { type?: string; text?: string }) => p?.type === 'text');
        if (text && typeof text.text === 'string') return text.text;
      }
    }
  }
  return '';
}

export async function buildAgentTurn(params: BuildAgentTurnParams) {
  const { model, repo, caseId, threadId, userId, userMessageId, caseFacts, modelMessages } = params;

  const context = await buildAgentContext({ caseId, caseFacts });
  const system = `${systemPrompt}\n\n${context.systemContext}`;

  const tools = {
    update_case: makeUpdateCaseTool(repo, { defaultCaseId: caseId, defaultSourceTurnId: userMessageId }),
    read_case: makeReadCaseTool(repo, { defaultCaseId: caseId }),
    add_case_note: makeAddCaseNoteTool(repo, { defaultCaseId: caseId, defaultUserId: userId, defaultSourceTurnId: userMessageId }),
    out_of_scope: makeOutOfScopeTool(repo, { defaultCaseId: caseId, defaultUserId: userId }),
  };

  return streamText({
    model,
    system,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(5),
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    async onFinish(event) {
      try {
        await appendChatTurn({
          threadId,
          userMessageId,
          userMessageContent: extractLastUserText(modelMessages as never),
          assistantText: event.text,
          assistantParts: event.content,
          toolCalls: event.toolCalls.map((c) => ({ toolCallId: c.toolCallId, toolName: c.toolName, input: c.input })),
          toolResults: event.toolResults.map((r) => ({ toolCallId: r.toolCallId, toolName: r.toolName, output: r.output })),
          promptVersion: PROMPT_VERSION,
          modelVersion: MODEL_ID,
        });
      } catch (err) {
        console.error('appendChatTurn failed', err);
      }

      const updateResults = event.toolResults.filter((r) => r.toolName === 'update_case');
      for (const result of updateResults) {
        const data = (result.output as { data?: { updatedPaths?: string[] } })?.data;
        try {
          await inngest.send({
            name: 'case.facts.updated',
            data: { caseId, paths: data?.updatedPaths ?? [], sourceTurnId: userMessageId },
          });
        } catch (err) {
          console.error('inngest emit failed', err);
        }
      }
    },
  });
}
```

> Note: `appendChatTurn` here is called without an explicit `db` arg — it falls back to the static `defaultDb` import (per CLAUDE.md default-db pattern). The route currently passes `db` explicitly; Task 8 drops that since the factory owns the call. Tests mock `@/lib/ai/chat/persistence` (seam test) or `@/lib/db/client` (route test).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/ai/agent-turn.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/chat/agent-turn.ts tests/ai/agent-turn.test.ts
git commit -m "feat: buildAgentTurn factory — injectable-model agent-loop seam"
```

---

## Task 8: Route delegates to `buildAgentTurn`

**Files:**
- Modify: `src/app/api/chat/route.ts` (full rewrite of the body)

- [ ] **Step 1: Confirm the existing route test is the spec**

The three tests in `tests/api/chat.test.ts` (401, 403, persist+emit, no-emit) must stay green. They mock `ai`'s `streamText` and capture `onFinish` — since `buildAgentTurn` calls `streamText`, capture still works through delegation.

- [ ] **Step 2: Rewrite the route**

```typescript
// src/app/api/chat/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { convertToModelMessages, type LanguageModel } from 'ai';
import { anthropic, MODEL_ID } from '@/lib/ai/provider';
import { buildAgentTurn } from '@/lib/ai/chat/agent-turn';
import { makeRepository } from '@/lib/case/repository';
import { getCurrentUserId } from '@/lib/auth/session';
import { db } from '@/lib/db/client';

export const runtime = 'nodejs';

const BodySchema = z.object({
  caseId: z.string().uuid(),
  messages: z.array(z.unknown()).min(1),
});

export async function POST(req: Request) {
  const body = BodySchema.parse(await req.json());
  const userId = await getCurrentUserId();
  if (!userId) return new NextResponse('unauthorized', { status: 401 });

  const repo = makeRepository(db);
  const loaded = await repo.loadCase(body.caseId);
  if (loaded.case.userId !== userId) return new NextResponse('forbidden', { status: 403 });

  const userMessageId = crypto.randomUUID();
  const modelMessages = await convertToModelMessages(body.messages as never);

  const result = await buildAgentTurn({
    // reason: @ai-sdk/anthropic@3 returns LanguageModelV3 while ai@5 expects LanguageModelV2; same runtime shape.
    model: anthropic(MODEL_ID) as unknown as LanguageModel,
    repo,
    caseId: body.caseId,
    threadId: loaded.threadId,
    userId,
    userMessageId,
    caseFacts: loaded.caseFacts,
    modelMessages,
  });

  return result.toUIMessageStreamResponse();
}
```

- [ ] **Step 3: Run the route test**

Run: `pnpm exec vitest run tests/api/chat.test.ts`
Expected: PASS (4 tests). If the persist test fails because `appendChatTurn` no longer receives an explicit `db`, confirm the test's `vi.mock('@/lib/db/client', () => ({ get db() {...} }))` getter is present (it is) — the static `defaultDb` import resolves through that mock.

- [ ] **Step 4: Run the full suite to check nothing regressed**

Run: `pnpm exec vitest run`
Expected: all green (previous 110 + new tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "refactor: chat route delegates loop to buildAgentTurn; registers full 2A.1 tool set"
```

---

## Task 9: Renderer registry

**Files:**
- Create: `src/components/workspace/renderers/registry.tsx`
- Test: `tests/components/renderers.test.ts`

The registry is a pure lookup returning a React component, so it is testable without a DOM.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/components/renderers.test.ts
import { describe, it, expect } from 'vitest';
import {
  resolveRenderer,
  UpdateCaseResult,
  ReadCaseResult,
  AddCaseNoteResult,
  OutOfScopeResult,
  FallbackResult,
} from '@/components/workspace/renderers/registry';

describe('renderer registry', () => {
  it('resolves each known result type to its renderer', () => {
    expect(resolveRenderer('update_case_result')).toBe(UpdateCaseResult);
    expect(resolveRenderer('read_case_result')).toBe(ReadCaseResult);
    expect(resolveRenderer('add_case_note_result')).toBe(AddCaseNoteResult);
    expect(resolveRenderer('out_of_scope_result')).toBe(OutOfScopeResult);
  });

  it('falls back for an unknown type', () => {
    expect(resolveRenderer('something_new_result')).toBe(FallbackResult);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/components/renderers.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the registry**

```tsx
// src/components/workspace/renderers/registry.tsx
import type { ReactNode } from 'react';

export interface ToolOutput {
  type: string;
  version: number;
  data: unknown;
}

export type Renderer = (props: { output: ToolOutput }) => ReactNode;

export const UpdateCaseResult: Renderer = ({ output }) => {
  const data = output.data as { updatedPaths?: string[]; contradictions?: unknown[] };
  const n = data.updatedPaths?.length ?? 0;
  return (
    <span className="text-xs text-zinc-500">
      Updated {n} field{n === 1 ? '' : 's'}
      {data.contradictions && data.contradictions.length > 0 ? ' (contradiction noted)' : ''}
    </span>
  );
};

export const ReadCaseResult: Renderer = () => (
  <span className="text-xs text-zinc-400">Read case details</span>
);

export const AddCaseNoteResult: Renderer = () => (
  <span className="text-xs text-zinc-400">Noted</span>
);

export const OutOfScopeResult: Renderer = ({ output }) => {
  const data = output.data as { reason?: string };
  return (
    <span className="block rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800">
      Out of scope: {data.reason ?? 'This request is outside what I can help with.'}
    </span>
  );
};

export const FallbackResult: Renderer = ({ output }) => (
  <span className="text-xs text-zinc-400">[{output.type}]</span>
);

const registry: Record<string, Renderer> = {
  update_case_result: UpdateCaseResult,
  read_case_result: ReadCaseResult,
  add_case_note_result: AddCaseNoteResult,
  out_of_scope_result: OutOfScopeResult,
};

export function resolveRenderer(type: string): Renderer {
  return registry[type] ?? FallbackResult;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/components/renderers.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/renderers/registry.tsx tests/components/renderers.test.ts
git commit -m "feat: renderer registry — dispatch tool outputs on type (rule 8)"
```

---

## Task 10: `ChatPanel` dispatches via registry

**Files:**
- Modify: `src/components/workspace/ChatPanel.tsx` (the tool-part branch, lines 59-64)

- [ ] **Step 1: Replace the placeholder tool-part branch**

In `src/components/workspace/ChatPanel.tsx`, add the import near the top:

```tsx
import { resolveRenderer, type ToolOutput } from '@/components/workspace/renderers/registry';
```

Replace the existing tool-part branch (currently):

```tsx
                      if (part.type.startsWith('tool-'))
                        return (
                          <span key={i} className="opacity-60 text-xs">
                            [{part.type}]
                          </span>
                        );
```

with:

```tsx
                      if (part.type.startsWith('tool-')) {
                        const out = (part as { output?: ToolOutput }).output;
                        if (!out?.type) return null;
                        const Renderer = resolveRenderer(out.type);
                        return <Renderer key={i} output={out} />;
                      }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean. (`messageContainsUpdateCase` and the `router.refresh()` gate stay unchanged — still keyed on `tool-update_case` parts.)

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/workspace/ChatPanel.tsx
git commit -m "feat: ChatPanel renders tool outputs via renderer registry"
```

---

## Task 11: Full verification gate

- [ ] **Step 1: Full test suite**

Run: `pnpm exec vitest run`
Expected: all green. New test files: `append-activity`, `read_case`, `add_case_note`, `out_of_scope`, `context-builder`, `agent-turn`, `renderers` (≈ 110 prior + ~20 new).

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: success. (Watch for the `@import "shadcn/tailwind.css"` re-injection gotcha and prod env-validation — neither should trigger here.)

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean. (No new `any`; the one model cast in the route carries a `// reason:` comment.)

- [ ] **Step 5: Live smoke (manual)**

1. `pnpm dev` (+ `npx inngest-cli@latest dev` if testing Inngest emit).
2. Sign in, create a case, open `/case/[id]`.
3. Send "I have an M.Tech and a job offer in Munich paying €70,000" → observe `update_case` renders "Updated N fields" via the registry, and case facts update on refresh.
4. Send "Can you also help me find an apartment in Berlin?" → observe `out_of_scope` renders the amber refusal card.
5. Confirm an `activity_log` row exists for the out-of-scope event (use `scripts/dev-only/db-state.ts`).

- [ ] **Step 6: Update CLAUDE.md current-state table + commit**

Mark 2A.1 complete in the Current state table; note the `buildAgentTurn` seam and renderer registry as new patterns. Commit:

```bash
git add CLAUDE.md
git commit -m "docs: mark Phase 2A.1 complete; record buildAgentTurn seam + renderer registry"
```

---

## Self-review

**Spec coverage** (against `2026-05-29-phase-2a-1-agent-brain-design.md`):
- §2.1 `buildAgentContext` → Task 5 ✓; route uses return → Task 8 ✓
- §2.2 `v0.md` + `PROMPT_VERSION='v0'` → Task 6 ✓
- §2.3 `buildAgentTurn` model seam → Task 7 ✓
- §2.4 three tools → Tasks 2, 3, 4 ✓
- §2.5 renderer registry + ChatPanel → Tasks 9, 10 ✓
- §2.6 `appendActivity` → Task 1 ✓
- D2 (note → activity_log `case.note.added`) → Task 3 ✓
- D3 (context = full facts only, no activity tail) → Task 5 ✓ (no `listRecentActivity`)
- §4.4 `out_of_scope` does NOT set eligibility flag → Task 4 ✓ (only appends activity)
- §5 tests → each task is TDD ✓; seam test uses dependency-free pattern (MockLanguageModelV2 unavailable) ✓
- §6 verification gate → Task 11 ✓

**Placeholder scan:** none — every code step shows full code.

**Type consistency:** `appendActivity(input: AppendActivityInput)` shape `{caseId,userId,kind,payload}` is identical across Task 1 (def), Task 3, Task 4. `{type, version, data}` output shape consistent across all tools and the registry's `ToolOutput`. `buildAgentContext` returns `{ systemContext }` in Task 5 and is consumed as `context.systemContext` in Task 7. Tool factory names (`makeReadCaseTool`, `makeAddCaseNoteTool`, `makeOutOfScopeTool`) match between their tasks and Task 7's imports.

**Note on Task 6 prompt:** v0.md references `check_eligibility` / `lookup_anabin` (not registered until 2A.2) per decision D6; the prompt frames them as "available from a later build step," and Task 7 registers only the four existing tools — so a live smoke cannot call a missing tool.
