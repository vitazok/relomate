# Relomate — Context History

Relocated out of `CLAUDE.md` to keep it lean. CLAUDE.md carries the forward-looking
**directives** (what not to redo, what must hold); this file carries the **why** behind
them and the record of resolved work — phase write-ups, bug post-mortems, superseded
decisions. Read the relevant section here when you're about to touch that area; the
one-liner in CLAUDE.md tells you WHAT not to do, this tells you why it bit us.

> Per-phase commit hashes and test counts also live in git history.

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
breakpoint there caches the whole static-tools prefix). The other five tools carry NO
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

### Phase status table

| Phase | Status | Spec / plan |
|---|---|---|
| 0 | complete | — |
| 1A foundation | complete, pushed | `docs/superpowers/plans/2026-05-27-phase-1a-foundation.md` |
| 1B-1 persistence + `update_case` | complete, pushed | `docs/superpowers/plans/2026-05-27-phase-1b-1-persistence.md` |
| 1B-2 auth + anon→authed merge | complete, pushed | `docs/superpowers/specs/2026-05-28-phase-1b-2-auth-design.md` |
| 1B-3 chat + workspace + Inngest | complete, pushed | `docs/superpowers/specs/2026-05-28-phase-1b-3-chat-workspace-design.md` |
| 2A.1 agent brain | complete, merged to main | `docs/superpowers/plans/2026-05-29-phase-2a-1-agent-brain.md` |
| 2A.2 eligibility + knowledge | complete, merged to main | `docs/superpowers/specs/2026-05-31-phase-2a-2-eligibility-knowledge-design.md` |
| 2B journey-tracker dashboard | complete, merged to main (PR #3) | `docs/superpowers/plans/2026-06-01-journey-tracker-dashboard.md` |
| 2C persona-E2E layers 1+2a | complete, merged to main (PR #4) | `docs/superpowers/specs/2026-06-01-phase-2c-persona-e2e-design.md` |
| 2C-tail L2b real-stream replay | complete, merged to main (PR #5) | `docs/superpowers/specs/2026-06-02-phase-2c-tail-l2b-design.md` |
| 2C layer 3 (live LLM + user-simulator) + CI | designed/deferred, not started | follow-up section in the 2C-tail spec |
| codebase-review hardening pass (15 findings) | complete, merged to main (PR #7) | this file, below |
| 3A document-ingest pipeline | complete, merged to main (PR #9) | `docs/superpowers/specs/2026-06-03-phase-3a-document-ingest-design.md` + plan; this file, below |

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

Full spec: `docs/superpowers/specs/2026-05-31-journey-tracker-dashboard-design.md`
(`4db6846`); plan: `docs/superpowers/plans/2026-06-01-journey-tracker-dashboard.md`.
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
batch DB files). Design: `docs/superpowers/specs/2026-06-03-phase-3a-document-ingest-design.md`;
plan: `docs/superpowers/plans/2026-06-03-phase-3a-document-ingest.md`; runbook:
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
`docs/superpowers/specs/2026-06-04-phase-3b-approvals-review-design.md`; plan:
`docs/superpowers/plans/2026-06-04-phase-3b-approvals-review.md`. 13 commits (`e454c06`..`095d63e`).

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

## Superseded decisions

- **`Overview.tsx` → `Tracker.tsx`** (2B journey-tracker). `Overview.tsx`'s `SECTION_ORDER`
  was `['employment', 'education', 'family', 'target']` (the design-doc said 'risk', which
  doesn't exist on `CaseFacts`). The tracker renders phases not raw sections; it preserved
  Overview's empty-state copy. `Nav.tsx` still has a stale `#overview` anchor pointing at
  the deleted `Overview.tsx` — fix when touching the sidebar.
- **`v0-stub` prompt removed** (2A.1). `prompts/agent/v0.md` is the live prompt;
  `PROMPT_VERSION = 'v0'` covers the full Phase 2 tool catalog (all six tools registered and
  un-caveated). Reserve a `PROMPT_VERSION` bump for the next generational rewrite.
- **Inngest emit location** — pre-2A.1 it lived in `/api/chat`'s `onFinish`; Task 8 moved
  the loop into `buildAgentTurn`'s `onFinish` (best-effort). Repository stays Inngest-free.
