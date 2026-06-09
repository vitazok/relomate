# Phase 2C Persona-Driven E2E (Layers 1+2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-persona deterministic E2E coverage at two depths that cost ~0 runtime tokens — (L1) the persisted case file resulting from a persona's facts via the real DB-backed `update_case` path, and (L2a) the agent turn's persistence + Inngest side-effects via `buildAgentTurn`'s `onFinish` with a synthesized event.

**Architecture:** A shared test harness (`tests/_personas/harness.ts`) becomes the single source of truth for the persona→`CaseFacts` mapping (currently duplicated across two test files), and adds two derivation functions: `deriveUpdateCalls(persona)` (→ `update_case` inputs) and `synthesizeTurnEvent(persona)` (→ an `onFinish` event). Two new test files consume them. No production code changes, no persona-schema changes, no GitHub Actions — npm scripts only. Layers 2b (real-stream replay) and 3 (live LLM) are deferred to a follow-up session.

**Tech Stack:** Vitest, TypeScript strict, Drizzle (test schemas via `tests/_db/setup.ts`), the dependency-free `vi.mock('ai')` seam (no `msw`/`MockLanguageModelV2`).

**Spec:** `docs/superpowers/specs/2026-06-01-phase-2c-persona-e2e-design.md`

**Key constraints (from CLAUDE.md + spec):**
- `applyUpdate` validates leaf values **eagerly, before the transaction, for every path in a call** (`repository.ts:121-125`) and **throws** on an invalid enum value — rejecting the *whole* call (all-or-nothing). So any known-invalid leaf (the `out-of-scope-asylum` persona's `target.visaType: "asylum"` → `intendedVisa`, whose enum is `['blue_card']`) MUST be isolated into its own single-path call.
- `applyUpdate` re-stamps its own `updatedAt` (`new Date()`) and uses the injected `sourceTurnId`. So L1 compares **leaf values**, not whole provenance wrappers.
- DB-touching suites run serially: `pnpm exec vitest run --no-file-parallelism` (avoids `EMAXPOOLSREACHED`). Per-file pure-logic runs are unaffected.
- The `vi.mock('@/lib/db/client', () => ({ get db() {...} }))` getter pattern is mandatory (hoisting); never include `schema` in that factory.
- Commands: `pnpm exec vitest run <file>` (single file), `pnpm exec tsc --noEmit` (typecheck), `pnpm lint`.

**Commit discipline:** The user commits on their own timing; the `git commit` steps are natural checkpoints. We are on branch `feat/persona-e2e` (already created; the spec commit lives there).

---

## File Structure

**New files:**
- `tests/_personas/harness.ts` — shared persona mapping (`loadPersona`, `loadAllPersonas`, `wrap`, `PERSONA_TODAY`, `PERSONA_ISO`, `DEGREE_MAP`, `toCaseFacts`, `toProfile`) + derivation helpers (`flattenLeafValues`, `isLeafValueValid`, `deriveUpdateCalls`, `synthesizeTurnEvent`).
- `tests/_personas/harness.test.ts` — unit tests for the derivation helpers.
- `tests/personas/case-file.test.ts` — Layer 1 (DB-backed end-state).
- `tests/personas/agent-turn-replay.test.ts` — Layer 2a (`onFinish` side-effects).

**Modified files:**
- `tests/personas/eligibility.test.ts` — import harness; delete local copies of the mapping.
- `tests/journey/compute-personas.test.ts` — import harness; delete local copies.
- `package.json` — add `test:personas` script.

**Deviation from spec:** the spec listed a possible `tests/_personas/repo-fake.ts`. The L2a test never executes tools (streamText is mocked) and `onFinish` calls `appendChatTurn`/`inngest` (both mocked), not `repo`. So the `Repository` value passed to `buildAgentTurn` only needs to satisfy the type — a minimal inline stub. No separate file. (A real in-memory repo is a 2b concern; YAGNI here.)

---

## SLICE 1 — Shared harness

### Task 1: Extract the persona mapping into a shared harness (with refactor safety net)

The mapping (`wrap`, `DEGREE_MAP`, `toCaseFacts`, `toProfile`) is copy-pasted in `tests/personas/eligibility.test.ts` and `tests/journey/compute-personas.test.ts`. The journey copy is a strict superset (it also maps `family.spousePresent`/`childrenCount`/`maritalStatus`). We adopt the superset; the eligibility engine does not gate on family, so the eligibility verdicts are unchanged — verified by re-running both suites.

**Files:**
- Create: `tests/_personas/harness.ts`
- Modify: `tests/personas/eligibility.test.ts`
- Modify: `tests/journey/compute-personas.test.ts`

- [ ] **Step 1: Capture the current green baseline**

Run: `pnpm exec vitest run tests/personas/eligibility.test.ts tests/journey/compute-personas.test.ts`
Expected: PASS. Note the exact test counts (this is the safety-net baseline — the same tests must pass identically after extraction).

- [ ] **Step 2: Create the harness with the moved helpers**

Create `tests/_personas/harness.ts`:

```typescript
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PersonaSchema, type Persona } from '../../data/personas/schema';
import type { CaseFacts } from '@/lib/case/schema';
import type { Profile } from '@/lib/profile/schema';

export const PERSONAS_DIR = join(process.cwd(), 'data', 'personas');

/** Fixed clock for all persona tests so provenance/eligibility dates are deterministic. */
export const PERSONA_TODAY = new Date('2026-05-27T00:00:00.000Z');
export const PERSONA_ISO = PERSONA_TODAY.toISOString();

const PROV = { source: 'user_stated' as const, sourceTurnId: null, confidence: 1, updatedAt: PERSONA_ISO };

/** Wrap a raw value in the rule-9 provenance shape used across the case tree. */
export const wrap = <T>(value: T) => ({ value, ...PROV });

export const EMPTY_PROFILE: Profile = { schemaVersion: 1 };

export const DEGREE_MAP: Record<string, 'master_eqf7' | 'bachelor_eqf6' | 'phd_eqf8' | 'other'> = {
  'M.Tech': 'master_eqf7',
  'M.Sc': 'master_eqf7',
  'B.Tech': 'bachelor_eqf6',
  'B.Sc': 'bachelor_eqf6',
  PhD: 'phd_eqf8',
};

export function loadPersona(id: string): Persona {
  return PersonaSchema.parse(JSON.parse(readFileSync(join(PERSONAS_DIR, `${id}.json`), 'utf8')));
}

export function loadAllPersonas(): Persona[] {
  return readdirSync(PERSONAS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => PersonaSchema.parse(JSON.parse(readFileSync(join(PERSONAS_DIR, f), 'utf8'))));
}

export function toProfile(p: Persona): Profile {
  const addr = p.profile.currentAddress;
  return {
    schemaVersion: 1,
    fullName: wrap(p.profile.fullName),
    dateOfBirth: wrap(p.profile.dateOfBirth),
    placeOfBirth: wrap(addr?.city ?? 'unknown'),
    gender: wrap('male' as const),
    nationality: wrap(p.profile.nationality),
    passportNumber: wrap(p.profile.passportNumber),
    passportExpiry: wrap(p.profile.passportExpiry),
    currentAddress: wrap({
      line1: addr?.line1 ?? null,
      city: addr?.city ?? null,
      stateOrProvince: addr?.state ?? null,
      country: addr?.country ?? null,
      postalCode: addr?.postalCode ?? null,
    }),
  };
}

export function toCaseFacts(p: Persona): CaseFacts {
  const cf: CaseFacts = {};

  const edu = p.caseFacts.education;
  if (edu) {
    const educationOut: NonNullable<CaseFacts['education']> = {};
    if (edu.highestDegree) {
      educationOut.highestDegree = wrap(DEGREE_MAP[edu.highestDegree] ?? 'other');
    }
    if (edu.fieldOfStudy) educationOut.fieldOfStudy = wrap(edu.fieldOfStudy);
    if (edu.institution) educationOut.institution = wrap(edu.institution);
    if (edu.completionYear != null) educationOut.completionYear = wrap(edu.completionYear);
    if (edu.anabinStatus) educationOut.anabinStatus = wrap(edu.anabinStatus);
    if (edu.modeOfStudy) {
      const mode = edu.modeOfStudy === 'full_time' ? 'regular' : edu.modeOfStudy;
      educationOut.modeOfStudy = wrap(mode);
    }
    if (Object.keys(educationOut).length > 0) cf.education = educationOut;
  }

  const emp = p.caseFacts.employment;
  if (emp) {
    const empOut: NonNullable<CaseFacts['employment']> = {};
    if (emp.employerName) empOut.employerName = wrap(emp.employerName);
    if (emp.employerCity) empOut.employerCity = wrap(emp.employerCity);
    if (emp.jobTitle) empOut.jobTitle = wrap(emp.jobTitle);
    if (emp.iscoCode) empOut.iscoCode = wrap(emp.iscoCode);
    if (emp.annualGrossSalaryEur) empOut.annualGrossSalaryEur = wrap(emp.annualGrossSalaryEur);
    if (emp.contractType) empOut.contractType = wrap(emp.contractType);
    if (emp.contractStartDate && emp.contractStartDate !== '1970-01-01') {
      empOut.contractStartDate = wrap(emp.contractStartDate);
    }
    if (emp.priorExperienceYears != null) empOut.priorExperienceYears = wrap(emp.priorExperienceYears);
    if (Object.keys(empOut).length > 0) cf.employment = empOut;
  }

  const fam = p.caseFacts.family;
  if (fam) {
    const famOut: NonNullable<CaseFacts['family']> = {};
    // reason: persona maritalStatus is a free string; CaseFacts expects an enum. Engine + journey
    // compute read only spousePresent/childrenCount, never maritalStatus, so the cast is safe.
    if (typeof fam.maritalStatus === 'string') {
      famOut.maritalStatus = wrap(fam.maritalStatus as 'married');
    }
    famOut.spousePresent = wrap(fam.spouse != null);
    famOut.childrenCount = wrap(Array.isArray(fam.children) ? fam.children.length : 0);
    cf.family = famOut;
  }

  const target = p.caseFacts.target;
  if (target) {
    const targetOut: NonNullable<CaseFacts['target']> = {};
    // reason: persona visaType is a free string; out-of-scope personas carry non-blue_card values.
    // The cast keeps toCaseFacts total; L1 derives the RAW value and lets applyUpdate reject it.
    if (target.visaType) targetOut.intendedVisa = wrap(target.visaType as 'blue_card');
    if (target.consulate) targetOut.targetConsulate = wrap(target.consulate as 'bengaluru');
    if (target.moveDate) targetOut.targetMoveDate = wrap(target.moveDate);
    if (Object.keys(targetOut).length > 0) cf.target = targetOut;
  }

  return cf;
}
```

- [ ] **Step 3: Refactor `eligibility.test.ts` to import the harness**

Replace the top of `tests/personas/eligibility.test.ts` (lines 1-103, everything before `const personas = loadPersonas();`) with:

```typescript
import { describe, it, expect } from 'vitest';
import { evaluateEligibility } from '@/lib/rules/eligibility';
import { loadAllPersonas, toCaseFacts, toProfile, PERSONA_TODAY } from '../_personas/harness';

const TODAY = PERSONA_TODAY;
const personas = loadAllPersonas();
```

Then update the `describe.each` body to use the imported names (the rest of the file from line 105 stays, but rename the local `loadPersonas()` call): change `const personas = loadPersonas();` (now removed) — the `describe.each(personas...)` line already references `personas`. Verify the body still calls `evaluateEligibility(toCaseFacts(persona), toProfile(persona), TODAY)` — it does; no other change needed.

- [ ] **Step 4: Refactor `compute-personas.test.ts` to import the harness**

Replace the top of `tests/journey/compute-personas.test.ts` (lines 1-94, everything before `function progressFor`) with:

```typescript
import { describe, it, expect } from 'vitest';
import { computeJourneyProgress } from '@/lib/journey/compute';
import { getDocumentRules } from '@/lib/rules/loader';
import { evaluateEligibility } from '@/lib/rules/eligibility';
import { loadPersona, toCaseFacts, EMPTY_PROFILE, PERSONA_TODAY } from '../_personas/harness';

const TODAY = PERSONA_TODAY;
const load = loadPersona;
```

Keep `progressFor` and the `describe` block (lines 96-136) unchanged — they reference `toCaseFacts`, `EMPTY_PROFILE`, `TODAY`, `load`, all now imported/aliased. (The local `type { Persona }` import is no longer needed — `progressFor`'s parameter can stay `(p: Persona)` only if `Persona` is imported; since the body doesn't annotate with `Persona` after this change, drop any now-unused `Persona` import to keep lint clean. If `progressFor(p: Persona)` still annotates, add `import type { Persona } from '../../data/personas/schema';`.)

- [ ] **Step 5: Run the safety-net suites — results must match the baseline**

Run: `pnpm exec vitest run tests/personas/eligibility.test.ts tests/journey/compute-personas.test.ts`
Expected: PASS with the SAME test counts as Step 1. If any eligibility verdict changed, the family superset altered engine behavior — STOP and investigate (it should not; engine ignores family).

- [ ] **Step 6: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/_personas/harness.ts tests/personas/eligibility.test.ts tests/journey/compute-personas.test.ts
git commit -m "refactor: extract shared persona harness (dedupe toCaseFacts mapping)"
```

---

### Task 2: Add the derivation helpers (`flattenLeafValues`, `isLeafValueValid`, `deriveUpdateCalls`)

These turn a persona's wrapped `CaseFacts` into `update_case` inputs, isolating any leaf whose raw value is invalid for its schema (so one rejecting call cannot sink the valid ones).

**Files:**
- Modify: `tests/_personas/harness.ts`
- Create: `tests/_personas/harness.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/_personas/harness.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  loadPersona,
  toCaseFacts,
  flattenLeafValues,
  isLeafValueValid,
  deriveUpdateCalls,
} from './harness';

describe('flattenLeafValues', () => {
  it('flattens wrapped leaves to {path, value} dropping provenance', () => {
    const flat = flattenLeafValues(toCaseFacts(loadPersona('priya-strong')));
    const map = Object.fromEntries(flat.map((l) => [l.path, l.value]));
    expect(map['employment.annualGrossSalaryEur']).toBe(48500);
    expect(map['education.anabinStatus']).toBe('H+');
    expect(map['target.targetConsulate']).toBe('bengaluru');
  });
});

describe('isLeafValueValid', () => {
  it('accepts a valid enum value and rejects an invalid one', () => {
    expect(isLeafValueValid('target.intendedVisa', 'blue_card')).toBe(true);
    expect(isLeafValueValid('target.intendedVisa', 'asylum')).toBe(false);
    expect(isLeafValueValid('employment.annualGrossSalaryEur', 48500)).toBe(true);
  });
});

describe('deriveUpdateCalls', () => {
  it('bundles all valid leaves into a single call for an in-scope persona', () => {
    const calls = deriveUpdateCalls(loadPersona('priya-strong'));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.source).toBe('user_stated');
    expect(calls[0]!.confidence).toBe(1);
    expect(calls[0]!.updates['employment.annualGrossSalaryEur']).toBe(48500);
    expect(calls[0]!.updates['target.intendedVisa']).toBe('blue_card');
  });

  it('isolates an invalid-enum leaf into its own single-path call (out-of-scope persona)', () => {
    const calls = deriveUpdateCalls(loadPersona('out-of-scope-asylum'));
    // First call = the valid bundle; subsequent calls = one isolated invalid leaf each.
    const isolated = calls.slice(1);
    expect(isolated.length).toBeGreaterThanOrEqual(1);
    const asylumCall = isolated.find((c) => 'target.intendedVisa' in c.updates);
    expect(asylumCall).toBeDefined();
    expect(Object.keys(asylumCall!.updates)).toEqual(['target.intendedVisa']);
    expect(asylumCall!.updates['target.intendedVisa']).toBe('asylum');
    // the valid bundle must NOT contain the invalid leaf
    expect('target.intendedVisa' in calls[0]!.updates).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/_personas/harness.test.ts`
Expected: FAIL — `flattenLeafValues` / `isLeafValueValid` / `deriveUpdateCalls` are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `tests/_personas/harness.ts`:

```typescript
import { validateLeafPath, validateLeafValue } from '@/lib/case/paths';
import type { UpdateCaseInputForLLM } from '@/lib/case/types';

/** Walk a wrapped case-tree object, returning each leaf's dotted path + raw value (drops provenance). */
export function flattenLeafValues(
  obj: Record<string, unknown>,
  prefix = '',
): Array<{ path: string; value: unknown }> {
  const out: Array<{ path: string; value: unknown }> = [];
  for (const [key, node] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (node && typeof node === 'object' && 'value' in (node as object)) {
      out.push({ path, value: (node as { value: unknown }).value });
    } else if (node && typeof node === 'object') {
      out.push(...flattenLeafValues(node as Record<string, unknown>, path));
    }
  }
  return out;
}

/** True iff `value` is a legal value for the leaf at `path` (mirrors applyUpdate's eager check). */
export function isLeafValueValid(path: string, value: unknown): boolean {
  try {
    const resolved = validateLeafPath(path);
    validateLeafValue(resolved.inner, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Derive the update_case calls that reproduce a persona's facts. Valid leaves are bundled into
 * one call (index 0). Each leaf whose raw value is invalid for its schema is isolated into its
 * own single-path call (appended after the bundle) — because applyUpdate validates eagerly and
 * rejects the WHOLE call on one bad value, so bundling an invalid leaf would sink the valid ones.
 */
export function deriveUpdateCalls(persona: Persona): UpdateCaseInputForLLM[] {
  const leaves = flattenLeafValues(toCaseFacts(persona));
  const valid: Record<string, unknown> = {};
  const isolated: UpdateCaseInputForLLM[] = [];
  for (const { path, value } of leaves) {
    if (isLeafValueValid(path, value)) {
      valid[path] = value;
    } else {
      isolated.push({ source: 'user_stated', confidence: 1, updates: { [path]: value } });
    }
  }
  const calls: UpdateCaseInputForLLM[] = [];
  if (Object.keys(valid).length > 0) {
    calls.push({ source: 'user_stated', confidence: 1, updates: valid });
  }
  calls.push(...isolated);
  return calls;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/_personas/harness.test.ts`
Expected: PASS — all of `flattenLeafValues`, `isLeafValueValid`, `deriveUpdateCalls`.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/_personas/harness.ts tests/_personas/harness.test.ts
git commit -m "feat: derive update_case calls from persona facts (isolate invalid enum leaves)"
```

---

### Task 3: Add `synthesizeTurnEvent`

Builds a well-formed `onFinish` event (the structurally-typed object `tests/api/chat.test.ts` already hand-constructs) carrying the persona's derived `update_case` call — or, for an out-of-scope persona, an `out_of_scope` call and NO `update_case` (so L2a can prove the Inngest emit does not fire).

**Files:**
- Modify: `tests/_personas/harness.ts`
- Modify: `tests/_personas/harness.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/_personas/harness.test.ts`:

```typescript
import { synthesizeTurnEvent } from './harness';

describe('synthesizeTurnEvent', () => {
  it('emits an update_case tool call + result for an in-scope persona', () => {
    const ev = synthesizeTurnEvent(loadPersona('priya-strong'));
    expect(ev.toolCalls).toHaveLength(1);
    expect(ev.toolCalls[0]!.toolName).toBe('update_case');
    expect(ev.toolResults[0]!.toolName).toBe('update_case');
    const out = ev.toolResults[0]!.output as { data: { updatedPaths: string[] } };
    expect(out.data.updatedPaths).toContain('employment.annualGrossSalaryEur');
    expect(typeof ev.text).toBe('string');
  });

  it('emits an out_of_scope call and NO update_case for an out-of-scope persona', () => {
    const ev = synthesizeTurnEvent(loadPersona('out-of-scope-asylum'));
    expect(ev.toolCalls.some((c) => c.toolName === 'update_case')).toBe(false);
    expect(ev.toolCalls.some((c) => c.toolName === 'out_of_scope')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/_personas/harness.test.ts`
Expected: FAIL — `synthesizeTurnEvent` is not exported.

- [ ] **Step 3: Implement**

Append to `tests/_personas/harness.ts`:

```typescript
export interface SynthToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}
export interface SynthToolResult {
  toolCallId: string;
  toolName: string;
  output: unknown;
}
export interface SynthTurnEvent {
  text: string;
  content: Array<{ type: 'text'; text: string }>;
  toolCalls: SynthToolCall[];
  toolResults: SynthToolResult[];
  steps: never[];
}

/**
 * Build a well-formed onFinish event for a persona. In-scope personas emit the derived
 * update_case bundle (call index 0); out-of-scope personas emit an out_of_scope call instead,
 * so the Inngest `case.facts.updated` emit (which fires only for update_case) does not fire.
 */
export function synthesizeTurnEvent(persona: Persona): SynthTurnEvent {
  if (persona.expected.outOfScope) {
    const text = 'That request is outside what I can help with here.';
    return {
      text,
      content: [{ type: 'text', text }],
      toolCalls: [
        {
          toolCallId: 'call-oos',
          toolName: 'out_of_scope',
          input: { reason: persona.expected.reason ?? 'out of scope' },
        },
      ],
      toolResults: [
        {
          toolCallId: 'call-oos',
          toolName: 'out_of_scope',
          output: { type: 'out_of_scope_result', version: 1, data: {} },
        },
      ],
      steps: [],
    };
  }

  const bundle = deriveUpdateCalls(persona)[0]!; // in-scope personas have only the valid bundle
  const updatedPaths = Object.keys(bundle.updates);
  const text = 'Recorded.';
  return {
    text,
    content: [{ type: 'text', text }],
    toolCalls: [{ toolCallId: 'call-1', toolName: 'update_case', input: bundle }],
    toolResults: [
      {
        toolCallId: 'call-1',
        toolName: 'update_case',
        output: {
          type: 'update_case_result',
          version: 1,
          data: { caseId: 'case-synthetic', updatedPaths, contradictions: [] },
        },
      },
    ],
    steps: [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/_personas/harness.test.ts`
Expected: PASS — all harness unit tests.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/_personas/harness.ts tests/_personas/harness.test.ts
git commit -m "feat: synthesize onFinish turn events from personas (update_case vs out_of_scope)"
```

---

## SLICE 2 — Layer 1 (DB-backed end-state)

### Task 4: Persona case-file test through the real `update_case` path

Per persona: create a case, apply the derived `update_case` calls through the real DB-backed repository, reload, and assert the persisted leaf VALUES equal the persona's valid leaves. The out-of-scope persona additionally proves the write path rejects its invalid enum leaf.

**Files:**
- Create: `tests/personas/case-file.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/personas/case-file.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedOrgAndUser, type SeededIds } from '../_db/seed';
import { makeRepository } from '@/lib/case/repository';
import {
  loadAllPersonas,
  toCaseFacts,
  flattenLeafValues,
  isLeafValueValid,
  deriveUpdateCalls,
} from '../_personas/harness';

const TURN_ID = '00000000-0000-4000-8000-0000000000aa';

const toValueMap = (flat: Array<{ path: string; value: unknown }>) =>
  Object.fromEntries(flat.map((l) => [l.path, l.value]));

describe('persona case-file end-state (DB-backed)', () => {
  let handle: TestDbHandle;
  let seeded: SeededIds;

  beforeAll(async () => {
    handle = await createTestSchema();
    seeded = await seedOrgAndUser(handle);
  }, 30_000);

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  for (const persona of loadAllPersonas()) {
    it(`${persona.id}: derived update_case calls persist the expected case file`, async () => {
      const repo = makeRepository(handle.db, handle.schemaName);
      const { caseId } = await repo.createCase({
        userId: seeded.userId,
        visaType: 'blue_card',
        targetCountry: 'DE',
        targetConsulate: 'bengaluru',
      });

      const calls = deriveUpdateCalls(persona);
      let rejected = 0;
      for (const call of calls) {
        try {
          const result = await repo.applyUpdate({ ...call, caseId, sourceTurnId: TURN_ID });
          // A single bundled/isolated call writes each path once → no self-contradiction.
          expect(result.contradictions).toEqual([]);
        } catch {
          rejected++;
        }
      }

      const loaded = await repo.loadCase(caseId);
      const expected = flattenLeafValues(toCaseFacts(persona)).filter((l) =>
        isLeafValueValid(l.path, l.value),
      );
      expect(toValueMap(flattenLeafValues(loaded.caseFacts))).toEqual(toValueMap(expected));

      if (persona.expected.outOfScope) {
        // out-of-scope persona carries an invalid enum leaf (e.g. intendedVisa='asylum')
        // which applyUpdate must reject, leaving it absent from the persisted file.
        expect(rejected).toBeGreaterThan(0);
        expect(flattenLeafValues(loaded.caseFacts).some((l) => l.path === 'target.intendedVisa')).toBe(
          false,
        );
      } else {
        expect(rejected).toBe(0);
      }
    });
  }
});
```

- [ ] **Step 2: Run the test (DB-backed → single file is fine)**

Run: `pnpm exec vitest run tests/personas/case-file.test.ts`
Expected: PASS — one passing test per persona (4). If it fails with `EMAXPOOLSREACHED`, re-run once (single-file should not hit it; the limit is a full-suite-parallelism issue).

Debugging notes if a persona fails the deep-equal:
- A value-type mismatch (e.g. number stored as string) → check the leaf in `data/personas/<id>.json` and the `CaseFacts` schema type for that path.
- `applyUpdate` threw for an in-scope persona → an unexpected invalid leaf; log `deriveUpdateCalls(persona)` and check which path `isLeafValueValid` rejects.

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/personas/case-file.test.ts
git commit -m "test: persona case-file end-state through real update_case path"
```

---

## SLICE 3 — Layer 2a (agent-turn onFinish replay)

### Task 5: Persona agent-turn replay test

Drive `buildAgentTurn`'s `onFinish` with the synthesized event (no model, no DB). Assert `appendChatTurn` is called and the Inngest `case.facts.updated` emit fires for update_case-bearing personas and not for the out-of-scope persona. Uses the dependency-free `vi.mock('ai')` seam from `tests/api/chat.test.ts`; additionally mocks `@/lib/ai/chat/persistence` and `@/lib/inngest/client` so no DB is touched.

**Files:**
- Create: `tests/personas/agent-turn-replay.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/personas/agent-turn-replay.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type * as AiModule from 'ai';
import type { Repository } from '@/lib/case/repository';
import { loadAllPersonas, toCaseFacts, synthesizeTurnEvent } from '../_personas/harness';

// --- Mocks (hoisted) ---
const appendChatTurnSpy = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/ai/chat/persistence', () => ({
  appendChatTurn: appendChatTurnSpy,
}));

const inngestSendSpy = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: inngestSendSpy },
}));

// Capture the onFinish callback streamText receives; return a no-op stream response.
let capturedOnFinish: ((event: unknown) => Promise<void>) | undefined;
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof AiModule>('ai');
  return {
    ...actual,
    streamText: vi.fn((opts: { onFinish?: (e: unknown) => Promise<void> }) => {
      capturedOnFinish = opts.onFinish;
      return { toUIMessageStreamResponse: () => new Response(null, { status: 200 }) };
    }),
  };
});

// Minimal Repository stub — tools never execute (streamText is mocked) and onFinish calls
// appendChatTurn/inngest (both mocked), not repo. It only needs to satisfy the type.
function stubRepo(): Repository {
  const notCalled = () => {
    throw new Error('repo method should not be called in the replay test');
  };
  return {
    createCase: notCalled,
    loadCase: notCalled,
    applyUpdate: notCalled,
    appendActivity: notCalled,
  } as unknown as Repository;
}

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const THREAD_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const TURN_ID = '44444444-4444-4444-8444-444444444444';

describe('persona agent-turn onFinish replay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnFinish = undefined;
  });

  for (const persona of loadAllPersonas()) {
    it(`${persona.id}: onFinish persists the turn and emits inngest iff update_case fired`, async () => {
      const { buildAgentTurn } = await import('@/lib/ai/chat/agent-turn');

      await buildAgentTurn({
        model: { dummy: true } as never,
        repo: stubRepo(),
        caseId: CASE_ID,
        threadId: THREAD_ID,
        userId: USER_ID,
        userMessageId: TURN_ID,
        caseFacts: toCaseFacts(persona),
        modelMessages: [{ role: 'user', content: 'here is my situation' }] as never,
      });

      if (!capturedOnFinish) throw new Error('streamText onFinish was not captured');
      await capturedOnFinish(synthesizeTurnEvent(persona));

      expect(appendChatTurnSpy).toHaveBeenCalledOnce();

      if (persona.expected.outOfScope) {
        expect(inngestSendSpy).not.toHaveBeenCalled();
      } else {
        expect(inngestSendSpy).toHaveBeenCalledOnce();
        const sent = inngestSendSpy.mock.calls[0]![0] as {
          name: string;
          data: { caseId: string; paths: string[]; sourceTurnId: string };
        };
        expect(sent.name).toBe('case.facts.updated');
        expect(sent.data.caseId).toBe(CASE_ID);
        expect(sent.data.sourceTurnId).toBe(TURN_ID);
        expect(sent.data.paths).toContain('employment.annualGrossSalaryEur');
      }
    });
  }
});
```

Note on the `paths` assertion: `priya-strong`, `arjun-it-no-degree`, and `vikram-edge-anabin` all carry `employment.annualGrossSalaryEur`. If a future in-scope persona omits salary, weaken the final assertion to `expect(sent.data.paths.length).toBeGreaterThan(0)`. The 4 current personas all satisfy the stronger form (out-of-scope is handled by the other branch).

- [ ] **Step 2: Run the test**

Run: `pnpm exec vitest run tests/personas/agent-turn-replay.test.ts`
Expected: PASS — one passing test per persona (4). `appendChatTurn` + `inngest` are mocked, so no DB/network.

Debugging notes:
- `capturedOnFinish` undefined → the `vi.mock('ai')` factory didn't replace `streamText`; confirm `buildAgentTurn` is imported AFTER the mock (it is — dynamic `await import` inside the test).
- A repo method throwing → a tool executed unexpectedly; confirm `streamText` is mocked (tools must not run).

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/personas/agent-turn-replay.test.ts
git commit -m "test: persona agent-turn onFinish replay (persist + inngest side-effects)"
```

---

## SLICE 4 — Wiring + verification gate

### Task 6: Add the `test:personas` script and run the full gate

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the script**

In `package.json`, add to the `scripts` block (after the existing `"test:watch"` line):

```json
    "test:personas": "vitest run --no-file-parallelism tests/personas tests/journey/compute-personas.test.ts tests/_personas",
```

(Serial because `tests/personas/case-file.test.ts` is DB-backed. The directory args run every persona suite plus the harness unit tests as the "deterministic core" grouping.)

- [ ] **Step 2: Run the persona grouping**

Run: `pnpm test:personas`
Expected: PASS — `harness.test.ts`, `eligibility.test.ts`, `compute-personas.test.ts`, `case-file.test.ts`, `agent-turn-replay.test.ts`.

- [ ] **Step 3: Run the FULL suite serially (regression gate)**

Run: `pnpm exec vitest run --no-file-parallelism`
Expected: PASS — all prior 194 tests plus the new persona suites. Confirm the count increased by the new tests (harness unit tests + 4 case-file + 4 replay) and that NO previously-passing test now fails (the harness refactor must be behavior-preserving).

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS, no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore: add test:personas script grouping the deterministic persona core"
```

---

## Self-Review notes (completed during plan authoring)

- **Spec coverage:** Component A shared harness (Task 1) + `deriveUpdateCalls`/`flattenLeafValues`/`isLeafValueValid` (Task 2) + `synthesizeTurnEvent` (Task 3). Component B Layer 1 DB-backed end-state (Task 4) — including the explicit invalid-enum rejection branch for the out-of-scope persona per spec "Known edge". Component C Layer 2a onFinish replay with appendChatTurn + Inngest assertions (Task 5). `test:personas` script (Task 6). Refactor safety net (Task 1 Steps 1+5). Scope boundaries honored: no real `streamText` execution, no live model, no GitHub Actions, no persona-schema change. ✅
- **Deviation from spec (documented):** no `tests/_personas/repo-fake.ts` — the L2a repo is a minimal inline stub because tools never execute and onFinish never calls repo. Recorded in File Structure. ✅
- **Type consistency:** `deriveUpdateCalls(persona): UpdateCaseInputForLLM[]` used identically in Tasks 2/3/4. `flattenLeafValues(obj): Array<{path,value}>` in Tasks 2/4. `isLeafValueValid(path,value): boolean` in Tasks 2/4. `synthesizeTurnEvent(persona): SynthTurnEvent` in Tasks 3/5. `wrap`/`toCaseFacts`/`toProfile`/`loadAllPersonas`/`loadPersona`/`PERSONA_TODAY`/`EMPTY_PROFILE` exported in Task 1, consumed everywhere. `BuildAgentTurnParams` field names (`model`, `repo`, `caseId`, `threadId`, `userId`, `userMessageId`, `caseFacts`, `modelMessages`) match `agent-turn.ts:23-32`. ✅
- **Grounded against real code:** `applyUpdate` eager-validate-then-throw (`repository.ts:121-125`, `paths.ts:132-140`); `onFinish` reads `result.output.data.updatedPaths` + emits `{caseId, paths, sourceTurnId}` (`agent-turn.ts:85-126`); `seedOrgAndUser` returns `{organizationId, userId}` (`tests/_db/seed.ts`); `createTestSchema` handle shape (`tests/_db/setup.ts`); `UpdateCaseInputForLLM` omits `caseId`+`sourceTurnId` (`types.ts:14-18`); `vi.mock('ai')` capture pattern (`tests/api/chat.test.ts:35-46`). ✅
- **Known follow-up for executor:** Task 1 Steps 3-4 are text-surgery on two existing files — re-read each file first; the import-block replacements assume the current line ranges. The `paths` assertion in Task 5 Step 1 has a documented weakening if a future persona omits salary.
```
