# Journey Tracker Dashboard — Design

**Date:** 2026-05-31
**Status:** Designed, pending implementation plan
**Phase context:** Slots alongside Phase 2B ("workspace comes alive"). Builds on 2A.1 (agent brain, merged) and the eligibility engine. Does **not** depend on 2A.2 tools being registered.

---

## 1. Problem

Today a user lands in the workspace and faces a chat panel plus a near-empty "case file" card. They must actively volunteer information without knowing what the process is, what is expected of them, or how far along they are. They are blind to the journey.

We want the **center column to be a journey tracker**: all steps needed to produce a complete Blue Card application package, broken into phases with per-phase progress (e.g. "Eligibility 6/8", "Documents 1/9"). Users see the whole process on one screen, click a phase to expand its requirements / sources / their answers / uploads, and either chat about anything they see or upload documents in place. As they work, the tracker updates.

The product principle this serves: **the case is the spine, the chat is one panel.** The tracker makes the case legible.

---

## 2. Scope

**In scope:** A read-only journey tracker rendered in the center column, projecting existing case state into a phased, progress-oriented view with dual provenance (requirement citations + answer provenance).

**Journey covered:** The application-package journey only — eligibility → documents → drafts → VIDEX/submission package. It ends at "ready to submit at the Bengaluru consulate." Post-arrival settling (Anmeldung, residence-permit conversion, etc.) is explicitly **out of scope** (matches North Star + PRD §7).

**Out of scope:** Appointment booking, the upload backend (Phase 2B), draft generation (Phase 2B), VIDEX generation (Phase 2B+), any new write path, any auth change.

---

## 3. Key decisions (resolved during brainstorming)

1. **Layout = Option A.** Drop case-navigation from a dedicated center view; the center column *is* the tracker (phase cards). Chat stays pinned right, always visible (PRD: "chat is never hidden behind a button"). The **left sidebar stays** as portal chrome (settings, sign in/out) **plus** section drill-down links. Tracker and sidebar are **two projections of one case state** — the tracker summarizes the journey; the sidebar links to detailed section views.
2. **Approach 1 — config-driven journey manifest.** A new `config/rules/journey.yaml` declares phases and per-phase "complete" rules. A pure `computeJourneyProgress(...)` reads manifest + case state and returns typed `JourneyProgress`. Mirrors the existing `evaluateEligibility` + rules-loader pattern. Honors rule 7 (no hardcoded requirements in code) and rule 3 (server-authoritative).
3. **4 phases, not 5.** Identity (Profile) is **folded into the Documents phase** — identity facts are extracted from the passport upload and confirmed in place, then consumed by VIDEX. The `Profile` DB table is untouched (it is user-level, reused across cases, load-bearing for anon→authed merge). The user never fills a standalone identity form.
4. **Family = Option A (one account, family as case data).** The primary applicant is the only *user*. Spouse + children are **mini-profile** identity sub-entities inside `CaseFacts.family`, each carrying the identity fields their own VIDEX/passport documents require. The document composer emits one document set per member; at output each member produces their own visa sub-package. No auth change, single case, one thread. Family members' address **defaults to the primary's, overridable**. *(Slice note — see §5.1: the tracker's first slice lands **composition only**; the full per-member identity fields described here are the eventual target, deferred to the upload-backend slice.)*
5. **Conditional documents.** `documents.yaml` items gain an optional `condition` so the document count is accurate (ZAB only when Anabin unknown/unrecognized; distance-learning clarification only for distance/online study; marriage/birth certs only when spouse/children present).
6. **Locked phases shown.** All 4 phases render from day one. Drafts and VIDEX/package show greyed "coming soon" until their features ship (Phase 2B+), so the user sees the whole path and the finish line.
7. **Dual provenance (trust layer).** Every step surfaces two independent provenance lines — **requirement provenance** ("says who", resolved from authoritative YAML) and **answer provenance** ("we didn't invent your data", read from rule-9 fact metadata). Compact line by default, expandable to full detail.
8. **Citations reference existing config, resolved at compute time.** `journey.yaml` steps carry a `cite` pointer; `resolveCitation()` pulls `legalBasis`/`sources`/`lastVerified` from the target rule's YAML. No citation data is duplicated into the manifest (avoids drift, honors rule 7 single-source-of-truth).

---

## 4. Architecture & data flow

The tracker is a **read-only projection** over state the system already owns. It introduces **no new writes** — rule 5 (single-threaded writes via `update_case`) and rule 3 (server-authoritative) are unaffected.

```
config/rules/journey.yaml ──┐
config/rules/*.yaml (cite) ──┤
                             ├──► computeJourneyProgress()  ──► JourneyProgress
CaseFacts ───────────────────┤    (pure, src/lib/journey/)        │
Profile ─────────────────────┤                                    │
documents.yaml ──────────────┤                                    ▼
EligibilityVerdict ──────────┘                         RSC: app/case/[id]/page.tsx
                                                                   │
                                                                   ▼
                                                        <Tracker> (center column)
```

**Render path:** `app/case/[id]/page.tsx` already loads `caseFacts` + messages. It additionally loads `profile`, computes the `EligibilityVerdict` (engine exists), reads `journey.yaml` + `documents.yaml` via loaders, and calls `computeJourneyProgress(...)` → typed `JourneyProgress`. That is passed to `<Tracker>` in the center column (replacing `<Overview>`).

**Refresh:** Re-derives on page re-render. The existing mechanism already covers it — `router.refresh()` fires once per turn from `useChat.onFinish` when an `update_case` tool part is present (pinned decision). When the agent updates a fact, the tracker updates. No new refresh wiring.

**Purity:** `computeJourneyProgress(caseFacts, profile, documents, verdict, today)` is pure — same shape as `evaluateEligibility(caseFacts, profile, today)`. Per-persona progress becomes a deterministic unit test at ~0 tokens (the 2C testing strategy).

---

## 5. Data model

### 5.1 `CaseFacts.family` extension (`src/lib/case/schema.ts`)

> **Scope amendment (2026-06-01, brainstorming):** this slice lands **family composition only** — just enough signal to count per-member document sets and conditional family docs honestly. The full per-member **identity fields** (`fullName`, `dateOfBirth`, `placeOfBirth`, `nationality`, `passportNumber`, `passportExpiry`, `address`) are **deferred to the upload-backend slice** that actually consumes them (per-member VIDEX + passport documents, both in locked/deferred phases). Rationale: the tracker's first slice reads composition, not identity; landing ~12 unused identity leaves now would bloat the schema-derived path catalog (the 2A.2 live-smoke risk surface) for fields nothing reads yet. YAGNI. The deferred shape below is the eventual target, not this slice's work.

**This slice — composition only:**

```
family: {
  maritalStatus: Field<MaritalStatus>          // existing
  spousePresent?: Field<boolean>                 // accompanying spouse? drives spouse doc set + marriage cert
  childrenCount?: Field<number>                  // # accompanying children → per-child doc sets + birth certs
}
```

- Two scalar `Field` leaves — the minimal honest composition signal. `spousePresent` is distinct from `maritalStatus` ("married" ≠ "spouse accompanying the application"). The Documents phase reads exactly these two.
- Drives the Documents-phase per-member expansion (§6.2) and the marriage/birth-certificate `condition`s (§5.2) entirely from composition.
- Reuses the existing `FieldSchema` helper → provenance (rule 9) comes for free. Adds exactly **2 leaves** to the path catalog (both scalar — no enum, no nested recursion).
- **Why not the array now:** `listLeafPaths` does not recurse into `ArrayField` element schemas, but it *does* recurse into a plain nested object-of-`Field`s — so the deferred `spouse: MemberIdentity` (a nested object) would add ~7 catalog leaves the moment it lands. Scalars keep the catalog honest. When identity lands, `childrenCount` is superseded by `children: ArrayField<MemberIdentity>` (`count = children.value.length`); a clean, documented swap.

**Deferred to the upload-backend slice — full per-member identity (the eventual §5.1 target):**

```
family: {
  spouse?: MemberIdentity                        // present iff accompanying
  children?: ArrayField<MemberIdentity>
}

MemberIdentity = {
  fullName, dateOfBirth, placeOfBirth, nationality,
  passportNumber, passportExpiry: Field<…>      // per-member VIDEX + passport docs
  address?: Field<CurrentAddressValue>            // omitted ⇒ inherits primary's address
}
```

- Will reuse `FieldSchema` / `ArrayFieldSchema` / `CurrentAddressValue` → provenance + address shape for free.
- `update_case` writes arbitrary paths → **no tool change** (true for both slices).
- **Eligibility engine untouched** (both slices): family does not gate the primary's verdict (confirmed against `family-reunification.yaml` — spouse/children affect documents only, not the salary/degree/route logic).

### 5.2 `documents.yaml` — optional `condition`

```yaml
- id: zab_statement
  condition: { path: 'education.anabinStatus', in: ['unknown', 'H-'] }
- id: distance_learning_clarification
  condition: { path: 'education.modeOfStudy', in: ['distance', 'online'] }
```

Family items already scope per spouse/child; with structured family, the composer emits one birth-certificate step per child and one spouse set when a spouse is present. The rules loader (`src/lib/rules/loader.ts`) is extended to parse `condition` (Zod).

### 5.3 New journey types (`src/lib/journey/types.ts`)

```
JourneyProgress = { phases: PhaseProgress[]; overallPct: number }

PhaseProgress = {
  id; label;
  status: 'done' | 'active' | 'todo' | 'locked';
  completed: number; total: number;
  steps: StepProgress[];          // empty for locked phases
}

StepProgress = {
  id; label;
  state: 'complete' | 'incomplete';
  value?: string;                  // human-rendered current answer
  group?: string;                  // e.g. member grouping for documents
  requirementCitation?: RequirementCitation;   // "says who"
  answerProvenance?: AnswerProvenance;          // "we didn't invent it"
  action?: { kind: 'upload'; enabled: boolean } // upload button, disabled until 2B
}

RequirementCitation = { explainer: string; legalBasis?: string; sourceUrl: string; lastVerified: string }
AnswerProvenance    = { label: string; updatedAt: string }   // derived from rule-9 source/updatedAt
```

All Zod-derived.

### 5.4 `config/rules/journey.yaml` (new)

Declares the 4 phases, order, locked flags, per-phase complete-rule, and per-step `cite` pointers. Sketch:

```yaml
schemaVersion: 1
phases:
  - id: eligibility
    label: Eligibility & route
    headline: verdict           # render EligibilityVerdict as the phase headline
    steps:                       # the 8 steps (see §6.1); each maps to CaseFacts paths + a cite
      - id: job_title
        paths: ['employment.jobTitle', 'employment.iscoCode']
        cite: shortage-occupations          # resolves ISCO description + source
      - id: salary
        paths: ['employment.annualGrossSalaryEur']
        cite: blue-card.thresholds          # resolves €amount + §18g + source + date
      # …6 more
  - id: documents
    label: Documents
    source: documents.yaml       # dynamic count after route + condition + family filter
  - id: drafts
    label: Drafts
    locked: true
  - id: package
    label: VIDEX form + submission package
    locked: true
```

---

## 6. Phase definitions

### 6.1 Phase 1 · Eligibility & route — 8 steps

Headline = computed `EligibilityVerdict` (route / blockers / warnings). Steps:

| # | Step (user-facing) | CaseFacts path(s) | cite |
|---|---|---|---|
| 1 | Target visa & consulate | `target.intendedVisa`, `target.targetConsulate` | consulates |
| 2 | Employer & location | `employment.employerName`, `employment.employerCity` | — |
| 3 | Job title & occupation code | `employment.jobTitle`, `employment.iscoCode` | shortage-occupations |
| 4 | Annual gross salary | `employment.annualGrossSalaryEur` | blue-card.thresholds |
| 5 | Contract type & start date | `employment.contractType`, `employment.contractStartDate` | blue-card.generalRequirements |
| 6 | Highest degree & field | `education.highestDegree`, `education.fieldOfStudy` | blue-card |
| 7 | Degree recognition (Anabin) | `education.anabinStatus`, `education.institution`, `education.completionYear` | blue-card / anabin |
| 8 | Prior work experience | `employment.priorExperienceYears` | blue-card.itNoDegreeRule |

A step is **complete** when all its mapped paths have a non-null `value`. The "8" is a curated grouping (employment fields grouped into "employer", "job", "salary", "contract"), chosen so the count reads intuitively — not a 1:1 of every CaseFacts leaf.

### 6.2 Phase 2 · Documents — dynamic count

Count = items applicable to **this** case after filtering by (a) route, (b) `condition`, (c) family composition. Each item already carries `label`, `details` (explainer), `sourceUrl`, `apostilleRequired` in `documents.yaml`. **Complete** = uploaded & confirmed (upload backend is 2B; until then items render with a disabled Upload action).

**Identity folds in here:** the passport item, on upload, yields `Profile` identity facts ("we read your name + passport no. — confirm"). No separate Profile phase.

**Grouped by family member:** "You (applicant)" / "Spouse" / "Child 1", "Child 2"…, since each member maps to a distinct visa sub-package. (This slice has composition only — §5.1 — so members are labelled by position, not name; the `{name}` form lights up once per-member identity lands with the upload-backend slice.)

### 6.3 Phase 3 · Drafts — locked (Phase 2B)

Cover letter · Employer declaration · CV. Rendered greyed "coming soon."

### 6.4 Phase 4 · VIDEX form + submission package — locked (Phase 2B+)

VIDEX completeness ("X of N fields") · assembled package (ZIP). Rendered greyed "coming soon."

---

## 7. Dual provenance (trust layer)

Every step surfaces two independent provenance lines. Both data sources already exist; surfacing them is a rendering job.

### 7.1 Requirement provenance — "says who"

Resolved by `resolveCitation(cite)` from authoritative YAML — never duplicated into the manifest:

- `blue-card.yaml` thresholds carry `legalBasis` (e.g. `§18g Abs. 1 S. 1 AufenthG`); the file has `sources: [...]` + `lastVerified`.
- `documents.yaml` items have `details` + `sourceUrl`; file has `lastVerified`.
- `shortage-occupations.yaml` maps ISCO codes (e.g. `2512`) to descriptions.

`resolveCitation` returns `{ explainer, legalBasis?, sourceUrl, lastVerified }`. Example renders:
- Salary: *"€50,700/yr (standard threshold) — §18g Abs. 1 AufenthG · make-it-in-germany.com · verified 2026-05-25."*
- ISCO: *"Software developers (ISCO-08 2512) — source: ISCO classification."*

### 7.2 Answer provenance — "we didn't invent your data"

Read from the fact leaf's existing rule-9 metadata (`source`, `updatedAt`, `sourceTurnId`). Mapped to human copy:

| `source` | Display |
|---|---|
| `user_stated` | "You told us in chat" |
| `document` | "Read from your {document} upload" |
| `user_corrected` | "You corrected this" |
| `inferred` | "Inferred — please confirm" |
| `system` | "System-computed" |

Renders e.g. *"You told us in chat · May 30."* Empty steps show "not provided yet."

### 7.3 Display

Compact one-liner by default (keeps ~25 rows scannable); click/hover expands to full explainer + official source link + last-verified date + answer provenance. Maximizes first-time credibility without visual overload.

---

## 8. Components & files

**New:**
- `config/rules/journey.yaml` — phase manifest (phases, order, locked flags, per-phase complete-rule, per-step `cite`).
- `src/lib/journey/types.ts` — `JourneyProgress`, `PhaseProgress`, `StepProgress`, `RequirementCitation`, `AnswerProvenance` (Zod-derived).
- `src/lib/journey/loader.ts` — reads + caches `journey.yaml` (mirrors `rules/loader.ts`, module-scope cache; restart dev after edits).
- `src/lib/journey/compute.ts` — pure `computeJourneyProgress(caseFacts, profile, documents, verdict, today)`; includes `condition` evaluator, per-member document expansion, `resolveCitation()`, and answer-provenance mapping.
- `src/components/workspace/Tracker.tsx` — center column: phase cards (done/active/todo/locked) + overall %; clicking a phase expands its steps inline with dual provenance.

**Changed:**
- `src/lib/case/schema.ts` — `family` mini-profile extension (§5.1).
- `config/rules/documents.yaml` — `condition` on conditional items.
- `src/lib/rules/loader.ts` — parse `condition` (Zod).
- `src/components/workspace/Layout.tsx` — center column renders `<Tracker>` instead of `<Overview>`; left `<Nav>` stays; grid columns unchanged.
- `src/app/case/[id]/page.tsx` — also load `profile`, compute `verdict` + `journeyProgress`, pass to `Layout`.

**Removed/superseded:**
- `src/components/workspace/Overview.tsx` — superseded by `Tracker.tsx` (preserve its empty-state copy).

**Untouched (stated for confidence):** auth, repository write paths, `update_case`, eligibility engine logic, Inngest, `Nav.tsx`.

---

## 9. Testing

- `computeJourneyProgress` is pure → per-persona unit tests assert exact phase counts and step states at ~0 tokens, every PR:
  - `priya-strong`: eligibility 8/8 + shortage-occupation route; documents = applicant set + spouse set + 1 child set; conditional docs (ZAB) absent (Anabin H+).
  - `vikram-edge-anabin`: eligibility blocked on `anabin_status_unknown`; ZAB document **present** via condition.
  - `arjun-it-no-degree`: IT-no-degree route; `priorExperienceYears` step decisive; degree steps reflect no-degree path.
  - `out-of-scope-asylum`: tracker reflects out-of-scope verdict in the eligibility headline.
- `resolveCitation` unit tests: each `cite` pointer resolves to the expected `{ legalBasis, sourceUrl, lastVerified }` from YAML; unknown pointer fails loudly.
- `condition` evaluator unit tests: each operator (`equals`/`in`) against representative case states.

---

## 10. Open items / future

- **Upload backend (Phase 2B):** Upload actions render disabled until the document-upload + extraction pipeline lands. Then identity auto-fill from passport (§6.2) wires through.
- **Drafts & VIDEX (Phase 2B+):** locked phases light up as those features ship.
- **Mobile:** PRD specifies stacked layout + chat bottom-sheet on mobile; this design assumes desktop 3-column. Mobile adaptation deferred (not regressed — current layout is already desktop-first).
- **Section drill-down views:** the left-sidebar links to detailed per-section views (Profile, Documents, …) are a separate 2B concern; this design only guarantees the tracker projection and that the sidebar remains as chrome + links.

---

## 11. Build sequencing (added 2026-06-01)

Bottom-up, data-layer first — every slice has its own verification gate; nothing renders against unproven data. Mirrors how the eligibility engine was built (pure + tested, then surfaced). The implementation plan expands each slice into tasks.

| # | Slice | Lands | Verified by |
|---|---|---|---|
| 1 | **Config + types foundation** | `config/rules/journey.yaml` (4-phase manifest, 8 eligibility steps, `cite` pointers) · `src/lib/journey/types.ts` (Zod) · `src/lib/journey/loader.ts` (module-scope cache, mirrors `rules/loader.ts`) · `condition` field added to `DocumentItem` in `src/lib/rules/types.ts` + parsed by `loader.ts` | Loader unit tests (manifest parses; unknown `cite` fails loudly); `condition` Zod round-trips |
| 2 | **Family composition schema** | The composition-only `CaseFacts.family` extension (amended §5.1) — `spousePresent` + minimal `children` | Schema test + **path-catalog test** (leaves enumerate; every `validateLeafPath` resolves) — the 2A.2 regression guard |
| 3 | **Pure `computeJourneyProgress`** | `src/lib/journey/compute.ts`: condition evaluator, per-member doc expansion, `resolveCitation()`, answer-provenance mapping → `JourneyProgress` | **Per-persona unit tests** (§9): priya 8/8 + no ZAB; vikram blocked + ZAB present; arjun IT-route; asylum out-of-scope. ~0 tokens (the 2C signal). Plus `resolveCitation` + `condition`-evaluator unit tests |
| 4 | **`<Tracker>` component** | `src/components/workspace/Tracker.tsx`: phase cards (done/active/todo/locked) + overall %, expand-to-steps, compact + expandable dual provenance | Renders against persona fixtures; visual check via `run` skill |
| 5 | **Wiring** | `page.tsx` also loads `profile`, computes `verdict` + `journeyProgress`; `Layout` swaps `<Overview>`→`<Tracker>` (preserve empty-state copy); `<Nav>` stays; grid unchanged | Full build/lint/tsc clean; live smoke in the real app |

Slices 1–3 are pure/server logic, provable at ~0 tokens before any UI exists. Once `computeJourneyProgress` is green against all four personas, the component (4) renders a proven data structure and wiring (5) is plumbing — the correctness-critical work is verified earliest and cheapest.

### Code-vs-spec reconciliation (verified 2026-06-01 against current `main`)

- `documents.yaml` family docs already live in a separate `familyItems: { spouse: [...], child: [...] }` block (`src/lib/rules/types.ts:251`), **not** inline `applicableTo`-tagged items. Per-member expansion (§6.2) iterates `familyItems` × composition, not a filter over one flat list.
- The `condition` field is added to the `DocumentItem` Zod object in `rules/types.ts`; `loader.ts` already validates `documents.yaml` through that schema, so parsing comes for free once the field exists.
- `evaluateEligibility(caseFacts, profile, today)`, `summarizeFigures(facts, today)`, `assessReadiness(facts)` exist with the signatures the tracker assumes. `page.tsx` does **not** currently load `profile` or compute a verdict — that wiring is genuinely new (slice 5).
