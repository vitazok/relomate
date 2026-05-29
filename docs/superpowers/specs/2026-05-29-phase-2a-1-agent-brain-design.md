# Phase 2A.1 — Agent Brain (context builder + real prompt + I/O tools)

**Date:** 2026-05-29
**Status:** Design — pending user review
**Phase:** 2A.1 (first of four Phase 2 slices)
**Companion:** `PRD.md` §8.3, `IMPLEMENTATION_PLAN.md` Phase 2, `CLAUDE.md`

---

## 1. Context

Phase 1B-3 shipped a working-but-thin agent loop: one tool (`update_case`), a
stub system prompt (`v0-stub.md`), and a stub context builder that returns only
`{ caseFactsJson }` — which the route then **discards**. Phase 2 turns this into
a real intake system.

Phase 2 is too large for one Claude Code session (~1.5–2M tokens). It is split
into four sessions, each budgeted well under 1M:

| Slice | Contents | Est. clean / worst |
|---|---|---|
| **2A.1** (this spec) | context builder + `v0.md` prompt + `read_case`, `add_case_note`, `out_of_scope` + model-injection seam + minimal renderer registry | ~580k / ~770k |
| **2A.2** | `check_eligibility`, `simulate_what_if`, `lookup_anabin` + eligibility wired into the loop | ~400k / ~600k |
| **2B** | Overview, Profile, Activity sections rendering real case data | ~400k / ~600k |
| **2C** | layered persona E2E: deterministic core + fixture-replayed agent loop | ~350k / ~550k |

The session-token budget (not API cost) drove the split: ~15-task slices run
~400–600k clean and ~700–900k with a debug detour, calibrated against the three
1B sub-slices. 2A.1 is the heaviest of the four because of the renderer registry;
if its context climbs during build, the registry is the natural checkpoint to
finish in 2B.

### Persona testing strategy (decided, affects 2C — recorded here for continuity)

**Layered (A):** the deterministic core (pure `evaluateEligibility` + tool-unit
tests + scripted-sequence → case-end-state) runs every PR at ~0 tokens and
catches most regressions. The LLM-driven agent loop is recorded once and
**replayed via `MockLanguageModelV2`** in CI (0 tokens/PR, deterministic). A real
live LLM run is a deliberate nightly/on-demand spend, prompt-cached. The
`MockLanguageModelV2` replay mechanics must be validated before 2C's spec
commits to them.

This decision reaches back into 2A.1: the agent loop must be structured so the
**model is injectable** (real provider in prod, mock in tests). 2A.1 establishes
that seam so 2C is drop-in.

---

## 2. Scope

### In scope (2A.1)

1. **`buildAgentContext`** — real implementation injecting full `CaseFacts` + a
   one-line status into the system message. Route stops discarding the return.
2. **`prompts/agent/v0.md`** — real system prompt for the **full Phase 2 tool
   catalog**, replacing `v0-stub.md`. `PROMPT_VERSION` bumps to `v0`.
3. **`buildAgentTurn`** — extract the `streamText` construction from `route.ts`
   into a testable factory accepting an injected `model`. Establishes the
   model-injection seam for 2C.
4. **Three tools** (factory pattern, Zod I/O, `{type, version, data}` output):
   - `read_case` — non-mutating; targeted case-slice / provenance read.
   - `add_case_note` — appends an `activity_log` row; not case state.
   - `out_of_scope` — structured refusal; logs activity; does **not** set the
     eligibility `outOfScope` flag.
5. **Minimal renderer registry** — dispatch-on-`type` registry (CLAUDE.md rule 8)
   with simple renderers for `update_case` / `read_case` / `add_case_note` /
   `out_of_scope`, replacing the `[tool-name]` placeholder in `ChatPanel`. Rich
   workspace UI still lands in 2B.
6. **Repository `appendActivity`** method used by `add_case_note` and
   `out_of_scope`.

### Explicitly out of scope (deferred)

- `check_eligibility`, `simulate_what_if`, `lookup_anabin` → 2A.2.
- Eligibility wired into the agent loop → 2A.2.
- Recent-activity tail in context (new `listRecentActivity`) → 2A.2/2B.
- Workspace sections rendering real data → 2B.
- Per-message / per-context prompt caching → Phase 2 later (Pinned decision).
- `tasks` table / "top tasks" in context — tasks don't exist yet (Phase 3+).

---

## 3. Decisions (from brainstorming)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Inject full `CaseFacts`; keep `read_case` minimal.** | MVP cases are small; full injection is the simplest mental model. `read_case` covers targeted detail/provenance the slice omits; its description steers the agent to use it sparingly. |
| D2 | **`add_case_note` writes `activity_log`, `kind: 'case.note.added'`.** | No `notes` table exists; a new one is premature. `activity_log` is append-only by design (rule 10), needs no migration, and surfaces in the Activity section in 2B. A note is an annotation, not a structured fact. |
| D3 | **Context = full case facts only (no activity tail in 2A.1).** | Message history already gives conversational recency. Activity is sparse until tools write more; add the tail in 2A.2/2B when there's something to show. Avoids a new repo read method this slice. |
| D4 | **Establish the model-injection seam now** via `buildAgentTurn({ model, ... })`. | 2A.1 already restructures the route; doing the seam once here makes 2C's fixture-replay harness drop-in, instead of re-opening a stabilized loop. |
| D5 | **Build a minimal renderer registry now.** | Closes the standing CLAUDE.md rule-8 gap (`ChatPanel` currently renders `[tool-name]`). The `out_of_scope` refusal in particular must read well. Rich UI still lands in 2B. |
| D6 | **Write `v0.md` for the full Phase 2 catalog now; register tools incrementally.** | Writing the prompt once avoids cross-session drift; the prompt is cheap. Mitigation: only existing tools are registered in 2A.1, and the prompt frames eligibility as running "when you have enough information," so a 2A.1 live smoke can't call a missing tool. |

---

## 4. Architecture

### 4.1 Agent-loop factory (`src/lib/ai/chat/agent-turn.ts`)

Extract the `streamText` construction out of `route.ts`:

```
buildAgentTurn({
  model,            // injected: anthropic(MODEL_ID) in route, MockLanguageModelV2 in tests
  repo,
  caseId,
  threadId,
  userMessageId,
  caseFacts,
  modelMessages,    // already converted
}) → streamText result (model + system + tools + stopWhen + providerOptions + onFinish)
```

- The **route** keeps HTTP concerns: body parse, auth (`getCurrentUserId`),
  ownership check, `result.toUIMessageStreamResponse()`. It calls
  `buildAgentTurn` with the real provider.
- The factory owns: composing the system prompt (`v0.md` + injected context),
  building the tool set, `stopWhen: stepCountIs(5)`, system+tool prompt caching,
  and `onFinish` (persistence via `appendChatTurn` + Inngest emit). Moving
  `onFinish` into the factory means a recorded loop replays the **whole** turn
  including writes.
- The `as unknown as LanguageModel` cast (ai@5/ai@6 dual-install, documented in
  CLAUDE.md) stays at the seam; the factory's `model` param is typed
  `LanguageModel`.

### 4.2 Context builder (`src/lib/ai/chat/context-builder.ts`)

```
buildAgentContext({ caseId, caseFacts }) → { systemContext: string }
```

- `systemContext` = full `CaseFacts` JSON + a one-line case-status summary.
- The factory composes `system: v0.md + "\n\n" + systemContext`.
- Async signature retained for 2A.2+ awaits.

### 4.3 System prompt (`prompts/agent/v0.md`)

Replaces `v0-stub.md`. `PROMPT_VERSION = 'v0'` (in `system-prompt.ts`). Sections:

- **Role + scope** — Blue Card · India → Germany · Bengaluru consulate; in-scope
  vs. out-of-scope boundary.
- **Tool rules** — when to call each tool. Reinforces CLAUDE.md rule 7: never
  quote thresholds/fees/processing-times; eligibility numbers come only from
  tools. References the full Phase 2 catalog (D6); frames eligibility as running
  "when you have enough information."
- **Contradiction handling** — acknowledge → confirm → update; never silently
  overwrite (CLAUDE.md).
- **Conversation style** — never say a user "definitely qualifies"; uncertainty
  is explicit.

The system prompt is not user-visible UI text, so the i18n rule (rule 6) does
not apply to it or to tool descriptions.

### 4.4 Tools

All use `makeXTool(repo, defaults)`, Zod `inputSchema`, per-tool
`providerOptions.anthropic.cacheControl`, and return `{type, version, data}`.

- **`read_case`** (`src/lib/ai/tools/read_case.ts`)
  - Input: optional `section` (`'employment'|'education'|'family'|'target'`)
    and/or `paths: string[]` selector. Empty input → full facts (intentionally
    redundant with the injected context per D1 — `read_case` is a fallback the
    agent rarely needs; its description steers toward targeted `section`/`paths`
    reads).
  - Output: `{type:'read_case_result', version:1, data:{ facts | slice, ... }}`.
  - Non-mutating.
- **`add_case_note`** (`src/lib/ai/tools/add_case_note.ts`)
  - Input: `{ note: string }`.
  - Effect: `repo.appendActivity({ caseId, userId, kind:'case.note.added',
    payload:{ note, sourceTurnId } })`.
  - Output: `{type:'add_case_note_result', version:1, data:{ noted:true }}`.
  - Does not touch case state (rule 5 holds — append-only audit log).
- **`out_of_scope`** (`src/lib/ai/tools/out_of_scope.ts`)
  - Input: `{ reason: string, category?: string }`.
  - Effect: logs `activity_log` `kind:'case.out_of_scope'`.
  - Output: `{type:'out_of_scope_result', version:1, data:{ reason, category }}`
    — a structured refusal card.
  - Does **not** set the eligibility `outOfScope` flag (engine's job, 2A.2).

### 4.5 Repository `appendActivity`

```
appendActivity({ caseId, userId, kind, payload }) → Promise<void>
```

One `tx.insert(schema.activityLog)` (reuses the existing write pattern in
`applyUpdate`). Append-only; respects rule 10.

### 4.6 Renderer registry (`src/components/workspace/renderers/`)

- A `registry: Record<string, Renderer>` keyed by output `type`
  (`update_case_result`, `read_case_result`, `add_case_note_result`,
  `out_of_scope_result`).
- `ChatPanel` dispatches `tool-*` parts: read `part.output.type`, look up the
  renderer, fall back to a generic renderer for unknown types.
- Simple, readable renderers in 2A.1; `out_of_scope` gets a proper refusal card.
  Rich UI is 2B.

---

## 5. Testing (TDD)

Use `vi.mock('@/lib/db/client', () => ({ get db() { return testHandle.db; } }))`
(getter pattern, no `schema` in factory — per CLAUDE.md test gotchas).

- **Tools** — `read_case` / `add_case_note` / `out_of_scope` `execute()` →
  correct `{type,version,data}` output + repo side-effects.
- **`buildAgentContext`** — returns full-facts block + status line.
- **`buildAgentTurn`** — driven with `MockLanguageModelV2` emitting a scripted
  tool call → assert tool executed and `onFinish` persisted. This proves the
  model seam before 2C depends on it.
- **Renderer registry** — dispatch on `type`; fallback for unknown type.
- **Repository** — `appendActivity` writes the expected row.

---

## 6. Verification gate (2A.1)

- [ ] `pnpm test` green
- [ ] `pnpm build` green
- [ ] `pnpm lint` clean
- [ ] `pnpm exec tsc --noEmit` clean
- [ ] Live smoke: send a message → agent calls a tool → renders via the registry;
      trigger an off-scope message → `out_of_scope` refusal card displays.

---

## 7. Files touched

**New:**
- `src/lib/ai/chat/agent-turn.ts`
- `src/lib/ai/tools/read_case.ts`
- `src/lib/ai/tools/add_case_note.ts`
- `src/lib/ai/tools/out_of_scope.ts`
- `src/components/workspace/renderers/` (registry + per-type renderers)
- `prompts/agent/v0.md`
- tests for each of the above

**Modified:**
- `src/app/api/chat/route.ts` — delegate loop to `buildAgentTurn`; use context return.
- `src/lib/ai/chat/context-builder.ts` — real implementation.
- `src/lib/ai/chat/system-prompt.ts` — load `v0.md`; `PROMPT_VERSION = 'v0'`.
- `src/lib/case/repository.ts` — add `appendActivity`.
- `src/components/workspace/ChatPanel.tsx` — dispatch via registry.

---

## 8. Risks

- **Renderer registry inflates 2A.1** (~580k/~770k). Mitigation: it's the natural
  checkpoint — if context climbs, finish renderers in 2B.
- **`v0.md` references tools not yet registered** (D6). Mitigation: register only
  existing tools; prompt frames eligibility as conditional, so a live smoke can't
  call a missing tool.
- **Model seam vs. ai@5/ai@6 cast.** The cast stays localized at the seam; the
  factory param is typed `LanguageModel`. No new casts introduced.
