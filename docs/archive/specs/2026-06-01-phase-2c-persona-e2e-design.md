# Phase 2C — Persona-Driven E2E Testing (slice: Layers 1 + 2a)

> Design doc. Brainstormed with the user 2026-06-01. Scope deliberately cut to two of the
> three strategy layers; the remaining two are deferred to a named follow-up session.

## Context

CLAUDE.md pins persona testing as a **layered strategy** ("strategy A"):

> Deterministic core (pure `evaluateEligibility` + tool-unit + scripted-sequence→end-state)
> runs every PR at ~0 tokens. The LLM-driven loop is recorded once and replayed in CI
> (0 tokens/PR). Live LLM run is deliberate nightly/on-demand. This is why 2A.1 builds the
> injectable-model seam.

CLAUDE.md also calls the persona suite "the strongest E2E signal we have." Phase 2B
(journey-tracker) is merged (PR #3), which unblocked the per-persona
`computeJourneyProgress` assertions — those already shipped in 2B
(`tests/journey/compute-personas.test.ts`). 2C builds the remaining persona coverage.

The three strategy layers, by cost and difficulty:

| Layer | What it is | Build cost | Runtime tokens |
|---|---|---|---|
| **1 — deterministic core** | pure assertions + scripted-sequence→end-state through the real `update_case` path | low | ~0 |
| **2a — `onFinish` replay** | drive `buildAgentTurn`'s `onFinish` with a synthesized event; mocks `streamText` away | moderate | ~0 |
| **2b — real-stream replay** | a recorded `LanguageModelV3` stream replays through the *real* loop (`stopWhen`, multi-step) | high (hand-rolled V3 protocol; SDK-drift-exposed) | ~0 |
| **3 — live LLM run** | real Anthropic model + user-simulator, nightly/on-demand | moderate (+ CI infra) | ~50–150k per run |

## Scope decision (locked 2026-06-01)

**This slice builds Layers 1 + 2a.** Layers 2b and 3 are deferred to a dedicated follow-up
session. Rationale: the cost/brittleness cliff sits between 2a and 2b — 2b requires
hand-implementing the AI SDK's V3 streaming protocol (the exact class of runtime bug the
live-smokes have caught three times). 2a delivers real per-PR agent-turn side-effect
coverage at ~0 tokens without that risk. The live-LLM session (2b+3) also needs CI infra
(GitHub Actions + DB secrets), so that plumbing is built once, there.

Locked sub-decisions (do NOT redebate):

- **L1 fidelity = real DB-backed repository.** Apply through `makeRepository(handle.db)`
  against an isolated test schema (`tests/_db/setup.ts` `createTestSchema` +
  `tests/_db/seed.ts` `seedOrgAndUser`). Highest fidelity — exercises the real Drizzle
  merge, provenance write, JSON round-trip.
- **Fixtures = derive, don't store.** The persona JSON is the single source of truth. L1's
  `update_case` sequence and L2a's turn event are *derived* from `persona.caseFacts` via the
  shared harness — no parallel script files (which would drift). No change to
  `data/personas/*.json` or `PersonaSchema`. The only possible authored artifact is a
  per-persona turn-shape branch for the out-of-scope persona (it emits `out_of_scope`, not
  `update_case`) — handled inside `synthesizeTurnEvent`, keyed on `expected.outOfScope`, not
  a file.
- **CI = npm scripts only.** Add a `test:personas` script grouping the deterministic + replay
  suites. No `.github/workflows/` this slice — the robot is built in the 2b+3 session.
- **Harness shared (Approach 1).** The persona→CaseFacts mapping is currently duplicated
  across `tests/personas/eligibility.test.ts` and `tests/journey/compute-personas.test.ts`.
  2C adds two more consumers, so the mapping is extracted to one module. The two existing
  tests refactor to import it and must stay green (behavior unchanged).

## Architecture

Three units, each independently understandable and testable:

### Component A — shared persona harness (`tests/_personas/harness.ts`)

Single source of truth for turning a persona into the shapes the tests need. Extracts the
currently-copy-pasted helpers verbatim, then adds two derivation functions.

Moved verbatim (behavior must not change):
- `loadPersona(id: string): Persona`, `loadAllPersonas(): Persona[]` — read + `PersonaSchema.parse`.
- `wrap<T>(value: T)` — provenance wrapper `{ value, source: 'user_stated', sourceTurnId: null, confidence: 1, updatedAt: ISO }`.
- `DEGREE_MAP` — `M.Tech→master_eqf7`, `B.Tech→bachelor_eqf6`, `PhD→phd_eqf8`, etc.
- `toCaseFacts(persona): CaseFacts` — the wrapped-leaf mapping (education / employment /
  target; `full_time→regular`; `intendedVisa`/`targetConsulate` casts; skips the
  `1970-01-01` contract-start sentinel).
- `toProfile(persona): Profile` — identity mapping.

New:
- `deriveUpdateCalls(persona): UpdateCaseInputForLLM[]` — walks the same wrapped leaves
  `toCaseFacts` produces and emits one or more `update_case` inputs of the shape
  `{ source: 'user_stated', confidence: 1, updates: { '<dotted.path>': <raw value> } }`.
  This is the "derive-don't-store" decision in exactly one place. (Grouping: valid leaves
  may share a single call — `update_case` accepts a flat multi-path `updates` object and
  contradiction semantics are path-local. **But** any leaf whose raw value is invalid for
  its enum — see the out-of-scope edge below — MUST be isolated into its own single-path
  call, because `applyUpdate` validates eagerly and rejects the *whole* call on one bad
  value.)
- `synthesizeTurnEvent(persona)` — builds a well-formed `onFinish` event object (shape
  `{ text, content, toolCalls, toolResults, steps }`; no named SDK type — it's the
  structurally-typed object the existing `tests/api/chat.test.ts` already hand-constructs)
  carrying the derived
  `update_case` call(s) and matching `update_case_result` outputs
  (`{ type: 'update_case_result', version: 1, data: { caseId, updatedPaths, contradictions: [] } }`).
  For an out-of-scope persona (`expected.outOfScope === true`) it instead emits an
  `out_of_scope` tool call/result and no `update_case` — so the L2a Inngest assertion can
  prove the emit does NOT fire for that persona.

### Component B — Layer 1 test (`tests/personas/case-file.test.ts`)

DB-backed; the genuinely-new deterministic coverage (the strategy's
"scripted-sequence→end-state"). Per persona:

1. `beforeAll`: `handle = await createTestSchema()`; `seeded = await seedOrgAndUser(handle)`.
2. `repo = makeRepository(handle.db, handle.schemaName)`; `createCase({ userId: seeded.userId, visaType: 'blue_card', targetCountry: 'DE', targetConsulate: 'bengaluru' })`.
3. Apply each `deriveUpdateCalls(persona)` input via `repo.applyUpdate({ ...input, caseId, sourceTurnId })`.
4. `loaded = await repo.loadCase(caseId)`.
5. Assert `loaded.caseFacts` deep-equals `toCaseFacts(persona)` (derive round-trips through
   real Drizzle merge + JSON), and that no unexpected contradictions surfaced in the
   `applyUpdate` results.

Proves a persona's facts survive the real write path — not just the pure eligibility
function. `afterAll`: `handle.cleanup()`.

**Known edge — invalid-enum leaves (out-of-scope persona):** `toCaseFacts` constructs
objects directly and *casts* non-enum values (e.g. `out-of-scope-asylum` has
`target.visaType: "asylum"`, cast to `intendedVisa`), so it never hits runtime validation.
But L1 goes through the **real** `applyUpdate`, which calls `validateLeafValue` **eagerly,
before the transaction, for every path in the call** (`repository.ts:121-125`).
`validateLeafValue` **throws** on `'asylum'` (the `intendedVisa` enum is `['blue_card']`),
which rejects the **entire `applyUpdate` call** — it is all-or-nothing per call, NOT a
partial apply that reports a bad path. Consequences for the design:

- The deep-equals round-trip assertion is **scoped to in-scope personas** (every leaf a
  valid value).
- `deriveUpdateCalls` must **isolate any known-invalid leaf into its own single-path
  `update_case` call** (not bundle it with valid leaves), so one rejecting call does not
  sink the valid ones. It emits the **raw** persona value (no cast).
- The out-of-scope persona gets a *different, explicit* L1 assertion: the isolated
  `intendedVisa: 'asylum'` call **rejects** (`await expect(repo.applyUpdate(badCall))
  .rejects.toThrow(/invalid leaf value/)`), the remaining valid calls apply, and `'asylum'`
  is absent from the loaded facts. L1 thus proves the write path *guards* invalid enum
  values. The test owns this branch (keyed on `expected.outOfScope`); the harness only
  guarantees the isolation.

### Component C — Layer 2a test (`tests/personas/agent-turn-replay.test.ts`)

Exercises the agent turn's side-effect wiring without a model or DB, using the established
dependency-free pattern from `tests/api/chat.test.ts` (`vi.mock('ai')` capturing
`streamText` opts; `MockLanguageModelV2`/`msw` remain forbidden). Per persona:

1. Mock `ai`'s `streamText` to capture `opts.onFinish` and return a no-op
   `toUIMessageStreamResponse`.
2. Call `buildAgentTurn({ model: <inert sentinel>, repo: <in-memory fake>, caseId, threadId, userId, userMessageId, caseFacts, modelMessages })`. `model` is inert because `streamText` is mocked; `repo` is an in-memory `Repository` fake (L2a tests turn-wiring, not persistence — L1 covers DB).
3. Invoke the captured `onFinish` with `synthesizeTurnEvent(persona)`.
4. Assert side-effects:
   - `appendChatTurn` (mock `@/lib/ai/chat/persistence`) called with the persona's tool
     calls/results.
   - `inngest.send` (mock `@/lib/inngest/client`) fired with
     `{ name: 'case.facts.updated', data: { caseId, paths: <derived updatedPaths>, sourceTurnId } }`
     for `update_case`-bearing personas; and did **not** fire for the out-of-scope persona.

This covers the exact `onFinish` mapping the route depends on
(`event.toolResults.filter(r => r.toolName === 'update_case')` → `output.data.updatedPaths`
→ `inngest.send`), per persona.

## Data flow

```
persona.json ──PersonaSchema.parse──> Persona
   │
   ├── toCaseFacts(p) ───────────────> CaseFacts   (L1 expected end-state; L2a input)
   ├── deriveUpdateCalls(p) ─────────> UpdateCaseInputForLLM[]
   │        │
   │        └─ L1: repo.applyUpdate(...) ──> loadCase ──> assert == toCaseFacts(p)
   │
   └── synthesizeTurnEvent(p) ───────> onFinish event
            │
            └─ L2a: buildAgentTurn().onFinish(event) ──> assert appendChatTurn + inngest.send
```

## Scope boundaries (what this slice does NOT do)

- No real `streamText` execution — no `stopWhen`/multi-step loop, no model reading a tool
  result then calling another tool. That's **L2b** (recorded V3 stream replay), next session.
- No live model call, no user-simulator — **L3**, next session.
- No `.github/workflows/` — npm scripts only.
- No `data/personas/*.json` or `PersonaSchema` change; no parallel script/fixture files.

## Testing & verification

- **Refactor safety net:** run `tests/personas/eligibility.test.ts` and
  `tests/journey/compute-personas.test.ts` before and after the harness extraction; results
  must be identical (green).
- L1 is DB-backed → runs under the serial `--no-file-parallelism` convention to avoid
  `EMAXPOOLSREACHED`. The harness + L2a are pure/in-memory.
- Final gate: full suite serial green; `tsc --noEmit` clean; `pnpm lint` clean.
- New `package.json` script `test:personas` runs the persona suites (eligibility + journey
  compute-personas + new case-file + agent-turn-replay) — the "deterministic core" grouping
  the strategy names.

## File summary

**New:**
- `tests/_personas/harness.ts` — shared mapping + `deriveUpdateCalls` + `synthesizeTurnEvent`.
- `tests/_personas/repo-fake.ts` — in-memory `Repository` fake for L2a (if not trivially inlinable).
- `tests/personas/case-file.test.ts` — Layer 1 (DB-backed end-state).
- `tests/personas/agent-turn-replay.test.ts` — Layer 2a (`onFinish` side-effects).

**Modified:**
- `tests/personas/eligibility.test.ts` — import harness (drop local copies).
- `tests/journey/compute-personas.test.ts` — import harness (drop local copies).
- `package.json` — add `test:personas`.

## Follow-up (next session: 2b + 3)

- **L2b** — recorded `LanguageModelV3` stream replay driving the real `buildAgentTurn` loop
  (real tools, `stopWhen`, multi-step recovery). Requires a one-time live recording.
- **L3** — live Anthropic run per persona + user-simulator (scripted vs. LLM-as-user TBD),
  end-state assertions, nightly/on-demand.
- **CI infra** — `.github/workflows/` (PR deterministic gate + nightly live run) with DB
  secrets; serial to dodge `EMAXPOOLSREACHED`.
