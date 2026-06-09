# Phase 2C-tail — L2b Real-Stream Replay (design)

> Design doc. Brainstormed with the user 2026-06-02. Scope of the deferred 2C tail is
> deliberately cut to **L2b only** (real-stream replay), done well. L3 (live LLM +
> user-simulator) and the GitHub Actions CI remain deferred to a later session.

## Context

CLAUDE.md pins persona testing as a layered strategy and calls the persona suite "the
strongest E2E signal we have." 2C layers 1 + 2a shipped in PR #4 and are merged to `main`:

- **L1** (`tests/personas/case-file.test.ts`) — DB-backed: applies derived `update_case`
  calls through the real repository, asserts persisted end-state.
- **L2a** (`tests/personas/agent-turn-replay.test.ts`) — drives `buildAgentTurn`'s `onFinish`
  with a *synthesized* event; `streamText` is mocked away entirely.

The 2C design doc's "Follow-up" section named three remaining pieces: L2b (real-stream
replay), L3 (live LLM), CI infra. This slice builds **only L2b**.

### Premise change discovered during brainstorming (2026-06-02)

The original 2C design deferred L2b as "the hard/brittle half" because it was believed to
require **hand-rolling the AI SDK's V3 streaming protocol** — the exact class of runtime bug
the live smokes caught three times. CLAUDE.md pins: *"`MockLanguageModelV2` is NOT installed
— `ai/test` needs `msw` (forbidden new dep)."*

**That pin is stale.** It was written under `ai@5`. Verified against the current
`node_modules` (the repo is on `ai@^6.0.191`):

- `require('ai/test')` succeeds and exports **`MockLanguageModelV3`** (plus
  `convertArrayToReadableStream`, `simulateReadableStream`, etc.).
- **`msw` is absent** from `node_modules`, and `ai/test` imports/runs fine without it.
- A probe drove a scripted `doStream` → real `streamText` → `stopWhen` loop → `onFinish`
  fired with the streamed text. ✓

So L2b does **not** need a hand-rolled protocol. We use the SDK's own first-party
`MockLanguageModelV3`, which cannot drift from the protocol. The brittleness that justified
deferral is gone. **This slice also fixes the stale CLAUDE.md note.**

## What L2b uniquely proves

L2b is the only layer where the SDK invokes the **real tool `execute` functions** across
**multiple real steps** and produces a **real** `onFinish` event.

| Layer | model | `streamText` loop | tools execute | repo | `onFinish` event |
|---|---|---|---|---|---|
| L1 | — | — | — (calls `applyUpdate` directly) | **real DB** | — |
| L2a | mocked away | — | — | in-memory stub | **synthesized** |
| **L2b** | **MockLanguageModelV3** | **real** | **real** | **real DB** | **real** |

## Scope decision (locked 2026-06-02)

- **L2b only.** Defer L3 (live Anthropic run + user-simulator) and `.github/workflows/` CI to
  a later session.
- **Repo fidelity = real DB-backed.** Reuse L1's `createTestSchema` + `seedOrgAndUser` +
  `makeRepository`. The mock model emits an `update_case` call; the SDK runs the real tool
  against a real Drizzle schema; `check_eligibility` then reads it back. Highest fidelity.
- **Step sequence = happy-path + one recovery scenario.** Happy path proves
  model-reads-result-then-calls-another-tool plus real tool execution. The recovery scenario
  proves the `MAX_AGENT_STEPS = 8` budget (raised in 2A.2 precisely for tool-error recovery),
  which no current test exercises.
- **Test-only PLUS one `src/` fix.** L2b is expected to surface a real `buildAgentTurn`
  `onFinish` bug (see below). The user chose **fix-it-here via TDD**: L2b is the red test that
  drives the fix. (Scope guard: if the bug does not reproduce against the real loop, L2b
  stays green as pure coverage and no `src/` changes — outcome reported either way.)
- **Derive, don't store** (carried from 2C): tool *arguments* come from the existing
  `deriveUpdateCalls(persona)`. The mock-stream helper only sequences calls; it never
  hand-writes fact values. Authored content is limited to control flow (which tools, what
  order — agent behavior, not persona data) and the one deliberately-bad path in the recovery
  scenario. No `data/personas/*.json` or `PersonaSchema` change.

## The bug L2b drives a fix for (evidenced, to be confirmed on first run)

The AI SDK's `onFinish` event type is `OnFinishEvent<TOOLS> = StepResult<TOOLS> & { steps:
Array<StepResult> }` (`node_modules/ai/dist/index.d.ts:3262`). The doc comment on its
`toolResults` reads literally: **"The results of the tool calls from the last step."** The
aggregate across steps lives in `event.steps[]`.

But `buildAgentTurn`'s `onFinish` (`src/lib/ai/chat/agent-turn.ts:98,110`) reads **top-level**
`event.toolResults` for BOTH persistence and the Inngest emit:

```ts
toolResults: event.toolResults.map(...)                                   // -> appendChatTurn
const updateResults = event.toolResults.filter(r => r.toolName === 'update_case'); // -> inngest
```

In the normal happy path the model calls `update_case`, then — per the CLAUDE.md gotcha
*"`stopWhen: stepCountIs(N)` with N≥2 is required to get a natural-language reply after a tool
call"* — replies with **text in a later step**. The final step therefore has no tool results,
so top-level `event.toolResults` is `[]`. Consequence:

- Tool parts are **dropped from chat history** (`appendChatTurn` gets empty `toolResults`).
- The `case.facts.updated` **Inngest emit never fires** — even though the `update_case` tool
  already wrote the facts to the DB in the earlier step. (Downstream: the activity-log row
  for the fact update is never written.)

**Why existing unit tests are green anyway:** both `tests/api/chat.test.ts` and the L2a
replay test *synthesize* an event with `toolResults` hand-placed at the top level and `steps:
[]` — a shape the real multi-step SDK does not produce. This is the precise L2a blind spot
L2b exists to close.

**Probe evidence (mock model, not yet the real provider):** a two-step turn (step 1 =
`update_case`, step 2 = text reply) produced top-level `event.toolResults.length === 0`, with
the result present only in `event.steps[0].toolResults`. Flattening `event.steps` recovered
it. NOT yet confirmed against the real Anthropic provider — the first L2b run confirms or
refutes; the fix is gated on that real evidence.

### The fix

`src/lib/ai/chat/agent-turn.ts` `onFinish` — aggregate across steps:

```ts
const allToolCalls   = event.steps.flatMap((s) => s.toolCalls);
const allToolResults = event.steps.flatMap((s) => s.toolResults);
```

Persistence maps `allToolCalls`/`allToolResults`; the Inngest filter runs over
`allToolResults`. A single-step turn has exactly one step, so `steps.flatMap(...)` equals
today's top-level read — no regression for single-step turns.

### Regression companion — realign the synthesized-event fixtures

After the fix reads `event.steps`, the synthesized events that hard-code top-level
`toolResults` with `steps: []` would suddenly expose **no** tool results and break:

- `tests/_personas/harness.ts` — `synthesizeTurnEvent` must populate `event.steps` to mirror
  the real shape (one step carrying the tool calls/results, plus the terminal text step),
  rather than only placing them at the top level.
- `tests/api/chat.test.ts` — realign its synthesized fixture the same way.

This is a strict fidelity improvement: L2a's premise is "a well-formed event the real SDK
produces," and today it is not. The change is driven test-first alongside the L2b red→green.

## Architecture

Three units, each independently understandable and testable.

### Component A — scripted mock-stream helper (`tests/_personas/mock-stream.ts`)

The one genuinely new building block. Turns a desired tool-call sequence into a
`MockLanguageModelV3` whose `doStream` returns the right chunks **per step**.

With the real loop, the SDK calls `doStream` once per step. Each call emits either tool-call
chunks (→ SDK runs the real tool, loops again) or text chunks with `finishReason: 'stop'`
(→ loop ends). The mock is a small state machine over a step counter.

```ts
type ScriptStep =
  | { kind: 'tool'; toolCallId: string; toolName: string; input: unknown }
  | { kind: 'text'; text: string };   // terminal — emits finishReason 'stop'

function makeScriptedModel(steps: ScriptStep[]): LanguageModelV3;
```

Internals: a closure over `let i = 0`; each `doStream` call emits step `i++`'s chunks. Tool
steps emit `{ type: 'tool-call', toolCallId, toolName, input: JSON.stringify(input) }` +
`{ type: 'finish', finishReason: 'tool-calls', usage }`. The terminal text step emits
`text-start` / `text-delta` / `text-end` + `{ type: 'finish', finishReason: 'stop' }`. This
exact chunk protocol is confirmed working against the real `streamText` (probe).

The helper knows nothing about personas or the DB — it takes a `ScriptStep[]` and returns a
model. The test composes persona-derived args into scripts.

### Component B — L2b test (`tests/personas/agent-turn-loop.test.ts`)

DB-backed, serial. Reuses L1's harness for schema/seed/repo and the persona harness for
`deriveUpdateCalls`/`toCaseFacts`/`loadAllPersonas`.

**Per-persona happy path (all 4 personas):**

```
beforeAll: handle = await createTestSchema(); seed via seedOrgAndUser(handle);
           repo = makeRepository(handle.db, handle.schemaName)
per persona:
  { caseId, threadId } = await repo.createCase({ userId, visaType:'blue_card',
                                                 targetCountry:'DE', targetConsulate:'bengaluru' })
  in-scope script:
    [ { tool update_case, input: deriveUpdateCalls(p)[0] },
      { tool check_eligibility, input: {} },
      { text } ]
  out-of-scope script:
    [ { tool out_of_scope, input: { reason } }, { text } ]
  model = makeScriptedModel(script)
  result = await buildAgentTurn({ model, repo, caseId, threadId, userId, userMessageId,
                                  caseFacts, modelMessages })
  drain the stream: for await (const _ of result.textStream) {}   // forces loop + onFinish
  assert:
    1. (in-scope) loadCase(caseId).caseFacts == toCaseFacts(p)     — real write path
    2. (in-scope) the real check_eligibility tool ran on the WRITTEN facts — read its
       eligibility_result output from the matching toolResult in event.steps[] and assert its
       status/route is consistent with p.expected (proves the update_case → DB → check_eligibility
       read-back chain through the live loop; the full verdict matrix stays owned by eligibility.test.ts)
    3. onFinish side-effects fired with the REAL event shape (the bug-catching assertions, §"The fix")
    out-of-scope persona: no facts written; assert out_of_scope persisted and the
       case.facts.updated inngest emit did NOT fire (mirrors the L2a out-of-scope assertion)
afterAll: handle.cleanup()
```

**Recovery scenario (one persona, e.g. `priya-strong`):**

```
script:
  [ { tool update_case, input: { source:'user_stated', confidence:1, updates:{ 'bad.path':'x' } } }, // real tool throws; loop survives (probed)
    { tool read_case, input: {} },                                                                    // recover
    { tool update_case, input: deriveUpdateCalls(p)[0] },                                              // correct write
    { tool check_eligibility, input: {} },
    { text } ]
assert: loop completed within MAX_AGENT_STEPS (8); final DB facts correct despite the mid-loop error
```

Stream consumption: `onFinish` fires only once the returned stream is consumed; the test
drains `result.textStream` before asserting (confirmed in probe).

### Component C — the `onFinish` fix + fixture realignment

See "The fix" and "Regression companion" above. Touches `src/lib/ai/chat/agent-turn.ts`,
`tests/_personas/harness.ts`, `tests/api/chat.test.ts`.

## Data flow

```
persona.json ──PersonaSchema.parse──> Persona
   │
   ├── deriveUpdateCalls(p) ─────────> tool args (derive-don't-store)
   │         │
   │         └─ ScriptStep[] ──makeScriptedModel──> MockLanguageModelV3
   │                                                      │
   │   buildAgentTurn({ model, repo, ... }) ── real streamText loop ──┐
   │                                                                   │
   │   real tools execute (update_case → applyUpdate → real DB;        │
   │   check_eligibility → engine on written facts)                    │
   │                                                                   ▼
   │   real onFinish(event with steps) ── appendChatTurn + inngest.send (aggregated over steps)
   │
   └── toCaseFacts(p) ───────────────> L2b end-state assertion (loadCase == this)
```

## Scope boundaries (what this slice does NOT do)

- No live Anthropic model call, no user-simulator — that is **L3**, a later session.
- No `.github/workflows/` CI — npm scripts only (`test:personas` extended).
- No `data/personas/*.json` or `PersonaSchema` change; no parallel script/fixture files.
- No new runtime dependency (`MockLanguageModelV3` is part of the already-installed `ai@6`;
  `msw` stays out).

## Testing & verification

- **TDD order:** write L2b → it goes **red** (proves the `onFinish` bug against the real
  loop) → apply the `event.steps` aggregation fix + realign the two synthesized fixtures →
  L2b and the realigned L2a/`chat.test.ts` go **green**.
- **Refactor safety net:** the existing 27 deterministic-core tests (L1, L2a, eligibility,
  journey compute-personas, harness) stay green after the harness `synthesizeTurnEvent`
  change.
- L2b is DB-backed → runs under the serial `--no-file-parallelism` convention to avoid
  `EMAXPOOLSREACHED`.
- **Final gate:** full suite serial green; `tsc --noEmit` clean; `pnpm lint` clean.

## File summary

**New:**
- `tests/_personas/mock-stream.ts` — `makeScriptedModel(steps)` → `MockLanguageModelV3`.
- `tests/personas/agent-turn-loop.test.ts` — L2b: real loop + real tools + real DB
  (happy-path ×4 + 1 recovery scenario).

**Modified:**
- `src/lib/ai/chat/agent-turn.ts` — `onFinish` aggregates `event.steps[].toolCalls/toolResults`.
- `tests/_personas/harness.ts` — `synthesizeTurnEvent` populates `event.steps`.
- `tests/api/chat.test.ts` — realign synthesized fixture to populate `steps`.
- `package.json` — add `agent-turn-loop.test.ts` to the `test:personas` group.
- `CLAUDE.md` — fix the stale `MockLanguageModelV3`/`msw` note; add an
  `onFinish`-reads-`event.steps` gotcha.

## Follow-up (later session)

- **L3** — live Anthropic run per persona + user-simulator (scripted vs. LLM-as-user TBD),
  end-state assertions, nightly/on-demand.
- **CI infra** — `.github/workflows/` (PR deterministic gate + nightly live run) with DB
  secrets; serial to dodge `EMAXPOOLSREACHED`.
