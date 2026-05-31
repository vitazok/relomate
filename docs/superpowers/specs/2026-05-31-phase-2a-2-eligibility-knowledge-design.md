# Phase 2A.2 — Eligibility + Knowledge Tools

**Date:** 2026-05-31
**Status:** Design — pending user review
**Phase:** 2A.2 (second of four Phase 2 slices)
**Companion:** `docs/superpowers/specs/2026-05-29-phase-2a-1-agent-brain-design.md`, `PRD.md` §8.3, `CLAUDE.md`

---

## 1. Context

2A.1 shipped the agent brain: a real `v0.md` prompt, the `buildAgentTurn` factory
with an injectable model, full-`CaseFacts` context injection, four I/O tools
(`update_case`, `read_case`, `add_case_note`, `out_of_scope`), and a minimal
renderer registry. It is merged and live-smoke-passed.

2A.2 wires the **deterministic eligibility engine** and the **Anabin knowledge
seed** into the agent loop as two new tools. The engine (`evaluateEligibility`)
and seed (`anabin-seed.yaml` + loader) already exist and are persona-tested; this
slice exposes them to the agent with transparency-first presentation.

### Design value: transparency for the end user

The user should **see the logic** behind every eligibility conclusion — their
salary, the applicable threshold, the legal basis, and which routes that opens —
not just a yes/no. This value drives the tool output shapes and renderer cards
below. The agent's prose stays numberless; the **renderer card** is where the
user reads tool-sourced figures (reconciling CLAUDE.md rule 7 with rule 8).

---

## 2. Scope

### In scope (2A.2)

1. **`check_eligibility`** tool — runs a readiness gate, then the pure engine,
   then assembles sourced figures; logs an activity row; returns a discriminated
   verdict. Wired into `buildAgentTurn`.
2. **`lookup_anabin`** tool — wraps `getAnabinInstitutionByName`; distinguishes
   not-seeded from seeded-but-unrated. Read-only.
3. **`assessReadiness(facts)`** — new pure function (rules module) deciding
   whether enough facts exist to produce a meaningful verdict.
4. **`summarizeFigures(facts, today)`** — new pure function (rules module)
   returning the sourced threshold/legalBasis/salary figures for the card,
   reading the **same** route→threshold mapping the engine uses (no drift).
5. **Renderer cards** for `eligibility_result` and `anabin_result` in the
   registry.
6. **Cache-breakpoint consolidation** — collapse the four per-tool
   `cache_control` breakpoints to a single tool-block breakpoint before
   registering the two new tools (Anthropic max is 4; 6 tools would 400).
7. **`v0.md`** — drop the "available from a later build step" caveats on
   `check_eligibility`/`lookup_anabin`; add concise "when to call" guidance.

### Explicitly out of scope (deferred)

- **`simulate_what_if`** — deferred. If hypothetical exploration is ever needed,
  fold it into `check_eligibility` as an optional `overrides` parameter rather
  than a separate tool (saves a tool slot; same verdict shape). No `v0.md`
  reference exists today, so nothing dangles.
- Persisting the verdict to case state — verdict is ephemeral (compute-on-demand);
  only an activity-log row records that a check ran. (§3.1 D-Storage.)
- Journey-tracker dashboard reading the verdict — 2B. (`assessReadiness` /
  `summarizeFigures` are built pure here so 2B reuses them at ~0 tokens.)
- Rich/polished card UI — 2B. 2A.2 ships functional, readable cards.
- Changing `evaluateEligibility`'s return contract — engine stays slim; persona
  + unit tests unchanged.

---

## 3. Decisions (from brainstorming)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Hybrid number boundary:** figures live in the tool's `data`; the renderer card displays them; the agent's prose stays numberless and refers to the card. | Transparency goal: the user sees salary-vs-threshold logic. Rule 7 satisfied because the figure the user sees is provably tool-sourced (rendered from `data`), never the model's prose. |
| D2 | **Verdict is ephemeral** (compute-on-demand). `check_eligibility` logs `activity_log` `kind:'case.eligibility.checked'` with the verdict in payload; no case-state column. | Rule 5 (only `update_case` writes case state) + append-only audit (rule 10). Recompute is cheap and always reflects latest facts; avoids a stale stored verdict. Gives 2B's Activity section + Phase 7 eval a trail. |
| D3 | **Figures via a pure helper** (`summarizeFigures`), co-located with the engine and **threshold-centric** (salary vs. the standard + reduced thresholds), NOT per-route. The helper imports the engine's `activeThreshold` (exported, no behavior change). | The engine already computes these figures internally and discards them. A per-route "required amount" was the original idea but risks drift — `it_no_degree` gates on the **standard** threshold while `blue-card.yaml`'s `reduced.appliesTo` lists `it_specialist_no_degree` — and over-claims: Priya's salary clears the reduced threshold (so a `recent_graduate` per-route line would show ✓) even though the engine denies that route on the 3-year completion gate. Showing the two thresholds + salary, and listing **granted** routes separately from `verdict.routes`, is honest and sidesteps both problems. Engine return stays slim. |
| D4 | **Readiness as a separate pure fn** (`assessReadiness`), not inline in the tool, not folded into the engine. | Testable in isolation; reused by 2B's journey-tracker eligibility phase at ~0 tokens; keeps the engine's "codes the personas expect" contract untouched (folding `incomplete` into the engine would flip partial-case outputs and risk existing tests). |
| D5 | **`lookup_anabin` distinguishes not-found from unknown.** Not-seeded → `found:false`; seeded-but-unrated → `found:true, status:'unknown'`. | Honest about what we have on file. Both steer the agent to "ZAB statement + consulate clarification," but with distinct, accurate card copy. |
| D6 | **`check_eligibility` reports a distinct `incomplete` status** when readiness fails, listing missing facts — never a misleading `qualifies:false`. | A half-filled case must not read as "you don't qualify." Serves transparency. |
| D7 | **Keep `PROMPT_VERSION = 'v0'`.** | v0 is the Phase-2 generation of the prompt, built incrementally across 2A.1/2A.2/2B; it already declares both tools. Removing a temporary caveat is not a new behavior contract. No consumer reads the version distinction yet (Phase 7 eval unbuilt). Reserve a bump for the next generational rewrite. |
| D8 | **Single tool-block cache breakpoint.** | Anthropic allows max 4 `cache_control` breakpoints; six tools each carrying one would 400. One breakpoint on the last registered tool caches the whole static tool block and is robust to future tool growth. |

---

## 4. Architecture

### 4.1 Readiness gate (`src/lib/rules/eligibility-readiness.ts`)

```
assessReadiness(facts: CaseFacts) → { ready: boolean; missing: string[] }
```

Pure. `ready` iff the minimum inputs for *some* route are present:

- `employment.annualGrossSalaryEur` present, **AND**
- either `education.anabinStatus` present (degree routes) **or** the IT-no-degree
  shape (`employment.iscoCode` + `employment.priorExperienceYears` present, no
  `education.highestDegree`).

`missing` lists the dotted paths that would unblock a check (e.g.
`['employment.annualGrossSalaryEur']`). The exact predicate is refinable during
planning; all four MVP personas satisfy it (so all assess), and the `incomplete`
path covers mid-conversation partial cases.

### 4.2 Figures helper (`src/lib/rules/eligibility-figures.ts`)

```
summarizeFigures(facts: CaseFacts, today: Date) → Figures
```

Pure. Threshold-centric (not per-route). Returns:

```
Figures = {
  salaryOnFile: number | null,
  standard: { annualGrossEur: number; legalBasis: string; meets: boolean | null },
  reduced:   { annualGrossEur: number; legalBasis: string; meets: boolean | null },
}
```

`meets = salaryOnFile != null ? salaryOnFile >= annualGrossEur : null`. Both
figures come from the engine's `activeThreshold(rules, today)` — exported from
`eligibility.ts` with **no behavior change** so the helper reads exactly the
threshold the engine branches on. The card pairs this with the verdict's
**granted** `routes` (the engine's authoritative list); it does NOT compute
per-route eligibility itself, which is the anti-drift / anti-over-claim guarantee
in D3.

### 4.3 `check_eligibility` (`src/lib/ai/tools/check_eligibility.ts`)

Factory `makeCheckEligibilityTool(repo, defaults)` where
`defaults = { defaultCaseId, defaultUserId, now?: () => Date }` (`now` defaults to
`() => new Date()`; injectable so tests pin the date, mirroring the engine's
parameterized `today`).

```
Input:  {}  (no params; reads current facts + profile via repo.loadCase)
Output: { type: 'eligibility_result', version: 1, data: Verdict }

Verdict =
  | { status: 'out_of_scope'; reason: string }
  | { status: 'incomplete'; missing: string[] }
  | { status: 'assessed';
      qualifies: boolean;
      routes: RouteId[];
      blockers: string[];
      warnings: string[];
      figures: Figures;
      computedAt: string;
      rulesVersion: string; }
```

`execute` flow:
1. `loaded = repo.loadCase(caseId)`; `profile = loaded.profile ?? { schemaVersion: 1 }`.
2. `verdict = evaluateEligibility(facts, profile, now())` — run first so the
   out-of-scope check (which depends only on `target.intendedVisa`) is honored
   even for an otherwise-incomplete case.
3. If `verdict.outOfScope` → return `{ status:'out_of_scope', reason:'intended
   visa is not Blue Card' }`. **No activity write** (mirrors `out_of_scope` tool
   semantics — a scope refusal, not an eligibility event).
4. `assessReadiness(facts)` → if not ready, return `{ status:'incomplete', missing }`.
5. Else `figures = summarizeFigures(facts, now())`; return `status:'assessed'` with
   engine codes + figures.
6. **Side effect (the `incomplete` and `assessed` paths only):**
   `repo.appendActivity({ caseId, userId, kind:'case.eligibility.checked',
   payload: { status, routes, blockers, missing } })`. No case-state write
   (rule 5 holds). PII rule: payload carries codes/paths only — no salary figure.

### 4.4 `lookup_anabin` (`src/lib/ai/tools/lookup_anabin.ts`)

Factory `makeLookupAnabinTool()` — no repo needed (reads the rules loader, which
caches in module scope). No `defaults` required.

```
Input:  { institution: string }
Output: { type: 'anabin_result', version: 1, data:
            | { found: false; query: string }
            | { found: true; status: 'H+'|'H+/-'|'H-'|'unknown';
                institution: string; verifiedByUser: boolean;
                anabinUrl: string | null; degrees: AnabinDegreeEntry[] } }
```

Wraps `getAnabinInstitutionByName(input.institution)`. `undefined` → `found:false`.
Read-only — no activity write (knowledge lookup, not a case event). The agent
persists any **conclusion** (e.g. setting `education.anabinStatus`) via
`update_case` in a separate step. `verifiedByUser:false` surfaces so an unverified
seed rating is never presented as authoritative.

### 4.5 Cache-breakpoint consolidation (`agent-turn.ts` + tools)

- Remove `providerOptions.anthropic.cacheControl` from all tool factories
  (`update_case`, `read_case`, `add_case_note`, `out_of_scope`, and the two new
  ones do not add it).
- Place a single `providerOptions: { anthropic: { cacheControl: { type:'ephemeral' } } }`
  on the **last** tool in registration order in `buildAgentTurn`'s `tools` map
  (or document the chosen single breakpoint location).
- Replace the existing NOTE in `agent-turn.ts` with the new invariant: "exactly
  one tool-block breakpoint; do not re-add per-tool breakpoints."

### 4.6 Renderers (`src/components/workspace/renderers/registry.tsx`)

- **`eligibility_result`** — the transparency card. Branches on `status`:
  - `assessed`: salary-vs-threshold lines ("Standard threshold €50,700 — €62,000
    on file ✓"; "Reduced threshold €45,934 — ✓"), then the **granted** routes
    (from `verdict.routes`) as friendly labels, then blockers/warnings. The
    threshold ✓/✗ marks reflect salary only; the granted-routes list is the
    authoritative "what you qualify for".
  - `incomplete`: "Need a couple more details before I can check: …" (maps
    `missing` paths to friendly labels).
  - `out_of_scope`: short note.
- **`anabin_result`** — institution + status badge; `found:false` → "Not in our
  Anabin database — needs ZAB individual assessment"; `found:true,
  status:'unknown'` → "Found; recognition not yet rated"; rated → status with a
  `verifiedByUser` indicator.
- Functional and readable; visual polish is 2B. Register both `type`s.

### 4.7 `v0.md` prompt

- Remove the "(Available from a later build step…)" caveats on `check_eligibility`
  and `lookup_anabin`.
- Add concise "when to call":
  - `check_eligibility` — run when employment + (education or IT-no-degree facts)
    are plausibly on file; it self-reports if more info is needed. Present the
    result by pointing the user at the card; never restate the numbers in prose.
  - `lookup_anabin` — call when a degree's recognition is in question; if status
    is unknown/not-found, explain the ZAB statement + consulate clarification path.
- `PROMPT_VERSION` stays `v0` (D7).

---

## 5. Testing (TDD)

Mock pattern per CLAUDE.md: `vi.mock('@/lib/db/client', () => ({ get db() { return
testHandle.db; } }))` (getter, no `schema` in factory). Engine tests pin `today`.

- **`assessReadiness`** (pure) — ready / not-ready across all branches incl.
  IT-no-degree shape; `missing` content.
- **`summarizeFigures`** (pure) — standard + reduced figures match the active
  threshold; `meets` true/false vs. salary; `meets` null + `salaryOnFile` null
  when salary absent; `legalBasis` carried from rules.
- **`check_eligibility.execute`** — `incomplete` / `assessed` / `out_of_scope`
  paths; figures present on `assessed`; activity row written with expected
  `kind` + payload (codes only, no salary); `now` injection pins the date.
- **`lookup_anabin.execute`** — found-rated / found-unknown / not-found shapes.
- **`buildAgentTurn`** — registers **six** tools; exactly one tool carries a
  `cache_control` breakpoint.
- **Renderer registry** — dispatch for `eligibility_result` (all three statuses)
  + `anabin_result` (all three found-states); fallback unchanged.
- **Engine + persona suites** — unchanged and still green (proves the engine
  contract was preserved).

---

## 6. Verification gate (2A.2)

- [ ] `pnpm test` green (incl. unchanged engine + persona suites)
- [ ] `pnpm build` green
- [ ] `pnpm lint` clean
- [ ] `pnpm exec tsc --noEmit` clean
- [ ] Live smoke:
  - Feed Priya-strong facts → `check_eligibility` returns `assessed`/qualifies
    with a figures card showing salary vs. threshold.
  - Partial case (no salary) → `incomplete` card listing the missing fact.
  - Ask about an unseeded institution → `lookup_anabin` `found:false` card.
  - Ask about a seeded-but-unrated institution (e.g. IIT Bombay) → `found:true,
    status:'unknown'` card.
  - Confirm no 400 (cache-breakpoint) and the agent's prose contains no euro
    figures (numbers only in the card).

---

## 7. Files touched

**New:**
- `src/lib/rules/eligibility-readiness.ts`
- `src/lib/rules/eligibility-figures.ts`
- `src/lib/ai/tools/check_eligibility.ts`
- `src/lib/ai/tools/lookup_anabin.ts`
- tests for each of the above + renderer tests for the two new card types.

**Modified:**
- `src/lib/rules/eligibility.ts` — export `activeThreshold` (currently a private
  helper; no behavior change) so `summarizeFigures` reads the same threshold.
- `src/lib/ai/chat/agent-turn.ts` — register the two tools; consolidate to one
  cache breakpoint (on the last registered tool); replace the NOTE.
- `src/lib/ai/tools/{update_case,read_case,add_case_note,out_of_scope}.ts` —
  remove per-tool `providerOptions` (moved to the single tool-block breakpoint).
- `tests/ai/{update_case,read_case,add_case_note,out_of_scope}.test.ts` — drop
  the per-tool `providerOptions.anthropic` assertions (now an `agent-turn` test).
- `src/components/workspace/renderers/registry.tsx` — add two renderers.
- `prompts/agent/v0.md` — un-caveat the two tools; add "when to call".

---

## 8. Risks

- **Figures/verdict drift or over-claim** (D3). Mitigation: figures are
  threshold-centric (salary vs. the two thresholds) and read the engine's
  exported `activeThreshold`; the card's "what you qualify for" is the engine's
  `verdict.routes`, never re-derived from salary.
- **Cache consolidation breaks existing tool tests.** Four tool tests assert
  per-tool `providerOptions.anthropic`. Mitigation: those assertions are removed
  and replaced by a single `agent-turn` test asserting exactly one breakpoint
  across the tool set (Task 6).
- **Readiness predicate too strict/loose.** Mitigation: it's pure and unit-tested;
  all four personas asserted to `assess`; refine in planning if a persona slips
  to `incomplete`.
- **Cache consolidation regresses caching.** Mitigation: `buildAgentTurn` test
  asserts exactly one breakpoint; live smoke confirms no 400.
- **Engine contract accidentally changed** while extracting the constant.
  Mitigation: engine + persona suites must stay green untouched (gate item).
