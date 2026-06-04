# Relomate — Implementation Plan

Companion to `PRD.md`. Read PRD §1–§4 before starting Phase 0.

This plan is **phase-based, not time-boxed.** Each phase has clear deliverables, verification criteria, and a stop-gate before the next phase. Do not skip the verification gate. Hold yourself (and Claude Code) to it.

Estimated calendar time: **8–10 weeks** of focused build, assuming Claude Code does the typing and you do review + decisions.

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
  - Create `tests/personas/eligibility.test.ts` with a `describe.each(loadPersonas())` skeleton (initially `describe.skip` until `evaluateEligibility` is ported). See `docs/superpowers/specs/2026-05-27-persona-library-design.md` §6.2 for the exact shape.
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
  - Overview (eligibility verdict, status, top action items) — **superseded by the 2B journey-tracker dashboard** (`docs/superpowers/specs/2026-05-31-journey-tracker-dashboard-design.md`): the center column becomes a phased journey tracker (read-only projection over case state). Profile folds into the tracker's Documents phase; identity comes from the passport upload, not a standalone section. Activity log + section drill-downs survive in the left sidebar. Build the tracker as the 2B centerpiece — **this is the NEXT build; 2A.1 + 2A.2 are complete and on `origin/main`.**
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

## Phase 4 — Drafted Documents

**Goal:** System drafts cover letter, employer letter, CV. User reviews, regenerates with framing changes, approves.

### Deliverables

- [ ] Tools added:
  - `draft_cover_letter`
  - `draft_employer_letter`
  - `draft_cv`
  - `draft_anabin_justification`
  - `regenerate_draft`
- [ ] Prompt templates in `src/lib/drafting/`:
  - Each draft tool has a structured prompt with case context
  - Output validated by Zod (structural lint)
- [ ] Drafts workspace section:
  - List of drafts with status (drafting / ready / approved)
  - Click to read inline
  - Edit-in-place
  - "Regenerate with..." options (more formal, emphasize return intent, etc.)
  - Approve action
- [ ] Approval workflow for drafts (reuses Phase 3 approval primitive)
- [ ] Multi-language drafts (English primary, German for forms — covered in Phase 5)

### Verification gate

- [ ] Generate cover letter for priya-strong; manual review confirms acceptable tone, no hallucinated facts
- [ ] Generate employer letter; produces a printable template with case data filled in
- [ ] Generate CV in German consulate format; structural lint passes
- [ ] Regeneration produces meaningfully different output
- [ ] Approval round-trips: draft → review → approve → status updates

---

## Phase 5 — VIDEX Form Filling

**Goal:** System fills VIDEX in the background. User never touches the source form. Missing fields surfaced as Tasks.

### Deliverables

- [ ] VIDEX field map in `src/lib/drafting/videx.ts`:
  - 37 fields × AcroForm names + transforms
  - Port AcroForm IDs from `immigration/` repo
- [ ] Tools added:
  - `fill_videx_form` — returns completeness report
  - `request_missing_field`
  - `generate_filled_pdf` — dispatches Inngest worker
  - `generate_submission_package`
- [ ] PDF filling pipeline (port + adapt from `formular/` and `immigration/`):
  - Load blank PDF
  - AcroForm fill via pdf-lib
  - Coordinate-overlay fallback for non-AcroForm
  - Cover page generated with summary
  - Flatten on user approval
- [ ] Forms workspace section:
  - Completeness gauge ("28 of 37 fields filled")
  - Missing-fields list with "Provide" buttons
  - Side-by-side preview when complete
  - Approve action triggers final flattened PDF
- [ ] Conversational gap-filling:
  - Agent surfaces missing fields as structured questions
  - User answers in chat or in form widget
  - Case updates; form re-checked

### Verification gate

- [ ] priya-strong reaches 100% VIDEX completeness through chat + uploads
- [ ] Generated PDF opens in standard PDF viewer; values in correct fields
- [ ] Missing-field flow works end-to-end (intentionally remove a field; verify task created)
- [ ] All existing persona tests still pass

---

## Phase 6 — Quality Assurance

**Goal:** Pre-submission review catches inconsistencies. Submission package ZIP generated.

### Deliverables

- [ ] Tools added:
  - `quality_check` — runs cross-document consistency, completeness, risk flags
  - `generate_submission_package`
- [ ] Quality engine in `src/lib/case/quality.ts`:
  - Cross-document consistency (e.g., name match across passport + employer letter)
  - Completeness (every required document confirmed; every required draft approved; VIDEX 100% filled)
  - Risk flags (employment gaps, weak ties, financial inconsistencies)
- [ ] Quality result rendered as structured output:
  - Blockers (will likely cause refusal)
  - Warnings (may trigger additional doc requests)
  - Recommendations (optional improvements)
- [ ] Submission package generation:
  - ZIP with documents in correct consulate-specified order
  - Cover page with case summary
  - Pre-appointment checklist
  - Stored in R2; download link emailed

### Verification gate

- [ ] Full happy path for priya-strong: intake → docs → drafts → forms → quality check → package
- [ ] Inject inconsistency (mismatched name) — quality check flags it
- [ ] Package ZIP contents match expected order
- [ ] Download link works; email arrives

---

## Phase 7 — Production Readiness

**Goal:** Eval, observability, compliance, polish.

### Deliverables

- [ ] LLM-as-judge eval workflow (Inngest):
  - Triggers on `messages/created` event
  - Scores accuracy, citation, hallucination, tone, tool-use
  - Stores scores; flags low-confidence
- [ ] Sentry integration (frontend + backend + workers)
- [ ] Langfuse self-hosted or hosted; trace every LLM call
- [ ] GDPR endpoints:
  - `DELETE /api/user/me` (hard-delete user + all data)
  - `GET /api/user/me/export` (JSON + ZIP of all data)
  - Tested end-to-end
- [ ] Auto-retention workflow:
  - Daily Inngest job: delete documents > 90d post-completion (unless opted in)
- [ ] Privacy policy + Terms of Service drafted (lawyer-reviewed before launch)
- [ ] Disclaimers embedded in all generated outputs
- [ ] PII masking in logs verified
- [ ] Rate limiting on chat + uploads
- [ ] Persona test suite expanded:
  - Edge cases: contradiction handling, fact-changes-mid-flow, off-scope drift, unsupported scenarios
- [ ] Error handling polished per PRD §15
- [ ] Performance targets met per PRD §16
- [ ] Production deployment to Vercel (fra1)
- [ ] Production Supabase EU
- [ ] Smoke test in production with priya-strong persona

### Verification gate

- [ ] All persona tests passing in CI
- [ ] LLM-as-judge avg score > 0.9 across persona test runs
- [ ] Sentry receiving events
- [ ] Langfuse showing prompt traces
- [ ] GDPR delete + export verified manually
- [ ] Disclaimers present on every output
- [ ] Lawyer sign-off on legal positioning + ToS + privacy policy
- [ ] Production smoke test passes

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

### Per-phase workflow

1. **Plan first, then execute.** At the start of each phase, ask Claude Code to write a plan (use `superpowers:writing-plans` skill or the Plan subagent). Review the plan. Adjust. Then execute.

2. **Verification before completion.** At the end of each phase, run the verification gate. Use `superpowers:verification-before-completion`. Don't accept "I think it works" — require evidence.

3. **One phase at a time.** Don't dump the whole plan into Claude Code. Hand off one phase. Review thoroughly. Move on.

4. **Commit after every working chunk.** Don't let Claude Code work for hours on uncommitted changes. Use git aggressively. Use worktrees for parallel experiments.

5. **Update CLAUDE.md as you go.** Each new pattern, gotcha, or architectural rule discovered → into CLAUDE.md. Future sessions are dramatically more reliable when the rules are codified.

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
