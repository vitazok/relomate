# Phase 2A.2 — Eligibility + Knowledge Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing pure eligibility engine and Anabin seed into the agent loop as two new tools — `check_eligibility` and `lookup_anabin` — with transparency-first renderer cards, while consolidating tool cache breakpoints to stay within Anthropic's limit.

**Architecture:** Two new pure functions in the rules module (`assessReadiness`, `summarizeFigures`) sit between the agent and the untouched `evaluateEligibility` engine. Two new AI-SDK tools call them and return discriminated-union `{type, version, data}` outputs that render as cards in the registry. The verdict is ephemeral (compute-on-demand) with an append-only `activity_log` trail. Before adding the two tools, the four per-tool `cache_control` breakpoints collapse to a single tool-block breakpoint (Anthropic max is 4; six tools would 400).

**Tech Stack:** TypeScript strict, Vitest, Vercel AI SDK v6 (`tool()`), Zod, Drizzle (via existing `Repository`), js-yaml rules loader, React 19 renderers.

**Spec:** `docs/superpowers/specs/2026-05-31-phase-2a-2-eligibility-knowledge-design.md`

---

## Background the engineer needs

**Read these before starting:**
- `src/lib/rules/eligibility.ts` — the pure engine `evaluateEligibility(facts, profile, today)`. Returns codes only (no euro figures). Do NOT change its behavior; you only **export** its private `activeThreshold` helper in Task 2.
- `src/lib/ai/tools/update_case.ts` and `out_of_scope.ts` — the canonical tool factory pattern: `makeXTool(repo, defaults)` → `tool({ description, inputSchema, providerOptions, execute })` returning `{ type, version, data }`.
- `src/lib/case/repository.ts` — `Repository` interface. `loadCase(caseId)` returns `{ case, profile, caseFacts, threadId }` (profile may be `null`). `appendActivity({ caseId, userId, kind, payload })` writes an append-only row.
- `src/components/workspace/renderers/registry.tsx` — the `resolveRenderer(type)` registry.
- `src/lib/ai/chat/agent-turn.ts` — the `buildAgentTurn` factory that registers the tool set.
- CLAUDE.md "Tests / vitest" gotchas — especially: the `vi.mock('@/lib/db/client', () => ({ get db() { return testHandle.db; } }))` getter pattern, and `pnpm exec vitest run --no-file-parallelism` when a full-suite DB run hits `EMAXPOOLSREACHED`.

**Key facts:**
- All test UUIDs must be valid v4 (`sourceTurnId` is `z.string().uuid().nullable()`). Reuse the format `c0000000-0000-4000-8000-000000000000`.
- `confidence` provenance is `z.number().min(0).max(1)`.
- The active 2026 thresholds (from `config/rules/blue-card.yaml`): standard `50700`, reduced `45934.20`. Tests pin `today` inside the 2026 window.
- Tool tests call `tool.execute!(input, {} as never)` — the AI SDK passes a second options arg the tools ignore.
- Run a single test file with: `pnpm exec vitest run tests/path/to/file.test.ts`.

**Pure-function placement:** `assessReadiness` and `summarizeFigures` go in the rules module (`src/lib/rules/`) — not in the tools — because 2B's journey-tracker reuses them. They must not import anything from `src/lib/ai/`.

---

## File Structure

**New files:**
- `src/lib/rules/eligibility-readiness.ts` — `assessReadiness(facts) → { ready, missing }`. Pure.
- `src/lib/rules/eligibility-figures.ts` — `summarizeFigures(facts, today) → Figures`. Pure.
- `src/lib/ai/tools/check_eligibility.ts` — the tool factory.
- `src/lib/ai/tools/lookup_anabin.ts` — the tool factory.
- `tests/rules/eligibility-readiness.test.ts`
- `tests/rules/eligibility-figures.test.ts`
- `tests/ai/check_eligibility.test.ts`
- `tests/ai/lookup_anabin.test.ts`

**Modified files:**
- `src/lib/rules/eligibility.ts` — export `activeThreshold` (no behavior change).
- `src/lib/ai/tools/{update_case,read_case,add_case_note,out_of_scope}.ts` — remove per-tool `providerOptions`.
- `tests/ai/{update_case,read_case,add_case_note,out_of_scope}.test.ts` — remove the per-tool `providerOptions` assertions.
- `src/lib/ai/chat/agent-turn.ts` — register two tools; single cache breakpoint; replace NOTE.
- `src/components/workspace/renderers/registry.tsx` — add two renderers.
- `prompts/agent/v0.md` — un-caveat the two tools; add "when to call".

---

## Task 1: Readiness gate (`assessReadiness`)

**Files:**
- Create: `src/lib/rules/eligibility-readiness.ts`
- Test: `tests/rules/eligibility-readiness.test.ts`

A case is ready for a meaningful verdict iff salary is present AND either (a) `anabinStatus` is present (degree routes) or (b) the IT-no-degree shape is present (`iscoCode` + `priorExperienceYears`, with no `highestDegree`). `missing` lists the dotted paths that would unblock the check.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/rules/eligibility-readiness.test.ts
import { describe, it, expect } from 'vitest';
import { assessReadiness } from '@/lib/rules/eligibility-readiness';
import type { CaseFacts } from '@/lib/case/schema';

const ISO = '2026-05-27T00:00:00.000Z';
const PROV = { source: 'user_stated' as const, sourceTurnId: null, confidence: 1, updatedAt: ISO };
const f = <T>(value: T) => ({ value, ...PROV });

describe('assessReadiness', () => {
  it('not ready when empty — lists salary as missing', () => {
    const r = assessReadiness({} as CaseFacts);
    expect(r.ready).toBe(false);
    expect(r.missing).toContain('employment.annualGrossSalaryEur');
  });

  it('ready with salary + anabinStatus (degree route shape)', () => {
    const facts: CaseFacts = {
      employment: { annualGrossSalaryEur: f(48500) },
      education: { anabinStatus: f('H+') },
    };
    expect(assessReadiness(facts)).toEqual({ ready: true, missing: [] });
  });

  it('ready with salary + IT-no-degree shape (isco + experience, no degree)', () => {
    const facts: CaseFacts = {
      employment: {
        annualGrossSalaryEur: f(52000),
        iscoCode: f('2522'),
        priorExperienceYears: f(5),
      },
    };
    expect(assessReadiness(facts)).toEqual({ ready: true, missing: [] });
  });

  it('not ready with salary but no degree signal and no IT shape — lists education', () => {
    const facts: CaseFacts = { employment: { annualGrossSalaryEur: f(52000) } };
    const r = assessReadiness(facts);
    expect(r.ready).toBe(false);
    expect(r.missing).toContain('education.anabinStatus');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/rules/eligibility-readiness.test.ts`
Expected: FAIL — cannot find module `@/lib/rules/eligibility-readiness`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/rules/eligibility-readiness.ts
import type { CaseFacts } from '@/lib/case/schema';

export interface ReadinessResult {
  ready: boolean;
  missing: string[];
}

export function assessReadiness(facts: CaseFacts): ReadinessResult {
  const missing: string[] = [];

  const salary = facts.employment?.annualGrossSalaryEur?.value;
  if (salary == null) missing.push('employment.annualGrossSalaryEur');

  const hasAnabin = facts.education?.anabinStatus?.value != null;
  const hasDegree = facts.education?.highestDegree?.value != null;
  const hasItShape =
    !hasDegree &&
    facts.employment?.iscoCode?.value != null &&
    facts.employment?.priorExperienceYears?.value != null;

  if (!hasAnabin && !hasItShape) {
    // Degree route needs a recognition signal; IT-no-degree route needs isco + experience.
    missing.push('education.anabinStatus');
  }

  return { ready: missing.length === 0, missing };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/rules/eligibility-readiness.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/rules/eligibility-readiness.ts tests/rules/eligibility-readiness.test.ts
git commit -m "feat: add assessReadiness eligibility-readiness gate"
```

---

## Task 2: Export `activeThreshold` from the engine

**Files:**
- Modify: `src/lib/rules/eligibility.ts:13-19`

`activeThreshold` is currently a private helper. Export it (no behavior change) so `summarizeFigures` reads the exact threshold the engine branches on. The existing engine + persona tests must remain green — this is the proof the change is behavior-preserving.

- [ ] **Step 1: Make the change**

In `src/lib/rules/eligibility.ts`, change the function declaration from:

```typescript
function activeThreshold(blueCard: BlueCardRules, today: Date) {
```

to:

```typescript
export function activeThreshold(blueCard: BlueCardRules, today: Date) {
```

- [ ] **Step 2: Verify the engine + persona suites still pass**

Run: `pnpm exec vitest run tests/eligibility.test.ts tests/personas/eligibility.test.ts`
Expected: PASS (all existing assertions unchanged).

- [ ] **Step 3: Commit**

```bash
git add src/lib/rules/eligibility.ts
git commit -m "refactor: export activeThreshold for figures helper (no behavior change)"
```

---

## Task 3: Figures helper (`summarizeFigures`)

**Files:**
- Create: `src/lib/rules/eligibility-figures.ts`
- Test: `tests/rules/eligibility-figures.test.ts`

Threshold-centric (NOT per-route): returns the standard + reduced thresholds with their `legalBasis`, plus `meets` (salary ≥ threshold, or `null` when salary absent). The card pairs this with the engine's granted `routes`; this helper never decides routes.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/rules/eligibility-figures.test.ts
import { describe, it, expect } from 'vitest';
import { summarizeFigures } from '@/lib/rules/eligibility-figures';
import type { CaseFacts } from '@/lib/case/schema';

const TODAY = new Date('2026-05-27T00:00:00.000Z');
const ISO = TODAY.toISOString();
const PROV = { source: 'user_stated' as const, sourceTurnId: null, confidence: 1, updatedAt: ISO };
const f = <T>(value: T) => ({ value, ...PROV });

describe('summarizeFigures', () => {
  it('returns active 2026 thresholds with legal basis', () => {
    const fig = summarizeFigures({} as CaseFacts, TODAY);
    expect(fig.standard.annualGrossEur).toBe(50700);
    expect(fig.reduced.annualGrossEur).toBeCloseTo(45934.2, 1);
    expect(fig.standard.legalBasis).toMatch(/18g/);
    expect(fig.reduced.legalBasis).toMatch(/18g/);
  });

  it('meets is null when salary absent', () => {
    const fig = summarizeFigures({} as CaseFacts, TODAY);
    expect(fig.salaryOnFile).toBeNull();
    expect(fig.standard.meets).toBeNull();
    expect(fig.reduced.meets).toBeNull();
  });

  it('computes meets vs salary on file', () => {
    const facts: CaseFacts = { employment: { annualGrossSalaryEur: f(48500) } };
    const fig = summarizeFigures(facts, TODAY);
    expect(fig.salaryOnFile).toBe(48500);
    expect(fig.standard.meets).toBe(false); // 48500 < 50700
    expect(fig.reduced.meets).toBe(true); // 48500 >= 45934.20
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/rules/eligibility-figures.test.ts`
Expected: FAIL — cannot find module `@/lib/rules/eligibility-figures`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/rules/eligibility-figures.ts
import type { CaseFacts } from '@/lib/case/schema';
import { getBlueCardRules } from '@/lib/rules/loader';
import { activeThreshold } from '@/lib/rules/eligibility';

export interface ThresholdFigure {
  annualGrossEur: number;
  legalBasis: string;
  meets: boolean | null;
}

export interface Figures {
  salaryOnFile: number | null;
  standard: ThresholdFigure;
  reduced: ThresholdFigure;
}

export function summarizeFigures(facts: CaseFacts, today: Date): Figures {
  const rules = getBlueCardRules();
  const threshold = activeThreshold(rules, today);
  const salary = facts.employment?.annualGrossSalaryEur?.value ?? null;

  const meets = (amount: number): boolean | null =>
    salary == null ? null : salary >= amount;

  return {
    salaryOnFile: salary,
    standard: {
      annualGrossEur: threshold.standard.annualGrossEur,
      legalBasis: threshold.standard.legalBasis,
      meets: meets(threshold.standard.annualGrossEur),
    },
    reduced: {
      annualGrossEur: threshold.reduced.annualGrossEur,
      legalBasis: threshold.reduced.legalBasis,
      meets: meets(threshold.reduced.annualGrossEur),
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/rules/eligibility-figures.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/rules/eligibility-figures.ts tests/rules/eligibility-figures.test.ts
git commit -m "feat: add summarizeFigures threshold-centric figures helper"
```

---

## Task 4: `check_eligibility` tool

**Files:**
- Create: `src/lib/ai/tools/check_eligibility.ts`
- Test: `tests/ai/check_eligibility.test.ts`

Reads facts + profile via `repo.loadCase`, runs the engine first (so out-of-scope wins over incomplete), then readiness, then assembles figures. Logs `case.eligibility.checked` on the `incomplete`/`assessed` paths only. `now` is injectable for test date-pinning. Note: this tool does NOT set `providerOptions` — the single cache breakpoint lives in `agent-turn.ts` (Task 6).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ai/check_eligibility.test.ts
import { describe, it, expect, vi } from 'vitest';
import { makeCheckEligibilityTool } from '@/lib/ai/tools/check_eligibility';
import type { CaseFacts } from '@/lib/case/schema';
import type { Profile } from '@/lib/profile/schema';

const CASE_ID = 'c0000000-0000-4000-8000-000000000000';
const USER_ID = 'u0000000-0000-4000-8000-000000000000';
const TODAY = new Date('2026-05-27T00:00:00.000Z');
const ISO = TODAY.toISOString();
const PROV = { source: 'user_stated' as const, sourceTurnId: null, confidence: 1, updatedAt: ISO };
const f = <T>(value: T) => ({ value, ...PROV });
const profile: Profile = { schemaVersion: 1 };

function makeRepo(caseFacts: CaseFacts) {
  return {
    loadCase: vi.fn().mockResolvedValue({ profile, caseFacts, threadId: 't', case: {} }),
    appendActivity: vi.fn().mockResolvedValue(undefined),
  };
}
const defaults = (repo: ReturnType<typeof makeRepo>) => ({
  defaultCaseId: CASE_ID,
  defaultUserId: USER_ID,
  now: () => TODAY,
});

describe('check_eligibility tool', () => {
  it('returns incomplete with missing paths and logs activity', async () => {
    const repo = makeRepo({ education: { anabinStatus: f('H+') } }); // no salary
    const tool = makeCheckEligibilityTool(repo, defaults(repo));
    const out = (await tool.execute!({}, {} as never)) as {
      type: string; data: { status: string; missing?: string[] };
    };
    expect(out.type).toBe('eligibility_result');
    expect(out.data.status).toBe('incomplete');
    expect(out.data.missing).toContain('employment.annualGrossSalaryEur');
    expect(repo.appendActivity).toHaveBeenCalledOnce();
    expect(repo.appendActivity.mock.calls[0]![0].kind).toBe('case.eligibility.checked');
  });

  it('returns assessed with figures and granted routes for a strong case', async () => {
    const repo = makeRepo({
      employment: { annualGrossSalaryEur: f(60000), iscoCode: f('2512') },
      education: { anabinStatus: f('H+'), highestDegree: f('master_eqf7') },
    });
    const tool = makeCheckEligibilityTool(repo, defaults(repo));
    const out = (await tool.execute!({}, {} as never)) as {
      data: { status: string; routes: string[]; figures: { standard: { meets: boolean } } };
    };
    expect(out.data.status).toBe('assessed');
    expect(out.data.routes).toContain('standard');
    expect(out.data.figures.standard.meets).toBe(true);
    expect(repo.appendActivity.mock.calls[0]![0].payload).not.toHaveProperty('salaryOnFile');
  });

  it('returns out_of_scope and does NOT log activity for non-blue-card visa', async () => {
    const repo = makeRepo({
      target: { intendedVisa: f('student' as 'blue_card') },
      employment: { annualGrossSalaryEur: f(60000) },
      education: { anabinStatus: f('H+') },
    });
    const tool = makeCheckEligibilityTool(repo, defaults(repo));
    const out = (await tool.execute!({}, {} as never)) as { data: { status: string } };
    expect(out.data.status).toBe('out_of_scope');
    expect(repo.appendActivity).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/ai/check_eligibility.test.ts`
Expected: FAIL — cannot find module `@/lib/ai/tools/check_eligibility`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/ai/tools/check_eligibility.ts
import { tool } from 'ai';
import { z } from 'zod';
import type { Repository } from '@/lib/case/repository';
import type { Profile } from '@/lib/profile/schema';
import { evaluateEligibility } from '@/lib/rules/eligibility';
import { assessReadiness } from '@/lib/rules/eligibility-readiness';
import { summarizeFigures } from '@/lib/rules/eligibility-figures';

const description = [
  'Run the deterministic Blue Card eligibility check against the current case facts.',
  'Call this once employment and education facts are plausibly on file; the tool reports',
  'exactly which facts are still missing if it cannot yet decide, so it is safe to call early.',
  'It reads the current case itself — you pass no arguments.',
  'Present the result by pointing the user at the rendered card; NEVER restate the euro figures',
  'in your prose. The card is the source of truth for numbers.',
].join(' ');

export const CheckEligibilityInputSchema = z.object({});
export type CheckEligibilityInput = z.infer<typeof CheckEligibilityInputSchema>;

export interface CheckEligibilityToolDefaults {
  defaultCaseId: string;
  defaultUserId: string;
  now?: () => Date;
}

export function makeCheckEligibilityTool(
  repo: Pick<Repository, 'loadCase' | 'appendActivity'>,
  defaults: CheckEligibilityToolDefaults,
) {
  const now = defaults.now ?? (() => new Date());
  return tool({
    description,
    inputSchema: CheckEligibilityInputSchema,
    async execute(_input: CheckEligibilityInput) {
      const loaded = await repo.loadCase(defaults.defaultCaseId);
      const facts = loaded.caseFacts;
      const profile: Profile = loaded.profile ?? { schemaVersion: 1 };
      const today = now();

      const verdict = evaluateEligibility(facts, profile, today);

      // Out-of-scope wins over incomplete: a non-Blue-Card visa is a scope refusal,
      // not an eligibility event — no activity row (mirrors the out_of_scope tool).
      if (verdict.outOfScope) {
        return {
          type: 'eligibility_result' as const,
          version: 1 as const,
          data: { status: 'out_of_scope' as const, reason: 'intended visa is not Blue Card' },
        };
      }

      const readiness = assessReadiness(facts);
      if (!readiness.ready) {
        await repo.appendActivity({
          caseId: defaults.defaultCaseId,
          userId: defaults.defaultUserId,
          kind: 'case.eligibility.checked',
          payload: { status: 'incomplete', missing: readiness.missing },
        });
        return {
          type: 'eligibility_result' as const,
          version: 1 as const,
          data: { status: 'incomplete' as const, missing: readiness.missing },
        };
      }

      const figures = summarizeFigures(facts, today);
      await repo.appendActivity({
        caseId: defaults.defaultCaseId,
        userId: defaults.defaultUserId,
        kind: 'case.eligibility.checked',
        // PII rule: codes/paths only — no salary figure in the log.
        payload: { status: 'assessed', routes: verdict.routes, blockers: verdict.blockers },
      });
      return {
        type: 'eligibility_result' as const,
        version: 1 as const,
        data: {
          status: 'assessed' as const,
          qualifies: verdict.qualifies,
          routes: verdict.routes,
          blockers: verdict.blockers,
          warnings: verdict.warnings,
          figures,
          computedAt: verdict.computedAt,
          rulesVersion: verdict.rulesVersion,
        },
      };
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/ai/check_eligibility.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/tools/check_eligibility.ts tests/ai/check_eligibility.test.ts
git commit -m "feat: add check_eligibility tool (ephemeral verdict + activity trail)"
```

---

## Task 5: `lookup_anabin` tool

**Files:**
- Create: `src/lib/ai/tools/lookup_anabin.ts`
- Test: `tests/ai/lookup_anabin.test.ts`

Wraps `getAnabinInstitutionByName`. Distinguishes not-seeded (`found:false`) from seeded-but-unrated (`found:true, status:'unknown'`). Read-only — no repo, no activity write. **`lookup_anabin` is the one tool that carries the single `cache_control` breakpoint** (it is registered last in `agent-turn.ts`, so a breakpoint here caches the whole static tool block). The other five tools carry none. This is the consolidation the cache-budget NOTE called for.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ai/lookup_anabin.test.ts
import { describe, it, expect } from 'vitest';
import { makeLookupAnabinTool } from '@/lib/ai/tools/lookup_anabin';

describe('lookup_anabin tool', () => {
  it('found:false for an institution not in the seed', async () => {
    const tool = makeLookupAnabinTool();
    const out = (await tool.execute!({ institution: 'XYZ Engineering College' }, {} as never)) as {
      type: string; data: { found: boolean; query?: string };
    };
    expect(out.type).toBe('anabin_result');
    expect(out.data.found).toBe(false);
    expect(out.data.query).toBe('XYZ Engineering College');
  });

  it('found:true status unknown for a seeded-but-unrated institution', async () => {
    const tool = makeLookupAnabinTool();
    const out = (await tool.execute!({ institution: 'Indian Institute of Technology Bombay' }, {} as never)) as {
      data: { found: boolean; status?: string; verifiedByUser?: boolean };
    };
    expect(out.data.found).toBe(true);
    expect(out.data.status).toBe('unknown');
    expect(out.data.verifiedByUser).toBe(false);
  });

  it('found:true with a rated status for a seeded H+ institution', async () => {
    const tool = makeLookupAnabinTool();
    const out = (await tool.execute!(
      { institution: 'Birla Institute of Technology and Science, Pilani' },
      {} as never,
    )) as { data: { found: boolean; status?: string } };
    expect(out.data.found).toBe(true);
    expect(out.data.status).toBe('H+');
  });

  it('carries the single ephemeral cache breakpoint (registered last in the tool set)', () => {
    const tool = makeLookupAnabinTool();
    expect(tool.providerOptions?.anthropic).toEqual({ cacheControl: { type: 'ephemeral' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/ai/lookup_anabin.test.ts`
Expected: FAIL — cannot find module `@/lib/ai/tools/lookup_anabin`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/ai/tools/lookup_anabin.ts
import { tool } from 'ai';
import { z } from 'zod';
import { getAnabinInstitutionByName } from '@/lib/rules/loader';

const description = [
  'Look up the German recognition status (Anabin) of a foreign higher-education institution.',
  'Call this when a degree\'s recognition is in question — before concluding anything about',
  'whether a qualification counts for the Blue Card.',
  'If the institution is not in our database (found:false) or is present but unrated',
  '(status:"unknown"), explain that a ZAB individual assessment / statement and consulate',
  'clarification are the path forward — do not guess a status.',
  'This is read-only; persist any conclusion separately with update_case.',
].join(' ');

export const LookupAnabinInputSchema = z.object({
  institution: z.string().min(1),
});
export type LookupAnabinInput = z.infer<typeof LookupAnabinInputSchema>;

export function makeLookupAnabinTool() {
  return tool({
    description,
    inputSchema: LookupAnabinInputSchema,
    // The SINGLE tool-block cache breakpoint lives here. lookup_anabin is registered
    // LAST in agent-turn.ts, so marking it caches the entire static tools prefix in one
    // breakpoint (Anthropic max is 4; the other five tools carry none). Keep it last.
    providerOptions: {
      anthropic: { cacheControl: { type: 'ephemeral' } },
    },
    async execute(input: LookupAnabinInput) {
      const inst = getAnabinInstitutionByName(input.institution);
      if (!inst) {
        return {
          type: 'anabin_result' as const,
          version: 1 as const,
          data: { found: false as const, query: input.institution },
        };
      }
      return {
        type: 'anabin_result' as const,
        version: 1 as const,
        data: {
          found: true as const,
          status: inst.institutionStatus,
          institution: inst.name,
          verifiedByUser: inst.verifiedByUser,
          anabinUrl: inst.anabinUrl ?? null,
          degrees: inst.degrees,
        },
      };
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/ai/lookup_anabin.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/tools/lookup_anabin.ts tests/ai/lookup_anabin.test.ts
git commit -m "feat: add lookup_anabin tool (distinguishes not-found from unknown)"
```

---

## Task 6: Consolidate cache breakpoints + register the two tools

**Files:**
- Modify: `src/lib/ai/tools/update_case.ts:30-33`, `read_case.ts:34-36`, `add_case_note.ts:30-32`, `out_of_scope.ts:32-34` — remove `providerOptions` block.
- Modify: `tests/ai/update_case.test.ts:66-69`, `read_case.test.ts:21-26`, `add_case_note.test.ts:10-16`, `out_of_scope.test.ts:10-15` — remove per-tool `providerOptions` assertions.
- Modify: `src/lib/ai/chat/agent-turn.ts:45-69`
- Test: `tests/ai/agent-turn.test.ts`

Anthropic allows max 4 `cache_control` breakpoints. Six tools each carrying one would 400. Remove the breakpoints from the four existing tools; the single breakpoint already lives in `lookup_anabin`'s factory (Task 5), which is registered last (a breakpoint on the final tool caches the whole static tools block, since Anthropic caches the `tools` prefix up to the marked block).

- [ ] **Step 1: Remove `providerOptions` from the four existing tools**

In each of `src/lib/ai/tools/update_case.ts`, `read_case.ts`, `add_case_note.ts`, `out_of_scope.ts`, delete this block from the `tool({ ... })` call:

```typescript
    providerOptions: {
      anthropic: { cacheControl: { type: 'ephemeral' } },
    },
```

- [ ] **Step 2: Remove the per-tool assertions from the four existing tool tests**

In `tests/ai/update_case.test.ts`, delete the test block at lines 66-69:

```typescript
  it('exposes anthropic ephemeral cacheControl on providerOptions', () => {
    const tool = makeUpdateCaseTool(repo, defaults);
    expect(tool.providerOptions?.anthropic).toEqual({ cacheControl: { type: 'ephemeral' } });
  });
```

In `tests/ai/read_case.test.ts` (lines 21-26), `tests/ai/add_case_note.test.ts` (lines 10-16), and `tests/ai/out_of_scope.test.ts` (lines 10-15), each has an `it('exposes a tool with description, zod input, and ephemeral cache', ...)` block. Remove ONLY the `providerOptions` assertion line from each (keep the description/inputSchema assertions); rename the test to `'exposes a tool with description and zod input'`. Example for `read_case.test.ts`:

```typescript
  it('exposes a tool with description and zod input', () => {
    const tool = makeReadCaseTool({ loadCase: vi.fn() } as never, { defaultCaseId: 'c' });
    expect((tool.description ?? '').length).toBeGreaterThan(40);
    expect(tool.inputSchema).toBeDefined();
  });
```

(Apply the analogous edit in `add_case_note.test.ts` and `out_of_scope.test.ts`, preserving each file's existing repo/defaults setup.)

- [ ] **Step 3: Update `agent-turn.ts` — register tools + single breakpoint**

Add the imports near the other tool imports (after line 8):

```typescript
import { makeCheckEligibilityTool } from '@/lib/ai/tools/check_eligibility';
import { makeLookupAnabinTool } from '@/lib/ai/tools/lookup_anabin';
```

Replace the `tools` object (lines 45-57) with:

```typescript
  const tools = {
    update_case: makeUpdateCaseTool(repo, {
      defaultCaseId: caseId,
      defaultSourceTurnId: userMessageId,
    }),
    read_case: makeReadCaseTool(repo, { defaultCaseId: caseId }),
    add_case_note: makeAddCaseNoteTool(repo, {
      defaultCaseId: caseId,
      defaultUserId: userId,
      defaultSourceTurnId: userMessageId,
    }),
    out_of_scope: makeOutOfScopeTool(repo, { defaultCaseId: caseId, defaultUserId: userId }),
    check_eligibility: makeCheckEligibilityTool(repo, {
      defaultCaseId: caseId,
      defaultUserId: userId,
    }),
    // lookup_anabin MUST stay last: it carries the single cache_control breakpoint
    // (in its factory), which caches the whole static tools block. See lookup_anabin.ts.
    lookup_anabin: makeLookupAnabinTool(),
  };
```

Then replace the old NOTE comment inside the `streamText` call (the `// Anthropic allows max 4 cache_control breakpoints; the 4 tools each carry one...` block, lines 65-69) with:

```typescript
    // Cache: the single tool-block cache_control breakpoint lives on lookup_anabin (the
    // last registered tool), caching the whole static tools prefix. Do NOT add a top-level
    // providerOptions.anthropic.cacheControl here, and do NOT re-add per-tool breakpoints —
    // Anthropic allows max 4, and the system string embeds per-turn case context (would miss).
```

- [ ] **Step 4: Update the `agent-turn` test — six tools + one breakpoint**

In `tests/ai/agent-turn.test.ts`, replace the `registers all four tools` test (lines 54-59) with:

```typescript
  it('registers all six tools', async () => {
    await buildAgentTurn(baseParams());
    expect(Object.keys(captured.tools ?? {}).sort()).toEqual(
      ['add_case_note', 'check_eligibility', 'lookup_anabin', 'out_of_scope', 'read_case', 'update_case'].sort(),
    );
  });

  it('attaches exactly one cache_control breakpoint across the tool set', async () => {
    await buildAgentTurn(baseParams());
    const tools = (captured.tools ?? {}) as Record<string, { providerOptions?: { anthropic?: { cacheControl?: unknown } } }>;
    const withBreakpoint = Object.values(tools).filter(
      (t) => t.providerOptions?.anthropic?.cacheControl !== undefined,
    );
    expect(withBreakpoint).toHaveLength(1);
  });
```

The existing `baseParams()` repo stub (`{ appendActivity, loadCase, applyUpdate }`) already satisfies the new tools' `Pick<Repository, ...>` needs. `lookup_anabin` needs no repo.

- [ ] **Step 5: Run the affected tests**

Run: `pnpm exec vitest run tests/ai/agent-turn.test.ts tests/ai/update_case.test.ts tests/ai/read_case.test.ts tests/ai/add_case_note.test.ts tests/ai/out_of_scope.test.ts`
Expected: PASS — six-tool registration, single breakpoint, and the four tool tests without `providerOptions` assertions.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/tools/update_case.ts src/lib/ai/tools/read_case.ts src/lib/ai/tools/add_case_note.ts src/lib/ai/tools/out_of_scope.ts src/lib/ai/chat/agent-turn.ts tests/ai/agent-turn.test.ts tests/ai/update_case.test.ts tests/ai/read_case.test.ts tests/ai/add_case_note.test.ts tests/ai/out_of_scope.test.ts
git commit -m "feat: register check_eligibility + lookup_anabin; consolidate to single tool cache breakpoint"
```

---

## Task 7: Renderer cards for the two new tool outputs

**Files:**
- Modify: `src/components/workspace/renderers/registry.tsx`
- Test: `tests/components/renderers.test.ts`

Add `eligibility_result` (transparency card: salary-vs-threshold lines + granted routes + blockers/warnings, branching on `status`) and `anabin_result` (institution + status, branching on `found`). Functional now; polish is 2B.

- [ ] **Step 1: Write the failing test**

The existing `tests/components/renderers.test.ts` is a `.ts` file (no JSX) and tests `resolveRenderer` mapping — it does NOT render React. Match that style: assert resolution to the new renderers, and add a lightweight call-smoke (renderers are plain functions returning a React element; calling them must not throw and the element must be non-null). Visual text content is verified in the live smoke (Task 10).

Edit the existing import block to add the two new renderers, and append the new tests:

```typescript
// update the import at the top of tests/components/renderers.test.ts:
import {
  resolveRenderer,
  UpdateCaseResult,
  ReadCaseResult,
  AddCaseNoteResult,
  OutOfScopeResult,
  EligibilityResult,
  AnabinResult,
  FallbackResult,
} from '@/components/workspace/renderers/registry';

// append these tests:
describe('eligibility_result + anabin_result renderers', () => {
  it('resolves the new result types', () => {
    expect(resolveRenderer('eligibility_result')).toBe(EligibilityResult);
    expect(resolveRenderer('anabin_result')).toBe(AnabinResult);
  });

  it('EligibilityResult returns an element for each status without throwing', () => {
    const assessed = EligibilityResult({ output: { type: 'eligibility_result', version: 1, data: {
      status: 'assessed', qualifies: true, routes: ['standard'], blockers: [], warnings: [],
      figures: {
        salaryOnFile: 60000,
        standard: { annualGrossEur: 50700, legalBasis: '§18g Abs. 1', meets: true },
        reduced: { annualGrossEur: 45934.2, legalBasis: '§18g Abs. 1 S. 2', meets: true },
      },
    } } });
    const incomplete = EligibilityResult({ output: { type: 'eligibility_result', version: 1, data: {
      status: 'incomplete', missing: ['employment.annualGrossSalaryEur'],
    } } });
    expect(assessed).toBeTruthy();
    expect(incomplete).toBeTruthy();
  });

  it('AnabinResult returns an element for found and not-found without throwing', () => {
    const notFound = AnabinResult({ output: { type: 'anabin_result', version: 1, data: {
      found: false, query: 'XYZ College',
    } } });
    const found = AnabinResult({ output: { type: 'anabin_result', version: 1, data: {
      found: true, status: 'unknown', institution: 'IIT Bombay', verifiedByUser: false,
      anabinUrl: null, degrees: [],
    } } });
    expect(notFound).toBeTruthy();
    expect(found).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/components/renderers.test.ts`
Expected: FAIL — `EligibilityResult` / `AnabinResult` are not exported from the registry yet (import error), and `resolveRenderer` returns `FallbackResult` for the new types.

- [ ] **Step 3: Implement the renderers**

Add to `src/components/workspace/renderers/registry.tsx`, before the `registry` const:

```typescript
const MISSING_LABELS: Record<string, string> = {
  'employment.annualGrossSalaryEur': 'expected annual gross salary',
  'education.anabinStatus': 'whether your degree is recognized (Anabin status)',
};

const eur = (n: number) => `€${n.toLocaleString('en-US')}`;

export const EligibilityResult: Renderer = ({ output }) => {
  const data = output.data as {
    status: 'assessed' | 'incomplete' | 'out_of_scope';
    reason?: string;
    missing?: string[];
    routes?: string[];
    blockers?: string[];
    warnings?: string[];
    figures?: {
      salaryOnFile: number | null;
      standard: { annualGrossEur: number; meets: boolean | null };
      reduced: { annualGrossEur: number; meets: boolean | null };
    };
  };

  if (data.status === 'out_of_scope') {
    return (
      <span className="block rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800">
        Eligibility check skipped: {data.reason ?? 'this request is outside the Blue Card scope.'}
      </span>
    );
  }

  if (data.status === 'incomplete') {
    const labels = (data.missing ?? []).map((p) => MISSING_LABELS[p] ?? p);
    return (
      <span className="block rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">
        Need a couple more details before I can check: {labels.join(', ')}.
      </span>
    );
  }

  const fig = data.figures!;
  const mark = (m: boolean | null) => (m === null ? '·' : m ? '✓' : '✗');
  return (
    <div className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-700">
      <div className="font-medium">Eligibility check</div>
      <div>
        Standard threshold {eur(fig.standard.annualGrossEur)} {mark(fig.standard.meets)}
        {fig.salaryOnFile != null ? ` — ${eur(fig.salaryOnFile)} on file` : ''}
      </div>
      <div>
        Reduced threshold {eur(fig.reduced.annualGrossEur)} {mark(fig.reduced.meets)}
      </div>
      <div className="mt-1">
        {data.routes && data.routes.length > 0
          ? `Qualifies via: ${data.routes.join(', ')}`
          : 'No route qualifies yet'}
      </div>
      {data.warnings && data.warnings.length > 0 ? (
        <div className="text-amber-700">Notes: {data.warnings.join(', ')}</div>
      ) : null}
    </div>
  );
};

export const AnabinResult: Renderer = ({ output }) => {
  const data = output.data as {
    found: boolean;
    query?: string;
    status?: string;
    institution?: string;
    verifiedByUser?: boolean;
  };
  if (!data.found) {
    return (
      <span className="block rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">
        {data.query} is not in our Anabin database — it needs a ZAB individual assessment.
      </span>
    );
  }
  const unrated = data.status === 'unknown';
  return (
    <span className="block rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">
      {data.institution}: {unrated ? 'found, recognition not yet rated' : `recognition status ${data.status}`}
      {data.verifiedByUser === false ? ' (unverified seed)' : ''}
    </span>
  );
};
```

Then add both to the `registry` map:

```typescript
const registry: Record<string, Renderer> = {
  update_case_result: UpdateCaseResult,
  read_case_result: ReadCaseResult,
  add_case_note_result: AddCaseNoteResult,
  out_of_scope_result: OutOfScopeResult,
  eligibility_result: EligibilityResult,
  anabin_result: AnabinResult,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/components/renderers.test.ts`
Expected: PASS (existing + 3 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/renderers/registry.tsx tests/components/renderers.test.ts
git commit -m "feat: add eligibility_result + anabin_result renderer cards"
```

---

## Task 8: Update `v0.md` prompt

**Files:**
- Modify: `prompts/agent/v0.md:33-39`
- Test: `tests/ai/system-prompt.test.ts`

Remove the "(Available from a later build step…)" caveats on `check_eligibility` and `lookup_anabin`; tighten the "when to call" guidance. `PROMPT_VERSION` stays `v0`.

- [ ] **Step 1: Add a guard test for the un-caveating**

In `tests/ai/system-prompt.test.ts`, add:

```typescript
  it('no longer caveats eligibility/anabin tools as future build steps', () => {
    expect(systemPrompt).not.toMatch(/later build step/i);
  });

  it('keeps PROMPT_VERSION at v0', () => {
    expect(PROMPT_VERSION).toBe('v0');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/ai/system-prompt.test.ts`
Expected: FAIL — `systemPrompt` still contains "later build step".

- [ ] **Step 3: Edit the prompt**

In `prompts/agent/v0.md`, replace the `check_eligibility` and `lookup_anabin` bullets (lines 33-38) with:

```markdown
- **check_eligibility** — run the deterministic eligibility check. Call it once
  employment and education facts are plausibly on file; it self-reports which
  facts are still missing if it cannot yet decide, so calling early is safe. When
  it returns, point the user at the result card — do **not** restate the euro
  figures in your prose.
- **lookup_anabin** — look up a foreign institution's German recognition status.
  Call it whenever a degree's recognition is in question. If the status is unknown
  or the institution is not found, explain the ZAB statement + consulate
  clarification path; never guess a status.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/ai/system-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prompts/agent/v0.md tests/ai/system-prompt.test.ts
git commit -m "docs: un-caveat check_eligibility + lookup_anabin in v0 prompt"
```

---

## Task 9: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `pnpm exec vitest run --no-file-parallelism`
Expected: ALL PASS. (`--no-file-parallelism` avoids the `EMAXPOOLSREACHED` pooler issue documented in CLAUDE.md; ~32s.)

- [ ] **Step 2: Type check**

Run: `pnpm exec tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: green.

- [ ] **Step 5: Commit any incidental fixes**

If steps 1-4 surfaced fixes, commit them:

```bash
git add -A
git commit -m "fix: resolve verification-gate findings for 2A.2"
```

---

## Task 10: Live smoke (manual, requires real provider + DB)

**Files:** none (manual verification). This is the gate item that caught the 2A.1 runtime bugs the mocked tests missed.

- [ ] **Step 1: Start the dev stack**

Run `pnpm dev` and `npx inngest-cli@latest dev` in separate terminals (see CLAUDE.md Inngest gotcha).

- [ ] **Step 2: Drive the agent and verify each path**

In a fresh case (optionally seed via `?persona=priya-strong`):
- Provide salary + recognized degree → agent calls `check_eligibility` → **assessed** card shows the standard/reduced thresholds vs. salary and the granted route(s). Confirm the agent's prose contains **no euro figures**.
- In a partial case (no salary) → **incomplete** card lists the missing salary.
- Ask about an unseeded institution (e.g. "XYZ Engineering College") → `lookup_anabin` **found:false** card.
- Ask about a seeded-but-unrated institution (e.g. "IIT Bombay") → **found:true, unknown** card.
- Confirm **no 400** error in the network tab (cache-breakpoint regression check).

- [ ] **Step 3: Confirm the activity trail**

Run the DB state inspector (CLAUDE.md): `node --env-file=.env.local --import tsx scripts/dev-only/db-state.ts` and confirm `case.eligibility.checked` rows exist with codes-only payloads (no salary).

- [ ] **Step 4: Update CLAUDE.md current-state**

Mark 2A.2 complete in the CLAUDE.md status table and the "Next" section (point to 2B journey-tracker), and add a memory pointer. Commit:

```bash
git add CLAUDE.md
git commit -m "docs: mark 2A.2 complete; next is 2B journey-tracker"
```

---

## Notes for the executor

- **TDD throughout:** every code task is test-first. Run the failing test before implementing.
- **The engine is frozen.** Task 2 only *exports* a helper. If any `tests/eligibility.test.ts` or `tests/personas/eligibility.test.ts` assertion changes, you've broken the contract — revert and reconsider.
- **No new dependencies.** Everything uses existing libraries (ai, zod, drizzle, js-yaml, React).
- **`require('@/...')` is forbidden** (returns `{}` at runtime) — always static `import`.
- **DB-touching full runs:** use `--no-file-parallelism`.
