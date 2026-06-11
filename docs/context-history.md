# Relomate — Context History

Relocated out of `CLAUDE.md` to keep it lean. `AGENTS.md` and `CLAUDE.md` carry the
forward-looking **directives** (what not to redo, what must hold); this file carries the
**why** behind them, the **current architecture seams** (load-bearing contracts that are
area-reference, not every-session reading), and the record of resolved work — phase
write-ups, bug post-mortems, superseded decisions. Read the relevant section here when
you're about to touch that area; `CLAUDE.md`'s "Subsystem decisions" index points you to
the right section.

Multiple developers and multiple agentic tools work on Relomate. At the end of each coding
session, review the shared handover docs (`AGENTS.md`, `CLAUDE.md`, and this file) and
update them when phase state, architectural decisions, gotchas, verification notes, or
next-up work changed.

> Per-phase commit hashes and test counts also live in git history.

---

## Architecture seams (load-bearing contracts — do NOT redebate)

Pinned across 1B/2A; the constraints any change to the turn loop, persistence, Inngest wiring,
or caching must respect. Reference these before touching `agent-turn.ts`, the chat route,
`repository.ts`, or the Inngest emit path.

**Turn / persistence**
- Server mints `userMessageId`; never trust client-supplied ids.
- Two independent tx per turn (tool-side `update_case` + chat-side `appendChatTurn`). Chat-side failure = history loses a turn, case file still correct. Accepted; eval workflow (Phase 7) catches trends.
- `createCase` wraps cases + case_facts + threads in a single tx, returns `{ caseId, threadId }`. `loadCase` returns `threadId`. Exactly one thread per case in MVP.
- `appendChatTurn(input, db?)` is the single chat-persistence path; one tx per call. Requires `userId` (populates `messages.user_id`) — any new caller MUST pass it.

**Agent loop / model seam**
- **`buildAgentTurn({ model, repo, ... })`** (`src/lib/ai/chat/agent-turn.ts`) owns the `streamText` loop: composes `systemPrompt + "\n\n" + context.systemContext`, registers the tool set, sets `stopWhen: stepCountIs(MAX_AGENT_STEPS)` (=8) + ephemeral cache, runs `onFinish` (persist + Inngest emit). The route injects the real Anthropic model and keeps only HTTP concerns. Two test seams: `vi.mock('ai')` capturing `streamText` args (L2a `agent-turn-replay.test.ts`, `chat.test.ts` — no real loop) and `makeScriptedModel` driving the real loop (L2b).
- `buildAgentContext` returns `{ systemContext }` (full `CaseFacts` JSON + section-presence summary); `buildAgentTurn` composes `system = v0.md + "\n\n" + systemContext`. (Async signature kept for future awaits.)
- **Context injects FULL `CaseFacts`; `read_case` stays minimal** (targeted section/path/provenance the summary abbreviates — agent uses it sparingly).
- **`MAX_AGENT_STEPS = 8`** (was 5). A turn can fan out `update_case` + `lookup_anabin`, recover via `read_case`, run `check_eligibility`, then reply. Don't lower without re-checking the multi-tool recovery path.

**Inngest**
- Inngest emit lives in `buildAgentTurn`'s `onFinish` (best-effort), not in the tool or the route. Repository stays Inngest-free.
- Event payload (`case.facts.updated`) is `{ caseId, paths, sourceTurnId }` — `caseId` MUST travel in the event (no other carrier at emit time; `CaseFactsUpdatedEvent` in `inngest/client.ts` types all three). The **handler** writes an `activity_log` row with `caseId` in the `case_id` column and `{ paths, sourceTurnId }` in the JSON `payload`. Don't conflate the two. `kind: 'inngest.echo'` for the trivial logger.
- `onFinish` mapping: aggregate `event.steps.flatMap((s) => s.toolResults)` (NOT top-level — last-step-only, see the AI SDK post-mortem), filter by `toolName === 'update_case'`, read `result.output.data.updatedPaths`. Variables: `allToolResults` / `updateResults` / `result`.

**Caching / refresh / model / prompt**
- Prompt cache: system + tool only. Per-message / per-context caching deferred.
- `router.refresh()` fires once per turn from `useChat.onFinish`, gated on whether the assistant message contains an `update_case` tool part. `messageContainsUpdateCase` only checks `tool-update_case*` parts.
- Anthropic model: **`claude-sonnet-4-6`** pinned in `src/lib/ai/provider.ts` (`MODEL_ID`). Don't restore `-4-7` — not a real model (`not_found_error`).
- Prompt: `prompts/agent/v0.md`, `PROMPT_VERSION = 'v0'` covers the current chat tool catalog (`update_case`/`read_case`/`add_case_note`/`out_of_scope`/`check_eligibility`/`request_document_upload`/`draft_cover_letter`/`draft_employer_letter`/`draft_cv`/`lookup_anabin`). Generated draft prompts have their own per-type versions. Reserve a `PROMPT_VERSION` bump for the next generational rewrite.

**Tools / renderer / layout**
- **`add_case_note` → `activity_log` `kind:'case.note.added'`**; **`out_of_scope` → `kind:'case.out_of_scope'`**, via `repo.appendActivity(...)`. No `notes` table. Neither touches case state (rule 5).
- **`out_of_scope` does NOT set the eligibility `outOfScope` flag** (the tool = "agent declines a conversational request"; the flag = "engine determined the case is unassessable", set only by `evaluateEligibility`).
- **Renderer registry** (`src/components/workspace/renderers/registry.tsx`): `resolveRenderer(type)` → React renderer, `FallbackResult` for unknown. Dispatches on `type` ONLY; `version` ignored while all outputs are v1 (key on `${type}@${version}` when a v2 ships). `ChatPanel` reads the result off `part.output` (`if (!out?.type) return null`).
- **Tool conventions:** rich docstring-style descriptions; single purpose; no state mutation outside `update_case`; long-running tools dispatch Inngest and return job ids (agent doesn't await). `update_case` output shape `{type:'update_case_result',version:1,data}`; `applyUpdate` activity row is one-per-call `{kind:'case.facts.updated',paths,source,sourceTurnId,contradictions}`. Contradictions are path-local, surfaced not blocking (both writes persist). Valid `update_case` paths come from the schema-derived catalog (`listLeafPaths`/`formatLeafPathCatalog` in `src/lib/case/paths.ts`) injected in both `buildAgentContext` and the tool description — NOT a hand-list (see the path-catalog post-mortem).
- **`check_eligibility` / `lookup_anabin`:** `check_eligibility(repo,{defaultCaseId,defaultUserId,now?})` runs engine FIRST (out_of_scope > incomplete), then `assessReadiness`, then `summarizeFigures`; returns `{type:'eligibility_result',version:1,data}`; logs `case.eligibility.checked` on incomplete+assessed only (codes/paths only — NO salary). `lookup_anabin()` — read-only; `found:false` (not seeded) vs `found:true,status:'unknown'` (seeded, unrated).
- **`lookup_anabin` MUST stay last in the `tools` object** — single `cache_control` breakpoint (see the breakpoint post-mortem). Every new tool registers BEFORE it.
- CSS Grid layout columns hardcoded `220px_1fr_360px` in `Layout.tsx` (sidebar / tracker / chat — Option-A).

**Phase-2 strategy**
- Phase 2 sliced 2A.1 / 2A.2 / 2B / 2C to keep each session well below 1M tokens. `simulate_what_if` folded into 2A.2 (YAGNI; not on the happy path).
- **Persona testing = layered (strategy A).** Deterministic core (pure `evaluateEligibility` + tool-unit + scripted-sequence→end-state) at ~0 tokens. Shipped L1+2a (`harness.ts`, `case-file.test.ts`, `agent-turn-replay.test.ts`) + L2b (real `MockLanguageModelV3` through the live loop — `mock-stream.ts`, `agent-turn-loop.test.ts`). L3 (live LLM + user-simulator) + CI live run deferred.
- `ai@6` ships `MockLanguageModelV3` in `ai/test` with NO `msw` dep — `makeScriptedModel(steps)` (`tests/_personas/mock-stream.ts`) wraps it and assigns to `LanguageModel` with no cast.

---

## Resolved bug post-mortems

These are the full stories behind the terse "don't redo" lines in CLAUDE.md → Stack gotchas.

### AI SDK: `ai` aligned to `^6` (resolved 2026-05-30, 2A.1 live smoke)

Previously the repo pinned `ai@5` while `@ai-sdk/react@3` transitively bundled `ai@6`;
`@ai-sdk/anthropic@3.0.80` returns a `LanguageModelV3` that `ai@5`'s `streamText` rejects
at **runtime** (`AI_UnsupportedModelVersionError: v3`) — every `/api/chat` call 500'd, and
the `as unknown as LanguageModel` cast hid it from `tsc`. Fix: bump `ai` to `^6` (its
`LanguageModel` union includes V3), which dedupes onto the `6.0.191` react already used;
both `as unknown` casts (model in route, transport in ChatPanel) removed. **Caught only by
the live smoke — all unit tests mock `streamText` and never hit the real provider→SDK
handshake.** Don't re-add the casts or re-pin `ai@5`.

### Anthropic `cache_control` breakpoints (resolved 2A.2, `c466a0e`/`cdcf40c`)

Anthropic allows max 4 `cache_control` breakpoints. The per-tool breakpoints were
consolidated to a SINGLE breakpoint on `lookup_anabin` (the last-registered tool — a
breakpoint there caches the whole static-tools prefix). The other tools carry NO
`providerOptions`. Do NOT re-add per-tool breakpoints, and do NOT add a top-level
`streamText` `providerOptions.anthropic.cacheControl` (the system string embeds per-turn
case context → near-certain miss + would be a 2nd breakpoint). `lookup_anabin` MUST stay
last in the `tools` object. The `agent-turn` test asserts exactly-one breakpoint (count,
not position).

### `onFinish` aggregation (fixed PR #5, 2026-06-02; surfaced by the L2b real-loop test)

`onFinish`'s top-level `toolCalls`/`toolResults` are the LAST STEP only
(`OnFinishEvent = StepResult & { steps }`, `index.d.ts`). A turn that calls a tool then
replies with text in a later step has an empty last step. Reading top-level dropped the
structured `tool_calls` rows from history AND skipped the `case.facts.updated` emit even
though facts were written. Fix: `buildAgentTurn.onFinish` aggregates
`event.steps.flatMap((s) => s.toolResults)` (and `.toolCalls`), filters by
`toolName === 'update_case'`, reads `result.output.data.updatedPaths`. Variables:
`allToolResults` / `updateResults` / `result`. `event.text`/`event.content` stay
last-step-only **by design** (we persist the final reply; `messages.parts` is therefore
last-step content — structured tool data lives in the `tool_calls` table).
Synthesized-event fixtures (`synthesizeTurnEvent`, `chat.test.ts`) MUST populate
`event.steps`, not just top-level fields.

### `require('@/...')` returns `{}` (root-caused in 1B-3)

The `@` alias is a Vite/Turbopack/tsc resolver applied to **static `import` statements at
compile time**. CJS `require()` calls go straight to Node's resolver, which has no
knowledge of the alias and returns `{}`. Bit us in `repository.ts` / `persistence.ts`
`getDefaultDb()` — the bare-call path crashed RSC at runtime even though every test passed
(tests pass `db` explicitly, never hitting the lazy path). Fix is always static
`import { db as defaultDb } from '@/lib/db/client'`. If the *reason* for the lazy import is
to defer env validation, register `tests/_setup/env.ts` in `setupFiles` so eager
validation just succeeds — that's the working pattern.

### `EMAXPOOLSREACHED` on a full-suite run is INFRA, not a code bug

Each test schema baked a distinct `search_path` into its connection URL, and the Supabase
pooler (Supavisor) allocates one pool per distinct search_path. The default per-core file
parallelism spins up ~15 schemas at once; repeated full-suite runs in one session compound
it past the pooler's pool-count limit, and DB-touching suites fail with
`error: (EMAXPOOLSREACHED) max pools count reached` (Postgres `FATAL XX000`) — only the DB
tests fail; pure-logic tests stay green. Fix: re-run with
`pnpm exec vitest run --no-file-parallelism` (serial, ~32s, reliably green). Don't chase it
as a regression.

### Anon→authed merge tombstones, never deletes, the anon user

Branch (c) of `promoteToAuthed` (anon signs in with an email that already has an account)
re-points `cases` + transfers/drops the profile, then leaves the anon
`users`/`organizations` rows in place as dead tombstones (and sets `users.merged_into`).
It does NOT delete them. Reason: `activity_log` + `profile_changes` rows written under the
anon id during the session reference `users.id` with `ON DELETE no action`; deleting throws
an FK violation (rolls back the whole merge → sign-in 500s), and re-pointing those audit
rows would violate the append-only rule (10). The merge pointer is recoverable from the
`auth.merged_anon` log row (`{from, into}`). Do NOT re-add the
`delete(users)`/`delete(organizations)` calls. Regression test:
`tests/auth/merge.test.ts` "preserves anon-owned audit rows".

### `update_case` path catalog — 2A.2 live-smoke root cause (`c466a0e`)

`update_case.updates` is an open `z.record(z.string(), z.unknown())`, so the model gets no
key schema and WILL guess invalid paths (`education.level`, `employment.jobCity`) unless
told the real ones. Without the catalog, errored path-guesses triggered retries that
exhausted the step budget → dead-end no-answer turn (this is also why `MAX_AGENT_STEPS`
went 5→8). `listLeafPaths()` / `formatLeafPathCatalog()` in `src/lib/case/paths.ts`
enumerate the leaves (with enum options) by walking `ProfileSchema` + `CaseFactsSchema` —
single source of truth, can't drift from `validateLeafPath` (a test asserts every
enumerated path resolves). The catalog is injected in BOTH `buildAgentContext` (per-turn)
and the `update_case` description. Add a `CaseFacts`/`Profile` leaf → it appears
automatically, no prompt edit needed.

### Anthropic model ID — `-4-6`, not `-4-7` (corrected 2026-05-30)

The prior pin `claude-sonnet-4-7` is NOT a real Anthropic model — the API returns
`not_found_error`. Verified `claude-sonnet-4-6` against `/v1/models`. Pinned in
`src/lib/ai/provider.ts` (constant `MODEL_ID`). Don't restore `-4-7`.

---

## Phase write-ups (resolved)

### Firm-first pivot decision (2026-06-08)

Relomate's product direction changed from applicant-first self-service to a firm-first immigration
operating system for Germany Blue Card cases. The MVP visa remains Germany Blue Card, but the
source/residence scope expands from **India/Bengaluru** to **India/Bengaluru + Canada/Toronto**.
The decision record is `docs/strategy/firm-first-pivot.md`.

The existing automation core carries forward: deterministic eligibility, typed tools, provenance,
document extraction, approvals, draft artifacts, Inngest workflows, and the journey tracker. The
product owner changes: cases become organization-owned, applicants become participants, and
consultants/reviewers/ops managers get first-class workflows.

Architecture decision from the Harvey/Legora comparison: adopt the professional product primitives
(firm console, review inbox, playbooks, workflows, portal, monitors/governance) but **do not** adopt
multi-agent orchestration, LangGraph, LangChain, or LlamaIndex as core architecture. Relomate keeps
single-agent typed tools, deterministic rules, explicit approvals, one authoritative case-fact write
path, and Inngest for durable workflows.

Canada/Toronto official facts verified from `canada.diplo.de` on 2026-06-08:

- Blue Card (EU) appears among national/residence visa categories available for online application.
- People legally residing in Canada for over 6 months can apply at the German Consulate General in
  Toronto.
- Long-term visa applications must be submitted at the Consulate General in Toronto.
- The EU Blue Card page says all Canadian residents need to apply in person at Toronto.
- Canadian citizens may apply for a residence permit after arrival without a prior visa, but may
  choose a pre-travel visa if they want employment authorized from the first day of visa validity.

Canada/Toronto checklist details are **not** user-verified yet. Future config work must verify the
current checklist, fees, appointment path, document copies, proof of Canadian residence, mail-service
requirements, health insurance wording, translations/legalization, and caveats from official sources,
then mark config `verifiedByUser: false` until the user confirms.

### 4C-F firm foundation pivot — RBAC + organization-owned cases (2026-06-09, current branch)

The first firm-foundation slice establishes ownership and access-control primitives without removing
the applicant-compatible flow.

Implemented:

- `organization_members` table with role/status membership rows.
- `cases.organization_id` as the ownership key.
- `cases.primary_applicant_user_id`, `assigned_consultant_id`, `reviewer_id`, `stage`, `priority`,
  `target_submission_date`, `submitted_at`, and `closed_at`.
- Migration `drizzle/0006_lumpy_klaw.sql` backfills existing users as `firm_admin` members and
  backfills existing cases from `users.organization_id` + `cases.user_id`.
- `src/lib/auth/authorization.ts` centralizes case access decisions.
- Case page, chat route, document upload/poll/finalize routes, and document/draft review pages now
  call the central authorization helper instead of doing direct route-level `case.userId` or
  `document.userId` checks.

Deliberate compatibility decision: keep legacy `cases.user_id` for profile/applicant compatibility
and existing `applyUpdate` profile writes. Do not treat it as the route ownership key. Future slices
should keep migrating access decisions to authorization/participants rather than adding new direct
`case.userId === userId` checks.

Known follow-up: document/draft review action cores still contain legacy subject-owner checks. That is
acceptable for this slice because current applicant-compatible review remains intact, but 4C-F-3
must convert those cores to role-aware approval semantics so firm reviewers can act through the review
inbox.

### 4C-F firm foundation pivot — Case participants + visibility primitives (2026-06-09, current branch)

The second firm-foundation slice adds per-case participant records so access can diverge from broad
organization membership.

Implemented:

- `case_participants` table with participant role, linked `user_id` or invited email, invitation
  status, visibility, relation metadata, and timestamps.
- Migration `drizzle/0007_special_zarek.sql` backfills existing cases with an active primary
  applicant participant.
- `src/lib/case/visibility.ts` defines `internal`, `client_visible`, and `shared`.
- `src/lib/case/participant-roles.ts` defines participant roles without importing DB code.
- `src/lib/case/participants.ts` provides list/get/upsert repository helpers.
- `makeRepository().createCase()` now seeds the primary applicant participant with
  `relation.kind = 'primary_applicant'`.
- `getCaseAuthorization()` includes active participant roles. Consultant/reviewer/ops participants
  can access firm case actions, applicant participants can read/chat/upload, and employer contacts
  can read/upload but not chat or review.

Compatibility decision: organization membership remains sufficient for firm roles in this slice;
case participants add finer-grained access for per-case reviewers, applicants, and employer contacts.
The applicant portal split must still filter content by visibility and must not equate
`client_visible` with internal access.

### 4C-F firm foundation pivot — Review inbox + role-aware approvals (2026-06-09, current branch)

The third firm-foundation slice turns the existing approval rows into role-aware work items while
preserving the existing applicant confirmation workflow.

Implemented:

- `approvals` now carries `assignee_user_id`, `required_role`, `due_at`, `escalation_status`, and
  `visibility`.
- Migration `drizzle/0008_graceful_gargoyle.sql` backfills document approvals as
  applicant-facing `client_visible` confirmations and draft approvals as internal consultant review
  work.
- `makeApprovalRepository().listReviewInbox()` returns pending approvals scoped to an organization,
  with optional assignee and required-role filters.
- `src/lib/approvals/authorization.ts` centralizes approval-resolution permission checks on top of
  `getCaseAuthorization()`.
- Document confirmation/rejection cores now require a pending applicant approval and use approval
  authorization instead of direct document-owner checks.
- Draft approval/rejection cores now require a pending firm-review approval and no longer require
  `draft.user_id === acting_user_id`, so consultant/reviewer participants can approve firm-ready
  drafts while applicant participants cannot.

Verification:

- `pnpm exec tsc --noEmit`
- `node --env-file=.env.local node_modules/vitest/vitest.mjs run --no-file-parallelism tests/approvals tests/documents tests/drafting tests/api`

Known follow-up: this adds repository-level review inbox data, not the full firm console UI. 4C-F-5
must still build the actual inbox/console surfaces.

### 4C-F firm foundation pivot — Real tasks foundation (2026-06-10, merged to main PR #21)

The fourth slice replaces tracker-only implied work with mutable task records.

Implemented:

- `tasks` + append-only `task_changes` tables (migration `drizzle/0009_odd_steel_serpent.sql`).
  Task fields: assignee, due date, status, source, visibility, blocking, related subject.
- `src/lib/tasks/`: `types.ts` (status/source/role/subject enums; `done`/`cancelled` terminal),
  `repository.ts` (`makeTaskRepository`: create/getById/listByCase/update + `reconcileSystemTasks`),
  `generate.ts` (pure `deriveSystemTasks`: pending approvals → review/confirm, failed docs →
  re-upload, failed drafts → regenerate; sources disjoint, no double-count), `view-model.ts`
  (pure `selectTopTasks`, `now`-parameterized, audience+assignee filtered, blocking→overdue→due-date
  ordering), `service.ts` (`reconcileCaseTasks` integration seam).
- System tasks dedupe via a stable `generationKey` + partial unique index on non-terminal status
  (same trick as the approvals pending-subject index); reconcile is idempotent (no-op on steady
  state) and auto-resolves cleared triggers.
- Rule 7: `overdue` is a pure `now > dueAt`; no `escalationStatus`-style thresholds in code.

Verification: `pnpm exec tsc --noEmit` + serial vitest on `tests/tasks tests/journey` (47 passing).

Known follow-up: manual-task API/server actions and an Inngest SLA worker are deferred.

### 4C-F firm foundation pivot — Firm console + applicant portal split (2026-06-10, merged to main PR #22)

The fifth slice surfaces the firm console and the applicant portal as **distinct routes**, with the
access boundary decided by pure functions (chosen over a role-adaptive single URL so the boundary
is testable as redirects, not rendered content).

Implemented:

- `/console` (firm operators only): `assignedToMe` / `unassigned` / `blockedOrOverdue` case buckets.
  Pure `bucketizeConsoleCases` (`src/lib/console/view-model.ts`, `now`-parameterized); `loadConsole`
  is the thin DB seam that folds per-case open-task signals (blocking present, earliest due) in
  memory to avoid N+1.
- `/portal/[id]` (applicants): client-visible top tasks only — the `selectTopTasks` `audience:'client'`
  filter is what keeps internal work off the surface. `loadPortal` reconciles system tasks first.
- `/case/[id]` stays the internal consultant workspace, unchanged except a surface guard.
- **Access boundary: `src/lib/auth/surface-access.ts`** — pure `caseSurface(auth)→'firm'|'client'|
  'none'` and `canAccessConsole(role)`. Org firm role OR per-case firm participant seat → `firm`;
  any other access → `client`; no access → `none`. Internal routes redirect `client` viewers to
  `/portal/[id]`; the portal redirects `firm` viewers to `/case/[id]`.
- New repo query: `Repository.listByOrganization(orgId)` (recency from `createdAt` — `cases` has no
  `updatedAt`).

Gotchas:

- **Anon users are `firm_admin` of a one-person `individual_anon` org**, so they resolve to the
  `firm` surface and keep the full workspace; only a *pure* applicant (applicant participant, no firm
  role) gets the portal. This is what keeps the existing case page usable through the split.
- **Malformed (non-UUID) caseId 500'd** because `getCaseAuthorization` runs `eq(cases.id, id)` and
  Postgres throws at the uuid cast. The portal page wraps the lookup and redirects to `/` on failure
  (matching the case page's notFound-on-bad-id). Found via live smoke; fix in commit `451e3a8`.

Verification: `pnpm exec tsc --noEmit` + serial vitest on `tests/auth/surface-access* tests/console
tests/auth/authorization.test.ts tests/case/repository.test.ts tests/tasks tests/journey` (94
passing) + **live UI smoke** (firm→workspace/console, applicant→portal with both internal routes
redirecting, outsider/cross-org/unauth all bounced). Full `pnpm build` is blocked locally by missing
R2 prod-env creds (pre-existing env gotcha, unrelated).

Known follow-up: portal upload/confirm/message widgets, manual-task UI, firm preview of the portal,
ops analytics charts.

### 4C-F firm foundation pivot — Firm knowledge + Canada/Toronto scaffolding (2026-06-10, merged to main PR #24)

The sixth firm-foundation slice adds source-aware firm knowledge scaffolding and expands persona/rule
fixtures for the Canada/Toronto MVP flow without treating the Canada checklist as user-verified.

Implemented:

- `firm_knowledge_sources` and `firm_knowledge_entries` tables (migration `0010`) with
  organization ownership, source type, URL/jurisdiction, `lastCheckedAt`, `lastVerifiedAt`,
  `staleAfter`, `verifiedByUser`, and JSON metadata. This is scaffolding only: no retrieval pipeline,
  embeddings, or playbook UI yet.
- `config/rules/firm-knowledge.yaml` defines freshness defaults and required metadata keys for
  official sources, playbooks, templates, prior-approved examples, and internal notes.
- `config/rules/consulates.yaml` now includes `toronto` with official German Missions in Canada
  sources checked on 2026-06-10. Toronto carries `verifiedByUser: false`, source notes, and nullable
  unknowns for details that should not be forced before user verification.
- `CaseFacts.target.targetConsulate` now accepts `toronto`; `getConsulate()` accepts the typed
  consulate id union.
- Persona schema now requires `firm` metadata: source/residence flow, organization kind, assigned
  consultant role, reviewer role, case stage, priority, participants, and optional notes.
- Existing India/Bengaluru personas now carry firm role/assignment metadata. Four synthetic Toronto
  personas were added: `toronto-strong-pretravel`, `toronto-canadian-visa-free-option`,
  `toronto-non-canadian-resident`, and `toronto-edge-anabin`.
- `?persona=` case creation reads the persona's target consulate before creating the case, so Toronto
  fixtures create Toronto case rows instead of a Bengaluru row later overwritten in facts.

Verified official Canada/Toronto source facts used as scaffolding:

- The national visa page lists Blue Card (EU) among residence visas available for online application
  and says people legally residing in Canada for over six months can apply at Toronto.
- The EU Blue Card page says Canadian citizens may apply for a residence permit after arrival, but
  may choose a pre-travel visa if they want employment authorized from the first day of visa validity.
- The EU Blue Card page lists Canada-specific document/checklist items and says Canadian residents
  apply in person at the German Consulate General in Toronto.
- The appointment page says long-term visa applications must be submitted at Toronto.
- The Toronto consulate page gives the Toronto address, phone, and consular district.

Gotchas:

- Canada/Toronto checklist details remain **agent-checked but not user-verified**. Keep
  `verifiedByUser: false` until the user confirms the checklist/rule content.
- The eligibility engine still assesses Blue Card legal eligibility only. Toronto-specific residence
  requirements live in config/persona metadata for now; do not infer Toronto residence blockers in
  the engine until a dedicated consulate/checklist assessment exists.

Verification: `pnpm exec tsc --noEmit`; fast parser/rules subset (46 passing); then
`node --env-file=.env.local node_modules/vitest/vitest.mjs run --no-file-parallelism tests/personas
tests/rules-loader.test.ts tests/journey` with network access to the configured Supabase pooler (87
passing). The same command without network access fails at DNS for the DB-backed persona suites.

Known follow-up: firm playbook retrieval/UI, manual internal notes UI, production Canada checklist
after user verification, and a consulate/checklist readiness assessment that can surface
Toronto-specific residence/document blockers separately from eligibility.

### 4C drafted documents — Anabin justification draft (2026-06-10, merged to main PR #25)

The first 4C slice adds Anabin justification as the fourth draft artifact on the existing
`drafts`/approval foundation. The implementation intentionally keeps the same background generation
path as cover letter, employer letter, and CV: the chat tool creates a `drafts` row, logs
`case.draft.requested`, dispatches `draft.requested`, the Inngest handler generates typed content,
creates an internal consultant approval, and logs only safe metadata.

Implemented:

- `anabin_justification` is now a `DraftType` with a Zod content schema for a factual recognition
  memo: title, subject, institution status, degree status, justification paragraphs, and recommended
  next steps.
- `generateDraftByType` dispatches to `generateAnabinJustification`; prompt version
  `draft_anabin_justification/v0` preserves Anabin uncertainty and forbids invented recognition
  conclusions.
- `draft_anabin_justification` is registered in the agent tool set before `lookup_anabin`; the single
  Anthropic `cache_control` breakpoint remains on `lookup_anabin`, which stays last.
- The agent prompt catalog, chat result renderer, draft review form, journey tracker type schema, and
  Drafts tracker rows all know about the fourth draft type. Only `approved` counts complete.

Gotchas:

- The Anabin draft is a reviewer-facing memo, not a deterministic recognition verdict. Unknown,
  unrated, or not-found states must stay uncertain until official evidence is on file.
- Regeneration/framing and required-by-route draft completeness are still deferred to 4C-2 and 4C-3.

Verification: `pnpm exec tsc --noEmit`;
`node --env-file=.env.local node_modules/vitest/vitest.mjs run --no-file-parallelism tests/drafting
tests/ai/draft_cover_letter.test.ts tests/ai/agent-turn.test.ts tests/inngest/generate-draft.test.ts
tests/journey/compute.test.ts` with network access to the configured Supabase pooler (40 passing);
`pnpm exec vitest run tests/components` (20 passing).

### 4C drafted documents — regenerate with framing (2026-06-10, merged to main PR #25)

The second 4C slice lets consultants create a new draft version with explicit framing instructions
while preserving the existing append-only draft-version model. Regeneration does not mutate the
source draft. It inserts a new `drafts` row for the same case/type, so repository version numbering
continues to be the source of truth.

Implemented:

- `regenerate_draft` is registered in the agent tool set before `lookup_anabin`, preserving the
  single cache-control breakpoint on the last tool. It takes `draftId` plus `framingInstruction`,
  verifies the source draft belongs to the active case, inserts the next version, logs safe metadata,
  and dispatches `draft.requested`.
- `DraftRequestedEvent.data` now accepts optional `framingInstruction`; `generateDraftHandler`
  threads it into `generateDraftByType`.
- All draft prompts receive the same framing block after hard rules. The prompt tells the model to
  follow framing only when consistent with facts and constraints.
- The draft review route exposes a read-only version history list. Only the latest version is
  reviewable: stale review URLs redirect to the latest ready draft if available, otherwise to the
  case workspace.
- The review UI has a "Regenerate with..." affordance that creates a new version and dispatches the
  framed background job.

Gotchas:

- Free-text framing is sent to the worker event and prompt, but not copied into activity-log payloads;
  activity logs record `framingProvided: true` instead.
- There is still no diff UI between versions. The chosen 4C-2 UX is a compact read-only version list.
- Draft completeness remains a separate 4C-3 signal; package gates still live in Phase 6.

Verification: `pnpm exec tsc --noEmit`;
`pnpm exec vitest run tests/ai/agent-turn.test.ts tests/ai/draft_cover_letter.test.ts
tests/ai/regenerate_draft.test.ts` (14 passing);
`node --env-file=.env.local node_modules/vitest/vitest.mjs run --no-file-parallelism tests/drafting
tests/inngest/generate-draft.test.ts` with network access to the configured Supabase pooler (13
passing); `pnpm exec vitest run tests/components` (20 passing).

### 4C drafted documents — completeness signal (2026-06-10, merged to main PR #25)

The third 4C slice makes the Drafts phase report completion against the drafts actually required
for the current eligibility verdict. This is still a tracker signal only; Phase 6 will consume it in
the package/quality gate.

Implemented:

- Draft requirements moved into `config/rules/journey.yaml` under the `drafts` phase. Cover letter,
  employer letter, and CV apply to all routes. Anabin justification is required only when the
  verdict carries a configured Anabin blocker.
- `JourneyManifest` validates `draftRequirements` with Zod, using the shared `DraftTypeEnum` and
  `RouteId`.
- `requiredDraftsForRoute(verdict)` is pure and config-driven. It filters by route overlap plus
  optional verdict blocker/warning conditions; there is no draft-type list in `computeJourneyProgress`.
- `computeJourneyProgress` now computes the Drafts phase total/completed count from required draft
  rows. Only `approved` drafts count complete.

Gotchas:

- A normal recognized-degree case now shows three required drafts. An Anabin-unknown/H- verdict shows
  four required drafts because `anabin_justification` becomes required.
- The helper intentionally uses the eligibility verdict, not raw facts, so future rules can add
  route/blocker/warning-driven draft requirements in YAML.

Verification: `pnpm exec tsc --noEmit`;
`pnpm exec vitest run tests/journey tests/components/tracker.test.ts` (36 passing);
`node --env-file=.env.local node_modules/vitest/vitest.mjs run --no-file-parallelism tests/drafting`
with network access to the configured Supabase pooler (7 passing).

### Phase 5-1 — VIDEX field map + completeness engine (2026-06-11, current branch)

The first VIDEX slice adds a pure field-map/completeness layer only. It does not generate,
preview, store, flatten, or approve a PDF. The `formular` public repo was empty at lookup time;
the useful source was `vitazok/immigration`, specifically `src/lib/assembly/form-mapper.ts` and the
confirmed AcroForm field IDs listed in that repo's `CLAUDE.md`. That source app models a
Schengen-short-stay flow, so this slice ports AcroForm names and transform patterns but keeps
Relomate's Blue Card/national-visa assumptions separate.

Implemented:

- `src/lib/drafting/videx.ts` defines 37 field-level VIDEX entries with AcroForm IDs, transform
  names, and at least one validated Profile/CaseFacts source-path anchor per field.
- `assessVidexCompleteness({profile, caseFacts, today})` returns `{total, filled, missing, values,
  fields}`. It is pure and deterministic when `today` is passed.
- The mapper fills supported values from the current schema: split full name, date formatting,
  country-name formatting, gender/marital radio fields, address lines, employer fields, Blue Card
  purpose/destination, target move date, support-from-employment indicators, and place/date.
- Unsupported or absent facts are reported as missing with reasons (`missing_source`,
  `not_modelled`, `manual_signature`) instead of being guessed. Current gaps include passport issue
  date/authority, birth country, phone/email, prior visas/fingerprints, and signature.
- `fill_videx_form` is a read-only agent tool that loads the active case and returns
  `{type:'videx_completeness_result',version:1,data}`. It is registered before `lookup_anabin`, so
  `lookup_anabin` remains the last tool and sole Anthropic cache-control breakpoint.
- A compact chat renderer for `videx_completeness_result` shows the filled/total count and first
  missing fields; the full report stays structured for the later Forms UI.

Gotchas:

- Field 25 and field 37 do not have clean AcroForm widgets in the imported reference. Field 25 is
  represented through purpose details for now; field 37 stays a manual-signature missing item.
- Do not treat this as PDF readiness. 5-2 owns PDF filling, R2 storage, draft/approval reuse, and
  manual verification that values land in the correct fields.

Verification: `pnpm exec tsc --noEmit`;
`pnpm exec vitest run tests/drafting/videx.test.ts tests/ai/fill_videx_form.test.ts
tests/ai/agent-turn.test.ts tests/components/renderers.test.ts` (24 passing).

### Phase 5-2A — route-aware forms foundation (2026-06-11, current branch)

Official-source check before 5-2 PDF work showed the form path is route-specific, not one generic
Germany-wide VIDEX PDF pipeline. The India national-visa page
(`https://india.diplo.de/in-en/service/2755482-2755482`) says CSP applications no longer require
visiting a separate online form site for supported visa types, while the Canada EU Blue Card page
(`https://canada.diplo.de/ca-en/consular-services/visa/eu-blue-card-2653126`) still documents an
online VIDEX form that must be printed and signed; the official VIDEX long-stay entrypoint is
`https://videx.diplo.de/videx/visum-erfassung/en/videx-langfristiger-aufenthalt`. So 5-2 was split:
first land a route-aware foundation, then decide whether to build a Toronto-only VIDEX output/export
pipeline.

Implemented:

- `config/rules/consulates.yaml` adds structured `formMode`: `csp_integrated` for Bengaluru and
  `videx_online` for Toronto. `ConsulateRules` validates it via the new `FormMode` enum.
- `src/lib/forms/output.ts` exposes `requiredFormOutputForCase(caseFacts)`, returning mode,
  consulate id, and source (`consulate_rules`, `missing_consulate`, `invalid_consulate`).
- `fill_videx_form` remains read-only but now includes `formOutput` in
  `videx_completeness_result`, so renderers/workspace code can branch without parsing consulate
  prose.
- The chat renderer now says "CSP form readiness", "VIDEX readiness", or generic "Form readiness"
  based on `formOutput.mode`.
- Journey copy changed from "VIDEX form + submission package" to "Forms + submission package" so
  the tracker no longer implies VIDEX is universal.
- `IMPLEMENTATION_PLAN.md` supersedes the old generic 5-2 PDF card and adds future 5-2B as a
  Toronto-only VIDEX output pipeline after a reliable non-scraping template/source strategy exists.

Gotchas:

- Do not automate or scrape CSP/VIDEX websites. The route-aware foundation can track readiness and
  prepare data; submission/form-site interaction remains human-driven unless explicitly re-scoped.
- Bengaluru CSP mode means a missing generated VIDEX PDF is not a package blocker by itself.
- Toronto VIDEX output still needs a safe source strategy before `pdf-lib` work starts.

Verification: `pnpm exec tsc --noEmit`;
`pnpm exec vitest run tests/forms/output.test.ts tests/rules-loader.test.ts
tests/journey/loader.test.ts tests/drafting/videx.test.ts tests/ai/fill_videx_form.test.ts
tests/ai/agent-turn.test.ts tests/components/renderers.test.ts` (43 passing).

### Phase 5-3 — Forms workspace section (2026-06-11, current branch)

This slice surfaces the route-aware forms foundation in the internal case workspace. It intentionally
does not add PDF generation, PDF preview, approval, or field-specific chat updates; those remain
separate 5-2B/5-4 work.

Implemented:

- `src/lib/forms/view-model.ts` builds a pure `FormsWorkspaceViewModel` from `{profile, caseFacts,
  today}`. It combines `requiredFormOutputForCase` with `assessVidexCompleteness`, resolves
  consulate metadata, computes the filled/total percentage, and groups missing fields into
  user-provided data, not-yet-modelled schema gaps, and manual completion.
- `src/components/workspace/FormsSection.tsx` renders the Forms workspace block with route mode,
  readiness gauge, official consulate/form copy, source link, and missing-field rows with disabled
  "Provide"/"Pending"/"Sign" controls. Bengaluru renders as CSP-integrated readiness and does not
  claim a generated VIDEX PDF. Toronto renders as VIDEX readiness with the Canada source marked
  not user-verified.
- `/case/[id]` now passes the repository-loaded profile into eligibility, journey progress, and
  forms readiness. The old page-level empty profile shell would have made profile-backed VIDEX
  fields look missing even when the case profile had them.
- `Nav` now enables the Forms anchor while leaving the other unbuilt anchors disabled.

Gotchas:

- The Forms section is read-only. Its controls are intentionally disabled until 5-4 adds structured
  missing-field prompts/updates and 5-2B adds any Toronto output pipeline.
- The locked Journey phase still says "Forms + submission package"; the actual Forms workspace block
  now lives below the tracker cards in the same scrollable center column.

Verification: `pnpm exec tsc --noEmit`;
`pnpm exec vitest run tests/forms tests/components tests/journey/loader.test.ts
tests/drafting/videx.test.ts tests/ai/fill_videx_form.test.ts tests/ai/agent-turn.test.ts`
(48 passing).

### Phase 5-4 — Conversational gap-filling (2026-06-11, current branch)

This slice adds the chat-side loop for actionable missing form fields. It does not add new schema
leaves for currently unmodelled VIDEX fields, so the Phase 5 "100%" gate remains blocked by known
schema gaps such as passport issue date/authority, birth country, phone/email, prior
visas/fingerprints, and signature.

Implemented:

- `request_missing_field` is a read-only tool that loads the active case, builds the forms view
  model, and asks for one actionable `missing_source` field. It accepts an optional VIDEX
  `fieldNumber`; otherwise it picks the first user-provided missing field. It returns
  `{type:'missing_form_field_request',version:1,data}` with the question plus exact `sourcePaths`.
- The prompt catalog tells the model to call `update_case` with those exact `sourcePaths` after the
  user answers. The tool itself never writes case facts.
- `MissingFormFieldRequest` renders the structured question in chat and shows the target case path(s).
- `request_missing_field` is registered before `lookup_anabin`; `lookup_anabin` remains last and the
  sole Anthropic cache-control breakpoint.
- Form missing-field system tasks now derive from the same forms view model inside
  `reconcileCaseTasks`. At most the next actionable missing field is taskified, and only when the
  consulate route is known from CaseFacts (`forms.formOutput.source === 'consulate_rules'`). These
  tasks are client-visible, applicant-owned, blocking system tasks keyed by
  `form_field:<fieldNumber>:<sourcePaths>`.

Gotchas:

- Case-row `cases.target_consulate` is not enough for forms/task readiness; the consulate must be
  persisted as the `target.targetConsulate` CaseFacts leaf via `applyUpdate`/`update_case`.
- Task generation intentionally ignores `not_modelled` and `manual_signature` form gaps; those are
  product/schema work or manual completion, not applicant answer tasks.

Verification: `pnpm exec tsc --noEmit`;
`pnpm exec vitest run tests/ai/request_missing_field.test.ts tests/ai/fill_videx_form.test.ts
tests/ai/agent-turn.test.ts tests/components/renderers.test.ts tests/forms
tests/tasks/view-model.test.ts` (40 passing);
`node --env-file=.env.local node_modules/vitest/vitest.mjs run --no-file-parallelism
tests/tasks/service.test.ts` with network access to the configured Supabase pooler (2 passing).

### Phase status table

| Phase | Status | Spec / plan |
|---|---|---|
| 0 | complete | — |
| 1A foundation | complete, pushed | `docs/archive/plans/2026-05-27-phase-1a-foundation.md` |
| 1B-1 persistence + `update_case` | complete, pushed | `docs/archive/plans/2026-05-27-phase-1b-1-persistence.md` |
| 1B-2 auth + anon→authed merge | complete, pushed | `docs/archive/specs/2026-05-28-phase-1b-2-auth-design.md` |
| 1B-3 chat + workspace + Inngest | complete, pushed | `docs/archive/specs/2026-05-28-phase-1b-3-chat-workspace-design.md` |
| 2A.1 agent brain | complete, merged to main | `docs/archive/plans/2026-05-29-phase-2a-1-agent-brain.md` |
| 2A.2 eligibility + knowledge | complete, merged to main | `docs/archive/specs/2026-05-31-phase-2a-2-eligibility-knowledge-design.md` |
| 2B journey-tracker dashboard | complete, merged to main (PR #3) | `docs/archive/plans/2026-06-01-journey-tracker-dashboard.md` |
| 2C persona-E2E layers 1+2a | complete, merged to main (PR #4) | `docs/archive/specs/2026-06-01-phase-2c-persona-e2e-design.md` |
| 2C-tail L2b real-stream replay | complete, merged to main (PR #5) | `docs/archive/specs/2026-06-02-phase-2c-tail-l2b-design.md` |
| deterministic CI + AGENTS.md | complete, merged to main (PR #14) | `docs/runbooks/ci.md` |
| 2C layer 3 (live LLM + user-simulator) | designed/deferred, not started | follow-up section in the 2C-tail spec |
| codebase-review hardening pass (15 findings) | complete, merged to main (PR #7) | this file, below |
| 3A document-ingest pipeline | complete, merged to main (PR #9) | `docs/archive/specs/2026-06-03-phase-3a-document-ingest-design.md` + plan; this file, below |
| 4A cover-letter drafting | complete, merged to main (PR #15) | `docs/archive/specs/2026-06-07-phase-4a-cover-letter-drafting-design.md` |
| 4B employer-letter + CV drafting | complete, merged to main (PR #16) | this file, below |
| firm-first pivot decision | accepted | `docs/strategy/firm-first-pivot.md` |
| 4C-F-1 RBAC + organization-owned cases | complete, merged to main (PR #19) | `IMPLEMENTATION_PLAN.md`; this file, above |
| 4C-F-2 case participants + visibility primitives | complete, merged to main (PR #19) | `IMPLEMENTATION_PLAN.md`; this file, above |
| 4C-F-3 review inbox + role-aware approvals | complete, merged to main (PR #19) | `IMPLEMENTATION_PLAN.md`; this file, above |
| 4C-F-4 real tasks foundation | complete, merged to main (PR #21) | `IMPLEMENTATION_PLAN.md`; this file, above |
| 4C-F-5 firm console + applicant portal split | complete, merged to main (PR #22) | `IMPLEMENTATION_PLAN.md`; this file, above |
| 4C-F-6 firm knowledge + Canada/Toronto scaffolding | complete, merged to main (PR #24) | `IMPLEMENTATION_PLAN.md`; this file, above |
| 4C-1 Anabin justification draft | complete, merged to main (PR #25) | `IMPLEMENTATION_PLAN.md`; this file, above |
| 4C-2 regenerate draft with framing | complete, merged to main (PR #25) | `IMPLEMENTATION_PLAN.md`; this file, above |
| 4C-3 drafts completeness signal | complete, merged to main (PR #25) | `IMPLEMENTATION_PLAN.md`; this file, above |
| 5-1 VIDEX field map + completeness engine | complete on current branch | `IMPLEMENTATION_PLAN.md`; this file, above |
| 5-2A route-aware forms foundation | complete on current branch | `IMPLEMENTATION_PLAN.md`; this file, above |
| 5-3 Forms workspace section | complete on current branch | `IMPLEMENTATION_PLAN.md`; this file, above |
| 5-4 conversational gap-filling | complete on current branch | `IMPLEMENTATION_PLAN.md`; this file, above |

### Codebase-review hardening (2026-06-03, merged to main PR #7) — full detail

A full-codebase review surfaced 15 findings; 13 fixed (TDD), 1 was a false positive, 1
schema change rippled through tests. All `tsc`/`eslint` clean; full suite green (run
**serially** — `pnpm exec vitest run --no-file-parallelism` in batches — to dodge
`EMAXPOOLSREACHED`). Load-bearing changes (the directives are mirrored terse in CLAUDE.md):

- **Eligibility engine (`src/lib/rules/eligibility.ts`) — verdict-affecting fixes:**
  - IT-no-degree route now gates on the **reduced** threshold (was `standard`), matching
    `blue-card.yaml`'s `reduced.appliesTo`. The `arjun-it-no-degree` persona (€52k >
    standard) had masked the bug.
  - `activeThreshold` now returns `undefined` when no period covers `today` (was
    `?? thresholds[0]`) → the `no_active_threshold` blocker is now reachable. **Ripple:**
    `summarizeFigures` now returns `Figures | null` (was throwing); `check_eligibility`
    returns `status:'assessed'` with `figures:null`; the `EligibilityResult` renderer
    handles null figures with an amber "figures unavailable" card.
  - Recent-graduate route now also requires `hasEducation` (a degree on file), not just
    `completionYear` + recognition.
- **`IntendedVisa` enum widened** (`src/lib/case/schema.ts`) from `['blue_card']` to include
  `student`/`job_seeker`/`family_reunion`/`asylum`/`other`. This makes the engine's
  `outOfScope` branch reachable through validated/persisted facts — non-Blue-Card intents
  now persist via `update_case` and the engine flags them (engine stays the sole setter of
  the `outOfScope` flag; the `out_of_scope` tool still doesn't set it). The leaf-path
  catalog auto-derives the new enum options. The out-of-scope-asylum persona's
  `intendedVisa:'asylum'` now persists as a VALID leaf (no longer rejected/isolated) —
  `case-file.test.ts` + `harness.test.ts` were updated to the new contract.
- **`messages.user_id` is now populated** — `appendChatTurn` requires a `userId` field
  (threaded from the route via `buildAgentTurn`). Any new caller MUST pass it.
- **Tool-call errors persist** — `agent-turn.ts` `onFinish` now scans each step's `content`
  for `tool-error` parts (they are NOT in `step.toolResults`) and writes their message into
  `tool_calls.error`. A failed `update_case` still does NOT emit `case.facts.updated`.
- **`deepEqual` in `repository.ts` is now key-order insensitive** (structural recurse, not
  `JSON.stringify`) — reordered keys on object leaves (`currentAddress`) no longer raise
  spurious contradictions.
- **Profile lost-update race fixed** — `applyUpdate` now takes a `FOR UPDATE` lock on the
  always-present `users` row BEFORE `case_facts`/`profiles` (global lock order: users →
  case_facts → profiles). Two cases of the same user no longer clobber each other's profile
  writes. Don't reorder these locks.
- **`getCurrentUserId` now hits the DB** (`src/lib/auth/session.ts`) — returns null for a
  deleted user or one with `users.merged_into` set. **New column `users.merged_into`**
  (migration `drizzle/0002_melodic_silver_surfer.sql` + snapshot/journal hand-authored —
  regenerate with `pnpm db:generate` against a real DB before deploying). The branch-(c)
  merge in `merge.ts` now sets `merged_into` when tombstoning the anon user.
- **Branch-(b) orphan fixed** (`merge.ts`) — identity insert happens FIRST with conflict
  detection; on conflict it re-resolves the owner and falls through to the merge path
  instead of leaving a non-anon user with no identity.
- **`/api/chat` guards `convertToModelMessages`** — malformed-but-valid-JSON transcripts
  now 400 (was an unhandled 500).
- **Empty-bubble-on-reload fixed** — `src/components/workspace/hydrate-messages.ts`
  (`hydrateMessages`) is the pure, tested mapping from persisted rows → `UIMessage[]`;
  `page.tsx` uses it. When persisted `parts` are tool-only with no renderable output, it
  appends the assistant's text `content` so the bubble isn't empty. This partially
  addresses the `messages.parts` last-step open item at render time (the persisted blob is
  still last-step-only; the decision to aggregate `parts` at write time is still open).
- **Persona seeding wired** — `src/lib/personas/seed.ts` (`seedCaseFromPersona`,
  `personaToLeafUpdates`, `loadPersona`, `listPersonaIds`) is the production seeder;
  `/api/case/new?persona=<id>` seeds via the normal `update_case` path (unknown ids =
  no-op). NOTE: the test harness (`tests/_personas/harness.ts`) still has its OWN
  persona→facts conversion (wrapped/provenance shape) — the two are parallel
  implementations; consolidate if you touch either.
- **False positive (NOT changed):** `assessReadiness` treating anabin `'unknown'`/`'H-'` as
  a satisfied recognition signal is INTENTIONAL — `check_eligibility.test.ts` codifies that
  `unknown` returns `assessed` (with ZAB guidance), and `ready` is an internal
  assessed-vs-incomplete gate, never surfaced as a positive user-facing state. Do not "fix"
  it.

### Journey-tracker dashboard (2B centerpiece — SHIPPED, merged to main PR #3) — full record

Full spec: `docs/archive/specs/2026-05-31-journey-tracker-dashboard-design.md`
(`4db6846`); plan: `docs/archive/plans/2026-06-01-journey-tracker-dashboard.md`.
Shipped `config/rules/journey.yaml` + `src/lib/journey/`
(`loader`/`types`/`citations`/`provenance`/`compute`) +
`src/components/workspace/Tracker.tsx` (replaced `Overview.tsx`, preserving its empty-state
copy). `computeJourneyProgress(caseFacts, profile, documents, verdict, today)` is pure and
reuses the 2A.2 helpers (`evaluateEligibility`/`assessReadiness`/`summarizeFigures`) at ~0
token cost. Touched `CaseFacts.family` (`spousePresent`/`childrenCount`) + `documents.yaml`
(optional `condition`). Per-persona assertions in
`tests/journey/compute-personas.test.ts`. Center column = the tracker, a **read-only
projection** over case state (no new write path; rule 5 holds), config-driven via
`journey.yaml` (rule 7). Full locked design record (4 phases, dual provenance, layout
Option-A) lives in the spec doc above. Two non-obvious decisions worth keeping (do NOT
redebate):
- **Family = one account, family as case data.** `CaseFacts.family` carries `spouse` +
  `children[]` mini-profiles (identity fields for per-member VIDEX/passport docs).
  **Eligibility engine untouched** — family doesn't gate the primary's verdict. No auth
  change.
- **Identity (Profile) folds into Documents** — extracted from passport, confirmed in
  place, consumed by VIDEX. No standalone Profile phase; `Profile` DB table untouched
  (load-bearing for anon→authed merge).

### Phase 3A — document-ingest pipeline (2026-06-04, merged PR #9) — full detail

"File in → structured data out, awaiting confirmation." A user uploads a document; it lands
in Cloudflare R2 via a presigned direct-to-R2 PUT (bypassing Vercel's ~4.5 MB body limit); a
durable Inngest workflow classifies it against the document spine and extracts structured
fields with per-field confidence, parking the result on a new `documents` row in
`awaiting_confirmation`. Built TDD, subagent-reviewed per task (implementer → spec → quality).
All `tsc`/`eslint` clean; 91 tests green across the 3A surface (run **serially** —
`EMAXPOOLSREACHED` is the documented pooler infra limit on full-suite re-runs, not a regression;
batch DB files). Design: `docs/archive/specs/2026-06-03-phase-3a-document-ingest-design.md`;
plan: `docs/archive/plans/2026-06-03-phase-3a-document-ingest.md`; runbook:
`docs/runbooks/r2-reducto-setup.md`.

**Why these decisions:**

- **`documents` table is mutable, not append-only.** It's a work-in-progress record (like
  `case_facts`), so `status`/`extracted`/`classification`/`error` update in place. The
  append-only rule (10) is satisfied by the `activity_log` rows the workflow writes at each
  consequential transition — that's the immutable audit trail. Columns:
  `{id, caseId, userId, spineItemId, detectedType, status, r2Key, fileName, contentType,
  byteSize, extracted(jsonb), classification(jsonb), error, timestamps}`. Migration
  `drizzle/0003_dear_grandmaster.sql`.

- **3A stops at `awaiting_confirmation` — no case-state write (rule 5).** The write into
  `CaseFacts`/identity is 3B's `confirm_extraction`. A dedicated test asserts `case_facts`
  stays `{}` after the workflow runs. This is the cleanest seam: 3A proves
  upload→extract→store works without entangling the confirmation/approval primitive.

- **Extraction triggers on the finalize ROUTE, not an agent `extract_document` tool**
  (intentional PRD deviation). Upload is a user action; the workflow fires off the
  `document.uploaded` event; the agent never awaits background work (rule 13). The
  `request_document_upload` tool only renders the upload affordance — it doesn't read/store.

- **Presigned direct-to-R2 (Approach B).** Three thin routes: `POST /upload-url`
  (auth+ownership+type/size validate → insert `pending_upload` row → presigned PUT url),
  `POST /[id]/finalize` (ownership → `headObject` confirms the bytes landed [409 if not, closes
  the orphan gap] → status `uploaded` → emit `document.uploaded`, idempotent: no re-emit once
  past `pending_upload`), `GET /[id]` (render-safe projection). All routes: 401→404→403 guard
  order; `headObject` returns null on NotFound and THROWS on other errors so a transient R2
  failure can't be misread as "upload missing."

- **PII discipline (cross-cutting).** `case.document.extracted` / `extraction_failed`
  activity rows carry field KEYS + confidences + `sensitiveKeys` only — never values. The GET
  projection strips `r2Key` and `extracted.raw`. The workflow doesn't even persist
  `extracted.raw` (stricter than the spec's §10 — eliminates the "does raw leak PII into logs"
  worry by not storing it). Values live only in `documents.extracted` (DB, behind auth).

- **`extractDocument` Inngest workflow** (`src/lib/inngest/functions/extract-document.ts`,
  registered in `api/inngest/route.ts`) follows the `log-case-event.ts` pattern: separately
  exported handler + 2-arg `createFunction`, `StepLike` so tests inject a fake `step.run`.
  Checkpointed steps `load-document` (idempotency guard: proceeds only on status `uploaded`) →
  `classify` → `extract` (skips when the spine item has no extraction schema → empty fields) →
  `store` (`setExtraction` → `awaiting_confirmation`) → `log-extracted`; failure → `setFailed`
  + `case.document.extraction_failed` row. **Non-blocking follow-up:** the guard is a
  non-atomic read-check-write; make it race-safe with a conditional
  `setStatus ... WHERE status='uploaded'` if concurrent re-delivery ever bites. Also: a failed
  `inngest.send` after `setStatus('uploaded')` leaves a stuck `uploaded` row (MVP-accepted; a
  sweeper is a 3D follow-up — the emit MUST stay after setStatus because the workflow guard
  requires `uploaded`).

- **Extraction provider seam** (`src/lib/extraction/`): `makeExtractionProvider()` →
  Reducto-primary + Anthropic-vision fallback (`withFallback`) when `REDUCTO_API_KEY` is set,
  else vision-only — so the slice runs end-to-end even without Reducto. Config-driven schemas:
  `config/rules/documents.yaml` items gain an optional `extraction.fields` block (passport
  seeded, `passportNumber` flagged `sensitive`); `schema.ts` loads them (module-cached —
  restart `pnpm dev` after edits). **The Reducto request/response shape in `reducto.ts` is a
  best-effort guess — reconcile against the live API when the key is provisioned** (runbook §B);
  the test pins the mapped shape, vision fallback carries extraction until then.

- **NEW deps** `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (R2 is S3-compatible; the
  conventional lowest-surprise client). **NEW env** `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/
  `R2_SECRET_ACCESS_KEY`/`R2_BUCKET`/`R2_ENDPOINT` (all `superRefine`-prod-required like
  `AUTH_RESEND_KEY`); `REDUCTO_API_KEY` NOT prod-required.

- **UI:** `request_document_upload` is the 7th agent tool, registered BEFORE `lookup_anabin`
  (which MUST stay last — single cache_control breakpoint; the agent-turn test asserts count==1)
  and documented in `prompts/agent/v0.md` (`PROMPT_VERSION` stays `v0`). Renderers
  `document_upload_request` + `document_extraction_status`; `DocumentUpload.tsx` (`'use client'`)
  exports the pure `uploadDocument(caseId, file)` orchestration (upload-url → R2 PUT → finalize)
  + a polling status card with a terminal-timeout guard; a compact uploader is mounted in
  `ChatPanel`. The in-bubble card renders without `caseId` and no-ops its file input — accepted
  for 3A (the composer uploader is the working path; 3B/3C give documents a first-class home).
  `ALLOWED_UPLOAD_TYPES`/`ALLOWED_UPLOAD_ACCEPT` in `src/lib/documents/types.ts` is the single
  source of truth for the mime allow-list (route Set, tool accept-string, ChatPanel all derive
  from it).

- **Built-ahead (intentional forward-wiring, not dead code):** `document_extraction_status`
  renderer (no 3A emitter — for 3B), `StorageAdapter.presignDownload` (3B review UI) +
  `deleteObject` (3D sweep), `DocumentRepository.listByCase` (3C Documents section),
  `listExtractableItems`. Dev exerciser `scripts/dev-only/extract-doc.ts <file> <caseId>` runs
  the real R2 + provider path end-to-end.

- **Deferred to later slices (NOT gaps):** approvals table + `confirm_extraction` + side-by-side
  review UI (3B); full Needed/Awaiting/Confirmed Documents section + drag-drop-anywhere (3C);
  apostille tracker + Resend "ready for review" email (3D).

---

### Phase 3B — approvals & review (2026-06-04, branch `feat/phase-3b-approvals-review`, pending PR) — full detail

"File-in → reviewed → in the case." Closes the loop 3A opened: a human reviews the extracted
document fields on a dedicated route and confirms; confirmed values flow into `CaseFacts`/`Profile`
via the single `applyUpdate` write path, gated by a generic `approvals` primitive (reused by Phase 4
drafts). Built subagent-driven (implementer → spec review → quality review per task), TDD throughout.
`tsc`/`eslint` clean; ~317 tests green (run **serially** — `EMAXPOOLSREACHED` is the documented
pooler infra limit, not a regression). Spec:
`docs/archive/specs/2026-06-04-phase-3b-approvals-review-design.md`; plan:
`docs/archive/plans/2026-06-04-phase-3b-approvals-review.md`. 13 commits (`e454c06`..`095d63e`).

**Why these decisions:**

- **Server action → `applyUpdate`, not an agent `confirm_extraction` tool.** Rule 5's intent is "one
  write path for case state"; the `update_case` *tool* was only the agent's manifestation of
  `repo.applyUpdate`. The confirm `'use server'` action (`review/actions.ts`) calls `applyUpdate`
  directly — no LLM in the confirm loop (deterministic, fast, good UX), consistent with 3A's
  precedent of putting upload/finalize on routes (rule 13). The literal `confirm_extraction` tool
  from the IMPLEMENTATION_PLAN was intentionally dropped. The logic lives in node-testable
  `confirmExtractionCore`/`rejectExtractionCore` (`confirm-core.ts`); the action is a thin
  auth+redirect wrapper (so the core is unit-tested without Next's request context).

- **Generic polymorphic `approvals` table** (migration `0004_zippy_kinsey_walden.sql`):
  `{id, caseId, userId, subjectType, subjectId, status, decision(jsonb), resolvedBy, resolvedAt,
  timestamps}`. `subjectType:'document'` now, `'draft'` in Phase 4 with zero schema change. MUTABLE
  (like `documents`/`case_facts`); the immutable audit trail is `activity_log`. **Partial unique
  index** `approvals_pending_subject_unique` on `(subject_type, subject_id) WHERE status='pending'` =
  at most one OPEN approval per subject (resolved rows don't conflict, so a subject can be
  re-reviewed after a reject). `makeApprovalRepository` (`approvals/repository.ts`): `createPending`
  (idempotent — returns the existing pending if any, the partial unique is the concurrent-race
  backstop), `getById`, `getBySubject` (filters status='pending'), `listPending` (the uniform "what
  needs review" inbox), `resolve`. The 3A `extract-document.ts` workflow gains ONE additive
  `create-approval` step after `store` (idempotent under re-delivery) — the only touch to 3A.

- **Confirm semantics — confidence 1.0, per-field source, ≤2 `applyUpdate` calls.** Human-reviewed
  data is authoritative: every confirmed leaf is written at confidence 1.0, `sourceTurnId: null`,
  `source = 'document'` (as-extracted) or `'user_corrected'` (the user edited it). Because
  `applyUpdate` takes ONE source per call, `confirmExtractionCore` splits the updates into at most
  two calls (one per source group) — ZERO change to the load-bearing `applyUpdate`
  (lock-ordering/contradiction logic untouched). At 1.0 a later lower-confidence chat statement won't
  silently override confirmed identity, and a re-confirm of the same value is a `deepEqual` no-op.
  Ordering: applyUpdate(s) → resolve approval → setStatus('confirmed') → appendActivity.

- **Finalize-gating (whole-slice-review fix, commit `095d63e`).** Originally confirm ALWAYS resolved
  the approval + set status `'confirmed'`. But if a SUBMITTED field couldn't be saved (its transform
  returned null → `unmapped`), the doc flipped to `'confirmed'` and the `wrong_status` guard then
  made the "correct it and confirm again" instruction a dead-end. Fix: persist every mappable field
  (partial progress, idempotent at 1.0) but only resolve+close when EVERY submitted field saved
  (`unsavedSubmitted.length === 0`). Otherwise leave the doc `awaiting_confirmation` + approval
  `pending` so re-confirm works. Tested end-to-end (bad date → reviewable → corrected → finalized).

- **Field→leaf mapping is config-driven** (rule 7). `config/rules/documents.yaml` extraction fields
  gain optional `target` (BARE leaf path — `fullName`, `passportNumber`, … — NOT `profile.`-prefixed;
  `validateLeafPath` resolves profile leaves at the root), `transform`, `part`. `assertValidTargets`
  validates every `target` at YAML load (fail-fast: a typo crashes at load, not silently at confirm).
  Typed transform registry (`transforms.ts`): `composeFullName` (surname+givenNames fan-in →
  `fullName`), `toIso2` (nationality string → ISO2 via the `review.yaml` seed; null on unknown),
  `normalizeDate` (passport formats `15 JAN 1990` / day-first `DD/MM/YYYY` / `DD.MM.YYYY` →
  `YYYY-MM-DD`, round-trip-validated; null on unparseable). A transform returning null leaves the
  field `unmapped` (not written) so junk never reaches the strict Zod leaf. `buildConfirmUpdates`
  (`confirm-mapping.ts`, pure) groups reviewed fields by `target` and applies each group's transform
  once; a path is `user_corrected` if ANY contributing field was edited.

- **Silent-data-loss fix (whole-slice-review).** `buildConfirmUpdates` returns `unmapped`;
  `confirmExtractionCore` returns it on the ok path; the `confirmExtraction` action computes the
  intersection of submitted keys ∩ unmapped and, when non-empty, returns `{unmapped}` INSTEAD of
  redirecting; `ReviewForm` warns "We couldn't recognize: X — correct it and confirm again to finish"
  rather than silently dropping the user's correction. (Pairs with finalize-gating: the doc stays
  reviewable so the warning is actionable.)

- **PII discipline.** `case.approval.resolved` activity rows carry leaf path KEYS + status only —
  never values (`ApprovalDecision = {confirmedPaths, editedPaths, rejectedReason}`). Sensitive fields
  (`passportNumber`, flagged in the extraction schema) render masked (password input + show/hide) in
  the review form. The review-route RSC passes only `buildReviewRows` output + a presigned URL to the
  client — `r2Key`/`extracted.raw` never cross the boundary.

- **Review UI = dedicated RSC route** `/case/[id]/documents/[docId]/review` (not in-chat, not modal;
  `runtime='nodejs'` + `dynamic='force-dynamic'`). Guards mirror the case page: `getCurrentUserId()`
  null → `/signin`; missing/cross-case → `notFound()`; cross-user → redirect `/`; status ≠
  `awaiting_confirmation` → redirect to the case. Left column = source preview (`<img>` for images,
  `<object>` for PDFs, via `StorageAdapter.presignDownload` — 3A's built-ahead finding its first
  consumer); right = editable fields with confidence badges (`config/rules/review.yaml` bands, rule
  7) + sensitive masking + "(not saved)" tags on unmapped fields. `ReviewForm` (`'use client'`,
  `useTransition` per React 19 — not `useFormState`) submits ONLY `mapped` fields. `classifyConfidence`
  (`confidence.ts`) is pure + client-safe — it `import type`s `ConfidenceBands` so the `node:fs`
  loader never enters the client bundle.

- **Renderer deep link (built-ahead).** The `document_extraction_status` renderer gains, for
  `awaiting_confirmation`, a "Review & confirm" deep link to the review route, plus terminal states
  (`confirmed` → "✓ Added to your case", `rejected` → "Dismissed"). Like 3A, this renderer has NO
  live emitter yet — the in-chat path to the review screen is dormant; the route is reachable by
  direct URL and will be wired from the 3C Documents section. Documented as a known gap, not breakage.

- **NEW config** `config/rules/review.yaml` (confidence bands + nationality→ISO2 seed; module-cached
  loader `review-config.ts`, `__resetReviewConfigCacheForTests` for tests). **NO new deps.** Migration
  `0004`. Two existing tests updated for the new reality (`documents/types.test.ts` enum lifecycle +
  `extraction/schema-loader.test.ts` passport field shape) — justified, not scope creep.

- **Deferred to 3C/3D (NOT gaps):** full 3-group Documents workspace section + drag-drop-anywhere
  (3C); apostille tracker + Inngest reminders + Resend emails (3D); a live
  `document_extraction_status` emitter (3C); a persona doc-flow E2E test (3C, once a Documents
  section exists to drive). Minor loose threads from the final review: `subject_id` is uuid-typed
  (couples the generic table to uuid subjects — fine for documents+drafts); `__resetReviewConfigCacheForTests`
  currently unused.

---

### Phase 3C — Documents tracker loop (2026-06-06, local Codex handoff) — full detail

"The tracker is the Documents workspace." This slice turns the existing 2B journey tracker +
3A/3B document backend into a usable document dashboard loop without adding a separate route yet.
Each document requirement row now reflects the current `documents` row for that checklist item:
missing → upload, `uploaded`/`classifying`/`extracting` → processing, `awaiting_confirmation` →
review link, `failed`/`rejected` → re-upload, `confirmed` → complete. The full 3-group layout
(Needed / Awaiting / Confirmed), drag-drop-anywhere, apostille tracker, emails, and persona doc-flow
E2E remain deferred.

**What changed:**

- **Tracker consumes `documents`.** `src/app/case/[id]/page.tsx` now loads
  `makeDocumentRepository(db).listByCase(caseId)` and passes those rows plus `caseId` into
  `computeJourneyProgress`. The projection stays read-only: it does not mutate documents or case
  facts; it only maps current DB state to `StepProgress`.

- **`StepProgress` grew a document state.** `src/lib/journey/types.ts` adds
  `DocumentProgress = {id,fileName,status,reviewHref}` and upload actions now include
  `{kind:'upload', enabled, spineItemId}`. Eligibility steps set `document:null`; document steps
  set it when a matching row exists.

- **Matching rule:** `computeJourneyProgress` buckets uploaded rows by `spineItemId` and consumes
  one row per rendered checklist item. The initial 3C implementation matches only by the document
  spine item id; this is enough for applicant items and the current spouse/child singletons, but it
  does **not** yet distinguish multiple children with the same document id beyond consuming rows in
  repository order. If per-child identity/uploads become first-class, add a stable member key to
  `documents` before relying on this for exact child matching.

- **Status semantics in the tracker:** only `confirmed` counts as complete. `awaiting_confirmation`
  renders `ready for review` plus `/case/<caseId>/documents/<docId>/review`. `uploaded`,
  `classifying`, and `extracting` render `processing` and suppress the upload control. `failed`
  renders `could not read` and allows re-upload. `rejected` renders `dismissed` and allows re-upload.
  Missing rows also allow upload.

- **Checklist-specific uploads.** `DocumentUpload.uploadDocument(caseId,file,spineItemId?)` now sends
  `spineItemId` to `/api/documents/upload-url`; the route validates/persists it through
  `DocumentRepository.insertWithId`. This means a tracker-row upload can immediately map back to the
  correct checklist requirement instead of waiting on classifier output alone. The chat composer
  uploader still passes `null`.

- **Refresh behavior.** `DocumentUpload` calls `router.refresh()` when polling reaches
  `awaiting_confirmation`/`failed`, times out, or throws, so the RSC tracker swaps from the inline
  upload card to the persisted document status.

- **Verification in local Codex checkout:** `node_modules/.bin/vitest run
  tests/journey/compute.test.ts tests/components/tracker.test.ts
  tests/components/document-upload.test.tsx tests/ai/request_document_upload.test.ts` → 26 tests
  passed. `node_modules/.bin/tsc --noEmit` passed. `node_modules/.bin/eslint` on touched files
  passed. `next build` passed with dummy build-time env values (strict env schema requires them).
  DB-backed tests could not run in this scratch checkout because `.env.test.local`/DB URLs were not
  available; `tests/api/documents-upload-url.test.ts` was updated to assert `spineItemId`
  persistence for the proper DB-backed run.

**Still deferred after 3C tracker loop:**

- Full 3-group Documents section or route (Needed / Awaiting / Confirmed) if the tracker becomes too
  dense.
- Drag-and-drop-anywhere.
- A live `document_extraction_status` emitter; the renderer exists, but the tracker review link is
  the live path now.
- Apostille tracker + Inngest scheduled reminders.
- Resend "ready for review" and "apostille due" emails.
- Persona/doc-flow E2E once a deterministic local document fixture strategy exists.

---

### Phase 4A — Cover-letter drafting (2026-06-07, merged to main PR #15) — full detail

This slice adds the first drafted-document vertical: cover letter only. It deliberately builds the
artifact/approval foundation without pulling in employer letter, CV, Anabin justification,
regeneration, VIDEX, or package completeness.

**What changed:**

- **`drafts` table.** Migration `drizzle/0005_real_young_avengers.sql` adds mutable draft rows:
  `{caseId,userId,type,version,status,content,modelVersion,promptVersion,error,approvedBy,approvedAt}`.
  Draft rows are WIP artifacts like `documents`, not append-only case state. The audit trail is
  `activity_log`.

- **Typed cover-letter content.** `src/lib/drafting/types.ts` defines `DraftType`, `DraftStatus`,
  `CoverLetterContentSchema`, and the `draft_request_result` payload schema. The first supported
  type is only `cover_letter`.

- **Background generation.** `draft_cover_letter` creates a `drafting` row, logs
  `case.draft.requested`, emits `draft.requested`, and returns immediately. `generateDraftHandler`
  loads the current case/profile, calls `DraftGenerator.generateCoverLetter`, validates output with
  Zod, stores `{type:'cover_letter',data}`, moves the row to `ready_for_review`, creates
  `approvals.subjectType:'draft'`, and logs `case.draft.ready_for_review`. Failures mark the row
  `failed` and log `case.draft.failed`.

- **PII discipline.** Draft text can contain user facts. Activity payloads therefore carry only
  `draftId`, `draftType`, and booleans like `edited`/`hasReason`. Approval decisions use
  `draft.cover_letter.content` as a key; they never store content text.

- **Review UI.** `/case/[id]/drafts/[draftId]/review` mirrors the document review guard pattern:
  unauthenticated users redirect to `/signin`, cross-user access redirects to `/`, wrong status
  returns to the case. Users can edit title, recipient, subject, body paragraphs, and signoff, then
  approve or reject. Approval marks the draft `approved` and resolves the pending approval;
  rejection marks `rejected`.

- **Tracker integration.** `config/rules/journey.yaml` unlocks the Drafts phase with
  `source: drafts`. `computeJourneyProgress` renders one cover-letter step; only `approved` counts
  complete, and `ready_for_review` links to the review route. Employer letter and CV remain deferred
  in `comingSoon`.

- **Tool order/cache invariant.** `draft_cover_letter` is registered before `lookup_anabin`.
  `lookup_anabin` remains last and still carries the single Anthropic cache-control breakpoint.

- **Verification:** `pnpm exec tsc --noEmit` passed. Focused tests passed with DB network allowed:
  `NODE_ENV=test node --env-file=.env.local node_modules/vitest/vitest.mjs run --no-file-parallelism
  tests/drafting tests/inngest/generate-draft.test.ts tests/ai/draft_cover_letter.test.ts
  tests/ai/agent-turn.test.ts tests/components/renderers.test.ts tests/components/tracker.test.ts
  tests/journey/compute.test.ts tests/journey/loader.test.ts` -> 9 files / 45 tests.

**Still deferred after 4A:**

- Employer letter, CV, and Anabin justification draft types. (Employer letter + CV are implemented in Phase 4B.)
- `regenerate_draft` and any multi-version draft history semantics.
- Package completeness gates that require approved drafts.
- Live generated-content quality eval.
- A full Drafts workspace route if the tracker row becomes too dense.

---

### Phase 4B — Employer-letter + CV drafting (2026-06-07, current branch) — full detail

This slice extends the Phase 4A draft artifact foundation to the two remaining MVP drafted
documents that share the same lifecycle: employer letter and CV. It intentionally does not add
Anabin justification, `regenerate_draft`, VIDEX, package gates, or a full Drafts workspace route.

**What changed:**

- **Typed draft union widened.** `DraftTypeEnum` is now
  `cover_letter | employer_letter | cv`. `EmployerLetterContentSchema` captures a printable
  employer template (`employerAddress`, `paragraphs`, `signatureBlock`,
  `employerInstructions`); `CvContentSchema` captures personal details, profile, and structured
  sections/entries. `DraftContentSchema` remains the storage/approval validation boundary.

- **Per-type generation.** `makeAiDraftGenerator()` now exposes `generateCoverLetter`,
  `generateEmployerLetter`, and `generateCv`; each has its own prompt version
  (`draft_cover_letter/v0`, `draft_employer_letter/v0`, `draft_cv/v0`) and repeats the same
  non-invention/no-legal-threshold discipline. `generateDraftByType` is the single worker-side
  dispatcher.

- **Draft request tools.** `draft_cover_letter`, `draft_employer_letter`, and `draft_cv` all use
  one shared `makeDraftRequestTool` factory. They create a `drafting` row, log
  `case.draft.requested`, emit `draft.requested`, and return `{type:'draft_request_result',
  version:1,data}` immediately.

- **One Inngest worker.** `generateDraftHandler` loads the row, reads `draft.type`, dispatches
  through `generateDraftByType`, stores the typed content, creates the draft approval, and logs
  only `{draftId,draftType}`. Failures mark the row `failed` and also log only safe metadata.

- **Polymorphic review.** `/case/[id]/drafts/[draftId]/review` now accepts any ready draft whose
  stored content type matches the row type. Approval posts a full `DraftContent` payload; the
  server revalidates with `DraftContentSchema`, rejects type mismatches, resolves the approval,
  and logs paths as `draft.<type>.content`. Activity payloads still never contain draft text.

- **Version increment.** `makeDraftRepository.insert()` assigns `version =
  max(version for same caseId+type)+1`, so repeated requests are tracked row-by-row. There is no
  version-history UI and no `regenerate_draft` tool yet.

- **Tracker integration.** `computeJourneyProgress` renders three Drafts steps:
  `cover_letter`, `employer_letter`, and `cv`. Only `approved` counts complete; `ready_for_review`
  links to the review route. The stale Drafts `comingSoon` copy was removed from
  `config/rules/journey.yaml`.

- **Tool order/cache invariant.** The new draft tools are registered before `lookup_anabin`.
  `lookup_anabin` remains last and still carries the single Anthropic cache-control breakpoint.

- **Verification:** `pnpm exec tsc --noEmit` passed. Focused non-DB tests passed:
  `pnpm exec vitest run tests/ai/draft_cover_letter.test.ts tests/ai/agent-turn.test.ts
  tests/components/tracker.test.ts tests/components/renderers.test.ts tests/journey/compute.test.ts
  tests/journey/loader.test.ts --no-file-parallelism` -> 6 files / 41 tests. DB-backed draft
  suites were not runnable in this shell because `DIRECT_URL`/`DATABASE_URL` and required test env
  were absent; run `tests/drafting/*` and `tests/inngest/generate-draft.test.ts` serially with
  `.env.test.local`/DB env before merging.

**Still deferred after 4B:**

- Anabin justification draft.
- `regenerate_draft` UX with framing instructions and version-history display.
- Package completeness gates that require approved drafts.
- Live generated-content quality eval.
- Full Drafts workspace route if tracker-row editing becomes too dense.

---

## Superseded decisions

- **`Overview.tsx` → `Tracker.tsx`** (2B journey-tracker). `Overview.tsx`'s `SECTION_ORDER`
  was `['employment', 'education', 'family', 'target']` (the design-doc said 'risk', which
  doesn't exist on `CaseFacts`). The tracker renders phases not raw sections; it preserved
  Overview's empty-state copy. The stale `#overview` sidebar anchor was fixed to `#tracker` in
  Phase 4A.
- **`v0-stub` prompt removed** (2A.1). `prompts/agent/v0.md` is the live prompt;
  `PROMPT_VERSION = 'v0'` covers the current chat tool catalog. Phase 4A/4B added
  draft request tools without a generational prompt bump; generated draft prompts have their own
  per-type versions. Reserve a `PROMPT_VERSION` bump for the next generational rewrite.
- **Inngest emit location** — pre-2A.1 it lived in `/api/chat`'s `onFinish`; Task 8 moved
  the loop into `buildAgentTurn`'s `onFinish` (best-effort). Repository stays Inngest-free.
