# Relomate — Implementation Plan

Companion to `PRD.md`. **This file is the work SLICING — how the build is cut into agent
sessions.** It is not the live status (that's `CLAUDE.md`'s "Current state"), not the rules
(also `CLAUDE.md`), and not the product spec (`PRD.md`). On conflict, `CLAUDE.md`/`AGENTS.md`
win — see the authority order at the top of `CLAUDE.md`.

Phases 1–3 are historical (deliverable lists, kept for reference); **Phase 4 onward is sliced
into session cards** — one card ≈ one agent session. The current process and the card template
are in "Driving Claude Code through this plan" → "Session-card model" near the bottom. Don't skip
a card's verification gate.

---

## Phase 1 — Foundation

**Goal:** A new repo with auth, DB, Inngest, empty 3-column dashboard, always-visible chat, and a single working tool that writes to the case.

### Deliverables

- [ ] Repo initialized at `/Users/vitalii.kashin/Projects/visa/`
- [ ] Tech stack scaffolded:
  - Next.js 16 App Router + TypeScript strict
  - Tailwind 4 + shadcn/ui
  - Drizzle + Supabase EU
  - Vercel AI SDK + Anthropic provider
  - Inngest configured with local dev
  - Auth.js v5 magic-link via Resend
  - Zod-validated env in `src/lib/env.ts`
  - ESLint flat config + Prettier
  - Vitest set up
- [ ] Drizzle schema for core tables (PRD §4.2):
  - organizations, users, user_identities
  - profiles, profile_changes
  - cases, case_facts, case_changes
  - threads, messages, tool_calls
  - activity_log
  - verification_tokens
- [ ] Provenance wrapper (Zod) implemented in `src/lib/case/schema.ts`
- [ ] **Persona library follow-ups** (carried over from Phase 0 persona-library v1):
  - Create `data/personas/schema.ts` exporting `PersonaSchema` covering the structure used by the 4 existing JSONs at `data/personas/`. Wire it into a CI step that parses every persona at build time.
  - Create `tests/personas/eligibility.test.ts` with a `describe.each(loadPersonas())` skeleton (initially `describe.skip` until `evaluateEligibility` is ported). See `docs/archive/specs/2026-05-27-persona-library-design.md` §6.2 for the exact shape.
  - After porting Nomad's `evaluateEligibility`, unskip the test. Reconcile the open string codes from spec §8 (`anabin_status_unknown` blocker; `zab_statement_required`, `consulate_clarification_recommended`, `proof_of_experience_required` warnings) against the engine's actual output strings; update affected `expected` blocks if codes differ.
- [ ] 3-column workspace shell at `/case/[id]`:
  - Left: nav with section list (placeholder content)
  - Center: section content area (placeholder)
  - Right: always-visible chat panel
- [ ] Streaming chat working with one tool: `update_case`
- [ ] Anonymous → authenticated session continuity
- [ ] Activity log writes on every consequential action
- [ ] CLAUDE.md kept up-to-date with new patterns and gotchas

### Portable assets to copy from Nomad

Copy to the new repo and adapt:

- `config/rules/*.yaml` — all of them (will be used in Phase 2)
- `src/lib/profile/eligibility.ts` → `src/lib/rules/eligibility.ts`
- `src/lib/rules/loader.ts`
- `data/anabin-seed.json`
- `content/knowledge/*.md`
- `prompts/lina/v0.md` → `prompts/agent/v0.md` (heavy rewrite for new architecture)
- `tests/` for rules engine
- `.env` patterns and env validation approach

Already present in the new repo (do not re-copy from Nomad — they were authored fresh in Phase 0):
- `data/personas/*.json` (4 archetype personas)
- `data/personas/README.md`

Do NOT copy: route handlers, chat UI components, renderer registry, Drizzle schema, agent loop in `route.ts`.

### Verification gate

- [ ] `pnpm test` green
- [ ] `pnpm build` green
- [ ] `pnpm lint` clean
- [ ] `pnpm exec tsc --noEmit` clean
- [ ] Live UI smoke: sign in, create case, send a message, see streaming response, observe `update_case` writes a fact, see activity log entry

---

## Phase 2 — Intake & Eligibility

**Goal:** Conversational intake builds a case via tools. Deterministic eligibility runs and shows in the workspace Overview.

### Deliverables

- [ ] Rules YAML loaded at startup, validated with Zod
- [ ] `evaluateEligibility(case, today)` pure function (port from Nomad)
- [ ] Tools added:
  - `read_case`
  - `update_case` (already in Phase 1; refine)
  - `add_case_note`
  - `check_eligibility`
  - `simulate_what_if`
  - `lookup_anabin`
  - `out_of_scope`
- [ ] System prompt v0 written in `prompts/agent/v0.md`:
  - Role + scope + tool rules + citation style + conversation style
- [ ] Context builder in `src/lib/ai/context-builder.ts`:
  - Slices case state for the agent
  - Includes recent messages, top tasks, recent activity
  - Token-budgeted
- [ ] Workspace sections live (read-only display):
  - Overview (eligibility verdict, status, top action items) — **superseded by the 2B journey-tracker dashboard** (`docs/archive/specs/2026-05-31-journey-tracker-dashboard-design.md`): the center column becomes a phased journey tracker (read-only projection over case state). Profile folds into the tracker's Documents phase; identity comes from the passport upload, not a standalone section. Activity log + section drill-downs survive in the left sidebar. Build the tracker as the 2B centerpiece — **this is the NEXT build; 2A.1 + 2A.2 are complete and on `origin/main`.**
  - Profile (identity facts with provenance hover) — *(folds into Documents; see above)*
  - Activity log
- [ ] Persona library v1 in `data/personas/`:
  - 10 personas seeded
  - URL parameter `?persona=<id>` loads a persona into a fresh case
- [ ] Multi-persona end-to-end tests in `tests/personas/`:
  - Each persona exercises a known code path
  - Assertions on eligibility verdict, tool-call sequence, end-state

### Verification gate

- [ ] All 10 persona tests pass
- [ ] Live UI smoke for at least 3 personas (priya-strong, arjun-it-no-degree, out-of-scope-asylum)
- [ ] Eligibility verdict matches hand-verified expectation for each persona
- [ ] Agent never quotes a salary threshold from its own knowledge — always via tool output

---

## Phase 3 — Documents

**Goal:** Upload → async extraction → user review → confirmed case data. Apostille tracking with reminders.

### Deliverables

- [ ] Cloudflare R2 integration in `src/lib/storage/r2.ts` with SSE
- [ ] Upload route handler with size + type validation
- [ ] Inngest workflow: `extractDocumentWorkflow`:
  - Classify (light vision call)
  - Extract (Reducto for forms/IDs; Anthropic vision fallback)
  - Store extracted data with confidence scores
  - Notify user when ready for review
- [ ] Tools added:
  - `request_document_upload`
  - `extract_document` (dispatches Inngest)
  - `classify_document`
  - `confirm_extraction`
  - `generate_document_checklist`
  - `track_apostille_step`
- [ ] Approvals primitive:
  - `approvals` table populated when extraction complete
  - Inline review card in chat with deep link to Documents view
  - Side-by-side review UI in Documents section
  - User approves or corrects; case updates
- [ ] Documents workspace section (full):
  - Three groups: Needed / Awaiting confirmation / Confirmed
  - Drag-and-drop upload anywhere
  - Per-document detail view
- [ ] Apostille tracker:
  - State machine for Karnataka HRD → MEA flow
  - Inngest scheduled reminders
- [ ] Notification integration (Resend):
  - "Your passport extraction is ready for review"
  - "Apostille step due"

### Verification gate

- [ ] Upload a real passport PDF — extraction returns plausible data
- [ ] Upload a real bank statement — extraction returns plausible data
- [ ] Confidence-low fields surface in manual-entry mode
- [ ] Approval flow round-trips: extraction → review → confirm → case updated
- [ ] Apostille reminder fires correctly (test with shortened wait)
- [ ] All previous persona tests still pass; one new persona test exercises full doc flow

---

## Phase 4C-F — Firm Foundation Pivot

**Goal:** Move the product foundation from applicant-owned cases to firm-operated cases before resuming package automation.

**Decision record:** `docs/strategy/firm-first-pivot.md`. This phase supersedes the old "4C then VIDEX" priority. Resume 4C/VIDEX only after firm ownership, review, task, portal, and Canada/Toronto scaffolding are in place.

### Card 4C-F-1 — RBAC + organization-owned cases
- **Goal:** Establish organization ownership and central case authorization without breaking the current applicant-compatible flow.
- **Tasks:**
  - [x] Add `organization_members` with role/status membership rows.
  - [x] Add firm ownership and assignment columns on `cases`.
  - [x] Backfill existing users/cases in a migration.
  - [x] Keep legacy `cases.user_id` as the profile/applicant compatibility key while making `cases.organization_id` the ownership key.
  - [x] Add `src/lib/auth/authorization.ts` and route case/chat/document access through it.
  - [x] Update auth/session/test seeds to create membership rows.
  - [x] Update handover docs.
- **Verify:** `pnpm exec tsc --noEmit` + `node --env-file=.env.local node_modules/vitest/vitest.mjs run --no-file-parallelism tests/db-schema.test.ts tests/case/repository.test.ts tests/auth/authorization.test.ts tests/api/chat.test.ts tests/api/documents-upload-url.test.ts tests/api/documents-get.test.ts tests/api/documents-finalize.test.ts`.
- **Deferred:** participant table, role-aware approval actions, real task table, firm console, applicant portal split.

### Card 4C-F-2 — Case participants + visibility primitives
- **Goal:** Add per-case participants and visibility values so applicant, employer, consultant, reviewer, and ops access can diverge from organization membership.
- **Tasks:**
  - [x] Add `case_participants` with participant role, user link or invited email, invitation status, visibility, relation metadata, timestamps.
  - [x] Add shared visibility enum/constants (`internal`, `client_visible`, `shared`) in a typed module.
  - [x] Seed primary applicant participant on case creation.
  - [x] Add repository helpers for listing/upserting participants.
  - [x] Update authorization to account for case participants where appropriate.
  - [x] Tests for consultant/reviewer/applicant/employer participant access boundaries.
- **Verify:** `pnpm exec tsc --noEmit` + `node --env-file=.env.local node_modules/vitest/vitest.mjs run --no-file-parallelism tests/db-schema.test.ts tests/case/repository.test.ts tests/case/participants.test.ts tests/auth/authorization.test.ts tests/auth/merge.test.ts tests/api/chat.test.ts tests/api/documents-upload-url.test.ts tests/api/documents-get.test.ts tests/api/documents-finalize.test.ts`.
- **Deferred:** full applicant portal UI; review inbox.

### Card 4C-F-3 — Review inbox + role-aware approvals
- **Goal:** Turn approvals into firm review work items with assignee, required role, due date, and escalation status.
- **Tasks:**
  - [ ] Extend `approvals` with required role, assignee, due date, escalation status, and visibility.
  - [ ] Preserve applicant confirmation vs. consultant/reviewer approval as distinct semantics.
  - [ ] Update document/draft review action cores to use role-aware case authorization.
  - [ ] Add review inbox repository queries.
  - [ ] Add tests for applicant cannot approve firm-ready drafts; consultant/reviewer can.
- **Verify:** `tsc --noEmit` + serial vitest on `tests/approvals tests/documents tests/drafting tests/api`.
- **Deferred:** full firm console UI; SLA workflows.

### Card 4C-F-4 — Real tasks foundation
- **Goal:** Replace tracker-only implied work with mutable task records that can be assigned, due, visible, and blocking.
- **Tasks:**
  - [ ] Add `tasks` and task change/audit support.
  - [ ] Task fields: assignee, due date, status, source, visibility, blocking, related subject.
  - [ ] Repository helpers and pure view model for top tasks.
  - [ ] Generate tasks from document/draft/review states without duplicating on repeated reads.
  - [ ] Tests for visibility and blocking behavior.
- **Verify:** `tsc --noEmit` + serial vitest on `tests/tasks tests/journey tests/api`.
- **Deferred:** SLA escalation worker; firm console charts.

### Card 4C-F-5 — Firm console + applicant portal split
- **Goal:** Separate the consultant-first workspace from applicant-safe intake/upload/review surfaces.
- **Tasks:**
  - [ ] Firm console route with assigned cases, unassigned cases, review inbox, blocked/overdue cases.
  - [ ] Consultant case workspace keeps chat and internal views.
  - [ ] Applicant portal exposes only applicant-safe tasks/uploads/confirmations/messages.
  - [ ] Add route tests for applicant cannot access internal console/workspace surfaces.
  - [ ] Keep existing case page usable while the split lands.
- **Verify:** `tsc --noEmit` + focused component/route vitest; manual local smoke if UI changes are significant.
- **Deferred:** ops analytics charts beyond basic counts.

### Card 4C-F-6 — Firm knowledge + Canada/Toronto scaffolding
- **Goal:** Add firm knowledge placeholders and Canada/Toronto config/personas without treating unverified checklist details as production truth.
- **Tasks:**
  - [ ] Firm knowledge tables/config scaffolding with source metadata and staleness.
  - [ ] Canada/Toronto consulate/source scaffolding from official `canada.diplo.de` sources.
  - [ ] Mark Canada checklist/rule details `verifiedByUser: false` until user verifies.
  - [ ] Add four synthetic Toronto personas plus firm role/assignment metadata for existing personas.
  - [ ] Update persona tests to load role metadata.
- **Verify:** `tsc --noEmit` + serial vitest on `tests/personas tests/rules tests/journey`.
- **Deferred:** retrieval over firm playbooks; production Canada checklist until user verification.

---

## Phase 4 — Drafted Documents

**Goal:** System drafts cover letter, employer letter, CV, Anabin justification. User reviews, regenerates with framing changes, approves.

**Done:** 4A cover letter (PR #15), 4B employer letter + CV (PR #16). Drafts foundation (`drafts` table, `makeDraftRepository`, `generateDraftHandler`, polymorphic review route, `approvals` `subjectType:'draft'`, per-type versioning) is settled — 4C cards reuse it.

### Card 4C-1 — Anabin justification draft
- **Goal:** Add `draft_anabin_justification` as a fourth draft type for Anabin-`unknown`/ZAB cases.
- **Tasks:**
  - [ ] Add `anabin_justification` to the draft type union + a Zod content schema in `src/lib/drafting/types.ts`.
  - [ ] Add `draft_anabin_justification/v0` prompt; wire into `generateDraftByType`.
  - [ ] Register `draft_anabin_justification` tool BEFORE `lookup_anabin` (single cache-control breakpoint stays last).
  - [ ] Add the fourth Drafts tracker row; only `approved` counts complete.
  - [ ] Update agent prompt/tool catalog + handover docs.
- **Verify:** `pnpm exec tsc --noEmit` + serial vitest on `tests/drafting tests/ai/draft_* tests/ai/agent-turn.test.ts tests/journey/compute.test.ts`.
- **Deferred:** regeneration; package gate.

### Card 4C-2 — `regenerate_draft` with framing
- **Goal:** Let the user regenerate any existing draft with framing instructions (more formal, emphasize return intent, etc.).
- **Tasks:**
  - [ ] `regenerate_draft` tool: takes `draftId` + framing instruction, dispatches `draft.requested` with the instruction, bumps version.
  - [ ] Thread framing instruction through `generateDraftByType` into each prompt.
  - [ ] Review route surfaces version history (read-only list; latest is reviewable).
  - [ ] "Regenerate with…" affordance in the draft review UI.
  - [ ] Update prompt/tool catalog (`lookup_anabin` stays last) + handover docs.
- **Verify:** `tsc --noEmit` + serial vitest on `tests/drafting tests/ai/agent-turn.test.ts tests/inngest/generate-draft.test.ts`.
- **Deferred:** package gate; live content-quality eval (Phase 7).
- **Decisions:** version-history UX — list vs. diff vs. latest-only. Resolve in-session from the existing review-route shape; brainstorm only if a real fork appears.

### Card 4C-3 — Drafts completeness signal
- **Goal:** Expose "all required drafts approved" as a tracker signal (consumed by the Phase 6 package gate).
- **Tasks:**
  - [ ] `computeJourneyProgress` Drafts phase reports approved-count vs. required-by-route.
  - [ ] Pure helper `requiredDraftsForRoute(verdict)` (config-driven; no hardcoded list).
  - [ ] Update journey tests for the live count.
- **Verify:** `tsc --noEmit` + serial vitest on `tests/journey tests/drafting`.
- **Deferred:** the actual blocking gate lives in Phase 6 (`quality_check`); this card only surfaces the signal.

---

## Phase 5 — VIDEX Form Filling

**Goal:** System fills VIDEX in the background. User never touches the source form. Missing fields surfaced as Tasks.

**Sliced into 4 cards** — the field-map port + PDF pipeline + Forms UI + gap-filling are distinct file sets and each is a session on its own. 5-1 is the foundation the rest build on.

### Card 5-1 — VIDEX field map + completeness engine
- **Goal:** Port the 37-field VIDEX map and a pure completeness report (no PDF, no UI yet).
- **Tasks:**
  - [ ] `src/lib/drafting/videx.ts`: 37 fields × AcroForm names + transforms; port AcroForm IDs from `immigration/` repo.
  - [ ] Each field maps to a CaseFacts/Profile leaf path (validated via `validateLeafPath`).
  - [ ] Pure `assessVidexCompleteness(case) → { filled, missing[], total }`.
  - [ ] `fill_videx_form` tool returns the completeness report (no PDF dispatch).
  - [ ] Unit tests: priya-strong completeness, each transform, missing-field detection.
- **Verify:** `tsc --noEmit` + serial vitest on `tests/drafting/videx*`.
- **Deferred:** PDF generation (5-2), Forms UI (5-3), gap-filling (5-4).
- **Decisions:** confirm the source repo (`immigration/` vs `formular/`) actually holds current AcroForm IDs before porting — lookup, not brainstorm.

### Card 5-2 — PDF filling pipeline (Inngest)
- **Goal:** Generate a filled, previewable PDF from the completeness map.
- **Tasks:**
  - [ ] PDF pipeline (port + adapt `formular/`/`immigration/`): load blank → AcroForm fill via pdf-lib → coordinate-overlay fallback → cover page with summary.
  - [ ] `generate_filled_pdf` tool dispatches an Inngest worker (returns job id; agent doesn't await — rule 13).
  - [ ] Worker stores draft PDF in R2; flatten only on approval.
  - [ ] Reuse the `drafts`/`approvals` foundation (`subjectType:'draft'`, type `videx`).
- **Verify:** `tsc --noEmit` + serial vitest on `tests/drafting/videx-pdf* tests/inngest`; manual: generated PDF opens, values in correct fields.
- **Deferred:** Forms UI (5-3); gap-filling (5-4).

### Card 5-3 — Forms workspace section
- **Goal:** Surface VIDEX completeness + preview + approval in the workspace.
- **Tasks:**
  - [ ] Forms section: completeness gauge ("28 of 37"), missing-fields list with "Provide" buttons, side-by-side preview when complete.
  - [ ] Approve action triggers the final flattened PDF (5-2 worker).
  - [ ] Nav wiring (follow the settled section-host pattern).
- **Verify:** `tsc --noEmit` + serial vitest on `tests/components` (forms section, gauge).
- **Deferred:** conversational gap-filling (5-4).

### Card 5-4 — Conversational gap-filling
- **Goal:** Agent surfaces missing VIDEX fields as structured questions; answers update the case and re-check the form.
- **Tasks:**
  - [ ] `request_missing_field` tool surfaces missing fields as structured questions.
  - [ ] User answers in chat (or the form widget from 5-3) → `update_case` → form re-checked.
  - [ ] Renderer for the structured missing-field prompt.
  - [ ] Update prompt/tool catalog (`lookup_anabin` stays last) + handover docs.
- **Verify:** `tsc --noEmit` + serial vitest on `tests/ai tests/drafting/videx*`; persona E2E: priya-strong reaches 100% via chat + uploads; remove a field → task created.

### Phase 5 verification gate (after all 4 cards)
- [ ] priya-strong reaches 100% VIDEX completeness through chat + uploads
- [ ] Generated PDF opens in standard PDF viewer; values in correct fields
- [ ] Missing-field flow works end-to-end (intentionally remove a field; verify task created)
- [ ] All existing persona tests still pass

---

## Phase 6 — Quality Assurance

**Goal:** Pre-submission review catches inconsistencies. Submission package ZIP generated.

**Sliced into 2 cards** — the quality engine (pure logic + renderer) and the package generation (ZIP + R2 + email worker) are separate file sets. 6-1 is the completeness gate that 6-2 requires.

### Card 6-1 — Quality engine + `quality_check`
- **Goal:** Pure pre-submission review: consistency, completeness, risk flags, rendered as structured output.
- **Tasks:**
  - [ ] `src/lib/case/quality.ts` (pure, like the eligibility engine): cross-document consistency (name match across passport + employer letter), completeness (every required doc confirmed, every required draft approved per 4C-3, VIDEX 100%), risk flags (employment gaps, weak ties, financial inconsistencies — config-driven, rule 7).
  - [ ] `quality_check` tool → `{type:'quality_result',version:1,data}` with Blockers / Warnings / Recommendations.
  - [ ] Renderer for `quality_result`.
  - [ ] Update prompt/tool catalog (`lookup_anabin` stays last) + handover docs.
- **Verify:** `tsc --noEmit` + serial vitest on `tests/case/quality* tests/ai tests/components/renderers.test.ts`; inject mismatched name → flagged.
- **Deferred:** package ZIP (6-2).

### Card 6-2 — Submission package generation
- **Goal:** Generate the downloadable submission package once quality passes.
- **Tasks:**
  - [ ] `generate_submission_package` tool dispatches an Inngest worker (gated on 6-1 quality clear; rule 13).
  - [ ] Worker builds ZIP: documents in consulate-specified order (config-driven) + cover page (case summary) + pre-appointment checklist.
  - [ ] Store in R2; email download link via Resend.
- **Verify:** `tsc --noEmit` + serial vitest on `tests/inngest tests/case/package*`; manual: ZIP order correct, download link works, email arrives.
- **Decisions:** consulate document order source — confirm it's in `config/rules/` (consulates/documents YAML) before coding; add if missing.

### Phase 6 verification gate (after both cards)
- [ ] Full happy path for priya-strong: intake → docs → drafts → forms → quality check → package
- [ ] Inject inconsistency (mismatched name) — quality check flags it
- [ ] Package ZIP contents match expected order
- [ ] Download link works; email arrives

---

## Phase 7 — Production Readiness

**Goal:** Eval, observability, compliance, polish.

**Sliced into 4 cards** by coherence — these are independent file sets that share almost nothing, so one session each. 7-1 (eval) and the 2C-layer-3 live-LLM follow-up overlap; do 7-1 on top of the existing deterministic CI gate (PR #14), not mixed into it.

### Card 7-1 — LLM-as-judge eval workflow
- **Goal:** Score every assistant turn for quality; flag low-confidence.
- **Tasks:**
  - [ ] Inngest function triggered on `messages/created` (or the existing turn event).
  - [ ] Judge prompt (`prompts/eval/v0.md`) scores accuracy, citation, hallucination, tone, tool-use (Haiku judge per stack).
  - [ ] Store scores (new table or column); flag low-confidence.
  - [ ] Wire into CI nightly (build on the deterministic gate; the 2C-layer-3 follow-up rides here).
- **Verify:** `tsc --noEmit` + serial vitest on `tests/eval tests/inngest`; judge avg > 0.9 across persona runs.

### Card 7-2 — Observability (Sentry + Langfuse)
- **Goal:** Errors and LLM traces visible in prod.
- **Tasks:**
  - [ ] Sentry: frontend + backend + workers.
  - [ ] Langfuse: trace every LLM call (self-hosted per stack).
  - [ ] Verify PII masking holds in both (no passport/bank numbers in traces or events).
- **Verify:** `tsc --noEmit`; manual: Sentry receiving events, Langfuse showing traces, masking confirmed.

### Card 7-3 — GDPR + retention compliance
- **Goal:** Data-rights endpoints + auto-retention.
- **Tasks:**
  - [ ] `DELETE /api/user/me` — hard-delete user + all data (mind the anon→authed merge tombstones; FK `ON DELETE no action` on audit rows — see auth gotchas).
  - [ ] `GET /api/user/me/export` — JSON + ZIP of all data.
  - [ ] Daily Inngest retention job: delete documents > 90d post-completion unless opted in.
  - [ ] Disclaimers embedded in all generated outputs.
- **Verify:** `tsc --noEmit` + serial vitest on `tests/api/user* tests/inngest`; manual: delete + export round-trip.
- **Decisions:** hard-delete vs. tombstone for the authed user given the merge FK constraints — resolve against `promoteToAuthed`'s existing tombstone logic; brainstorm only if a real conflict surfaces.

### Card 7-4 — Hardening + deploy
- **Goal:** Rate limiting, perf, expanded personas, production deploy + smoke.
- **Tasks:**
  - [ ] Rate limiting on chat + uploads.
  - [ ] Persona suite expanded: contradiction handling, fact-changes-mid-flow, off-scope drift, unsupported scenarios.
  - [ ] Error handling per PRD §15; performance targets per PRD §16.
  - [ ] Production deploy: Vercel `fra1`, Supabase EU; smoke test with priya-strong.
- **Verify:** full persona suite green in CI (serial); production smoke passes.

### Phase 7 verification gate (after all cards) — non-code items
- [ ] Privacy policy + ToS drafted and **lawyer-reviewed** (legal sign-off on positioning + ToS + privacy policy) — owner task, not an agent card.
- [ ] All persona tests passing in CI; LLM-as-judge avg > 0.9; Sentry + Langfuse live; GDPR delete/export verified; disclaimers on every output; production smoke passes.

---

## Phase 8 — Beta (Post-MVP, Pre-Launch)

**Goal:** 5–10 real users walking through the product end-to-end before public launch.

### Deliverables

- [ ] 5–10 invited beta users (from Phase 0 user interviews)
- [ ] Feedback capture mechanism (simple form or recorded calls)
- [ ] Iteration on top 3 friction points discovered
- [ ] Pricing decision: per-application vs subscription vs tiered
- [ ] Stripe skeleton (entitlements + paywall hooks; not yet enforced)

### Verification gate

- [ ] At least 3 beta users complete a full case end-to-end
- [ ] No critical bugs in production for 1 week
- [ ] Decision made on launch pricing and timing

---

## Driving Claude Code through this plan

A few practical rules. These matter more than they look.

### Session-card model (current process)

Phases 4C onward are pre-sliced into **session cards**. Each card is sized for one agent session (target ≤250k tokens) and is self-contained: an agent reads the auto-loaded `CLAUDE.md`/`AGENTS.md` plus its card, and executes — **no per-phase brainstorm, no separate spec or plan doc.** The architecture is already pinned in the handover docs; a card carries only what's specific to the slice. (Early phases 1–3 used brainstorm → spec → heavy plan because the architecture was unsettled; it's now codified, so that overhead no longer pays off. 4A shipped on a 34-line card — that's the target weight.)

**Thin by default, brainstorm by exception.** Run `superpowers:brainstorming` or write a spec ONLY when a card's `Decisions:` line names a genuinely unresolved *architectural* fork. A `Decisions:` line that just says "check current code state" is an in-session lookup, not a brainstorm. A card with no `Decisions:` line is settled — go straight to TDD.

**Per-card loop:**
1. Read the card + handover docs. If `Decisions:` names an unresolved fork, resolve it first; otherwise skip planning entirely.
2. TDD the tasks (`superpowers:test-driven-development`). Commit per working chunk (conventional commits).
3. Run the card's `Verify` command. Evidence before "done" (`superpowers:verification-before-completion`).
4. Update `CLAUDE.md` + `AGENTS.md` (keep load-bearing directives in sync) + `docs/context-history.md` with any new gotcha/decision; tick the card.

**Card template:**
```
### Card <id> — <title>
- **Goal:** one sentence.
- **Tasks:** 5–10 checkboxes, each a concrete deliverable.
- **Verify:** exact `tsc --noEmit` + serial vitest command (scoped paths).
- **Deferred:** what this card explicitly does NOT do.
- **Decisions:** unresolved forks — OMIT the line entirely if none.
```

Cards that touch disjoint files may run in parallel (`superpowers:dispatching-parallel-agents` + worktrees). **Live phase status is in `CLAUDE.md`'s current-state section, not here** — this file is the slicing, CLAUDE.md is the "where we are."

**Sizing rule (≤250k per card).** Token count of a future session can't be measured up front, so size by proxy: a card should be **one coherent capability, touch ~5–10 files, and rest on settled architecture.** That fits ≤250k with room for TDD iteration and test output. Split a card if it (a) ports a large external artifact (e.g. the 37-field VIDEX map), (b) bundles two capabilities that don't share files, or (c) needs to read a wide swath of existing code before writing. The phase cards below are already split to this rule — if a card still feels heavy in-session, split it again and note the new slice here.

### When to spawn a subagent

- **Plan agent** for design questions ("how should I structure the apostille tracker?")
- **Explore agent** for research ("find every place where eligibility is read so I can add caching")
- **General-purpose agent** for parallel independent tasks ("port these 5 unrelated YAML files in parallel")

### Red flags during build

- Claude Code wants to add LangChain, custom abstractions, or a new framework. Push back.
- Claude Code adds `any` types. Reject.
- Claude Code wants to commit without tests passing. Reject.
- Claude Code suggests skipping a verification gate. Reject.
- Claude Code generates new tools without writing prompt-style descriptions. Reject.
- Claude Code wants to write code that quotes a salary threshold or fee directly. Reject — must be in YAML.

---

## Stretch / post-MVP backlog

- WhatsApp channel (Twilio integration; ~1–2 weeks)
- Native mobile (React Native via Expo; ~6–10 weeks)
- Lawyer-marketplace tier
- Renewal flow (case-of-cases pattern)
- Family reunion sub-cases
- Second consulate (Mumbai or Chennai)
- Second visa type (Job Seeker or Opportunity Card)
- Multi-language UI (Hindi, then others)
- Appointment monitoring (passive; high-fragility)

Each of these is a contained project, not a rewrite. The MVP architecture is designed so they're additions, not redesigns.
