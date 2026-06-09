# Relomate — Product Requirements Document

**Status:** Draft v1
**Owner:** Vitalii Kashin
**Last updated:** 2026-06-09
**Target:** MVP build over ~8–10 weeks

This document is the source of truth for building Relomate. It is structured for Claude Code consumption — sections are numbered so they can be referenced as "implement §X.Y."

Companion files:
- `CLAUDE.md` — quick-reference behavior rules and tech stack
- `IMPLEMENTATION_PLAN.md` — phase-by-phase build plan

---

## 1. Product Vision

### 1.1 What Relomate Is

Relomate is an AI-native immigration operating system for firms handling **EU Blue Card to Germany** cases. Consultants, reviewers, operations managers, applicants, and employer contacts work around one durable case file. The system builds structured facts, runs deterministic eligibility checks, drafts artifacts (cover letter, employer letter, CV, VIDEX visa application), prepares the submission package, and routes consequential outputs through human review.

The product is the **firm-operated case**, not the chat. Chat is one interaction surface in the consultant workspace, but the case file, review queue, task list, audit trail, and firm console are the spine.

### 1.2 What Relomate Is NOT

- A chatbot. The product is a workspace where the chat is one panel.
- A legal advice engine. The system prepares documents and provides information; it does not give legal opinions.
- An autonomous AI that submits applications. Every consequential output is reviewed by the responsible human role.
- A workflow tool with hardcoded state machines. The user is not forced through wizards or "next step" buttons. They describe what they want; the agent makes it happen.

### 1.3 Core Design Principle

> **Deterministic systems own legal/business truth. The agent owns reasoning, drafting, and orchestration. Responsible humans own approval.**

Concretely:
- **Rules engine** (deterministic) owns eligibility, document requirements, deadlines, validation, salary thresholds, ISCO codes.
- **Agent** (LLM-driven) owns conversation, gap-finding, document drafting, explanation, tool selection.
- **Applicant/firm roles** own explicit confirmation and approval of any extracted data, drafted document, generated form, applicant-facing message, or package gate. Applicant confirmation is distinct from consultant/reviewer approval.

### 1.4 Long-Term Vision

A multi-country, multi-visa case-management platform that handles the full lifecycle of immigration: eligibility → application → renewal → permanent residency → citizenship. The MVP is one slice (Germany Blue Card); the architecture must not preclude expansion.

---

## 2. Scope (Locked)

### 2.1 MVP Scope

| Parameter | Value |
|---|---|
| Visa | EU Blue Card (Germany) |
| Source/residence flow | India/Bengaluru + Canada/Toronto |
| Consulate | Bengaluru and Toronto |
| User language | English only |
| Form variant | German VIDEX-Visa long-stay form |
| Channels | Firm-first web app + applicant portal (architected for WhatsApp/mobile later) |
| Personas | Multi-persona test library with firm roles and India/Canada scenarios |

### 2.2 Out of Scope for MVP

- Other German visas (Skilled Worker, Job Seeker, Opportunity Card)
- Other source/residence countries beyond India and Canada
- Other German consulates beyond Bengaluru and Toronto
- Other destination countries
- Multi-language UI (English only at launch)
- Payment processing (architecture-ready, not built)
- Native mobile apps (web-only at launch)
- WhatsApp / SMS / Email-as-channel (notifications via email only)
- Appointment booking automation (legal/operational risk; deferred indefinitely)
- Appointment monitoring (deferred to v2 at earliest)
- Real-time collaborative editing
- Automatic sending of applicant/employer communications without firm-configured approval policy

### 2.3 Deferred-But-Architecturally-Aware

The architecture must support these without rewrites when added later:

- **Multi-channel.** `channel` field on every message. Agent loop is channel-agnostic.
- **Multi-persona / multi-tenant.** Every record carries `userId` and `organizationId`.
- **Multi-visa.** Rules and knowledge keyed by `(country, visaType)`.
- **Multi-country source.** Document chain rules per source country.
- **Native mobile.** API-first design; shared types package; mobile = different client over same API.
- **Payments.** Stripe-ready hooks; entitlements model from day one.

---

## 3. Architecture

### 3.1 High-Level Shape

```
┌─────────────────────────────────────────────────────────────┐
│  Web App (Next.js 16 + React + Tailwind + shadcn/ui)        │
│  - 3-column dashboard: Nav | Workspace | Chat (always on)   │
│  - Streaming chat with tool-call status                     │
│  - Inline approval flows for extracted data + drafts        │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS / SSE
┌──────────────────────▼──────────────────────────────────────┐
│  API Layer (Next.js Route Handlers)                          │
│  - Auth (Auth.js v5 magic-link via Resend)                   │
│  - Case CRUD                                                 │
│  - Chat endpoint (streaming)                                 │
│  - Webhook receivers (Inngest, Reducto, etc.)                │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│  Agent Loop (Vercel AI SDK)                                  │
│  - Single agent with ~25 tools                               │
│  - Context builder reads case state                          │
│  - Streaming tool-calls + responses                          │
│  - Single-threaded writes via update_case                    │
└──┬─────────────────┬─────────────────┬────────────────┬────┘
   │                 │                 │                │
┌──▼──────────┐  ┌──▼──────────┐  ┌──▼──────────┐  ┌──▼────────┐
│ Tool layer  │  │ Rules       │  │ Workflow    │  │ LLM       │
│ ~25 tools   │  │ engine      │  │ engine      │  │ providers │
│ (read,      │  │ (YAML rules,│  │ (Inngest:   │  │ (Claude   │
│  draft,     │  │  pure fns)  │  │  durable    │  │  Sonnet,  │
│  extract,   │  │             │  │  steps,     │  │  Haiku;   │
│  generate)  │  │             │  │  cron,      │  │  swappable│
│             │  │             │  │  retries)   │  │  via SDK) │
└──┬──────────┘  └─────────────┘  └──┬──────────┘  └───────────┘
   │                                 │
┌──▼─────────────────────────────────▼──────────────────────────┐
│  Background Workers (Inngest functions)                        │
│  - Document extraction (Reducto / Claude vision)               │
│  - PDF generation (pdf-lib in-process)                         │
│  - Scheduled reminders                                         │
│  - LLM-as-judge eval                                           │
└──────────────────────┬─────────────────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────────────────┐
│  Storage                                                        │
│  - Postgres (Supabase EU): cases, profiles, docs, tasks,       │
│    messages, approvals, activity log, entitlements             │
│  - Object storage (Cloudflare R2): document files, generated   │
│    PDFs, submission packages                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Hard-to-Reverse Decisions (Locked)

1. **EU hosting.** Vercel `fra1`, Supabase EU, Cloudflare R2 EU jurisdiction. Anthropic API used with Zero Data Retention addendum.

2. **TypeScript everywhere.** Frontend, backend, workers. Shared Zod schemas as the source of truth.

3. **Single agent, many tools.** No multi-agent orchestration. Cognition's "single-threaded writes" rule: only the agent writes to the case; tools return data.

4. **Rules in YAML, never in prompts.** The LLM is forbidden from quoting numbers (salary thresholds, fees, processing times). It calls a tool that reads YAML.

5. **Workflow engine = Inngest.** Durable steps, scheduled jobs, wait-for-event for human approvals. Every operation that takes more than a second runs through Inngest.

6. **Vercel AI SDK as the LLM abstraction.** Provider-agnostic. Swap Claude → GPT → Mistral by changing one line.

7. **Profile + Case + Document with provenance.** Every fact carries `value`, `source`, `confidence`, `sourceTurnId`, `updatedAt`. Audit log is append-only.

8. **Approvals are explicit primitives.** Extracted data, drafted documents, and generated forms are "drafts" until the user approves. Workflow pauses on approval gates.

9. **Channel field on every message.** Always `'web'` in v1. Agent doesn't switch on channel.

10. **Single Next.js app, no monorepo (yet).** Add `packages/shared/` only when a second client (mobile) exists.

11. **Multi-persona-ready.** Every test persona is a seeded case. User can spin up any persona via URL parameter for testing.

12. **System prompt versioning.** Prompts live in `prompts/`, version-controlled. Every assistant message logs `prompt_version`.

### 3.3 Repository Layout

```
visa/
├── README.md
├── PRD.md                          # This document
├── CLAUDE.md                       # Behavior rules, quick-reference
├── IMPLEMENTATION_PLAN.md          # Phase-by-phase build plan
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── next.config.ts
├── vercel.json                     # Region pin (fra1)
├── drizzle.config.ts
├── vitest.config.ts
├── eslint.config.mjs
├── .env.example
│
├── prompts/
│   ├── agent/v0.md                 # Main agent system prompt
│   └── eval/v0.md                  # LLM-as-judge prompt
│
├── config/
│   └── rules/
│       ├── blue-card.yaml          # Salary thresholds, ISCO groups
│       ├── family-reunification.yaml
│       ├── consulates.yaml         # Bengaluru specifics
│       ├── apostille.yaml
│       ├── shortage-occupations.yaml
│       └── documents.yaml          # Document checklist as data
│
├── content/
│   └── knowledge/                  # Markdown chunks for retrieval
│       ├── README.md
│       ├── blue-card-overview.md
│       └── ...                     # ~25–40 chunks
│
├── data/
│   ├── anabin-seed.json            # Indian institutions
│   └── personas/                   # Test persona seeds
│       ├── priya-strong.json
│       ├── arjun-it-no-degree.json
│       ├── rahul-recent-grad.json
│       └── ...
│
├── drizzle/
│   └── migrations/
│
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                # Landing
│   │   ├── case/[id]/page.tsx      # Main 3-column workspace
│   │   ├── api/
│   │   │   ├── chat/route.ts
│   │   │   ├── case/...
│   │   │   ├── documents/upload/route.ts
│   │   │   ├── inngest/route.ts    # Inngest webhook
│   │   │   └── auth/...
│   │   └── (auth)/signin/...
│   │
│   ├── components/
│   │   ├── ui/                     # shadcn primitives
│   │   ├── workspace/              # Dashboard sections
│   │   │   ├── Layout.tsx          # 3-column
│   │   │   ├── Nav.tsx             # Left nav
│   │   │   ├── Overview.tsx
│   │   │   ├── ProfileView.tsx
│   │   │   ├── DocumentsView.tsx
│   │   │   ├── DraftsView.tsx
│   │   │   ├── TimelineView.tsx
│   │   │   ├── TasksView.tsx
│   │   │   └── ActivityView.tsx
│   │   ├── chat/                   # Always-visible chat
│   │   │   ├── ChatPanel.tsx
│   │   │   ├── MessageList.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── ToolStatus.tsx
│   │   │   └── ChatInput.tsx
│   │   ├── approvals/              # Inline approval flows
│   │   ├── auth/
│   │   └── landing/
│   │
│   ├── lib/
│   │   ├── db/
│   │   │   ├── client.ts           # Drizzle
│   │   │   ├── schema.ts           # Drizzle tables
│   │   │   └── queries.ts
│   │   ├── ai/
│   │   │   ├── provider.ts         # Vercel AI SDK setup
│   │   │   ├── system-prompt.ts
│   │   │   ├── context-builder.ts  # Slice case state for agent
│   │   │   └── tools/              # ~25 tool definitions
│   │   ├── case/
│   │   │   ├── schema.ts           # Zod Case schema
│   │   │   ├── repository.ts       # Read/write with provenance
│   │   │   └── state-machine.ts    # Case status derivation
│   │   ├── rules/
│   │   │   ├── loader.ts
│   │   │   └── eligibility.ts      # Pure function
│   │   ├── documents/
│   │   │   ├── extract.ts          # Reducto / Claude vision
│   │   │   ├── classify.ts
│   │   │   └── apostille-tracker.ts
│   │   ├── drafting/
│   │   │   ├── cover-letter.ts
│   │   │   ├── employer-letter.ts
│   │   │   ├── cv.ts
│   │   │   └── videx.ts            # VIDEX form filling
│   │   ├── pdf/
│   │   │   ├── fill.ts             # AcroForm + overlay
│   │   │   ├── flatten.ts
│   │   │   └── package.ts          # ZIP generation
│   │   ├── knowledge/
│   │   │   ├── loader.ts
│   │   │   └── retriever.ts
│   │   ├── workflows/              # Inngest functions
│   │   │   ├── extract-document.ts
│   │   │   ├── send-reminder.ts
│   │   │   ├── eval-message.ts
│   │   │   └── ...
│   │   ├── eval/
│   │   │   ├── judge.ts            # LLM-as-judge
│   │   │   └── persona-tests.ts
│   │   ├── notifications/
│   │   │   ├── email.ts            # Resend
│   │   │   └── channel.ts          # Channel-agnostic dispatch
│   │   ├── auth/
│   │   ├── storage/
│   │   │   └── r2.ts
│   │   ├── env.ts                  # Zod-validated env
│   │   └── utils.ts
│   │
│   └── types/
│       ├── case.ts
│       ├── document.ts
│       ├── task.ts
│       ├── approval.ts
│       └── messages.ts
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── personas/                   # End-to-end persona walkthroughs
│
└── scripts/
    ├── seed-personas.ts
    └── verify-knowledge.ts
```

---

## 4. Data Model

### 4.1 Core Entities

**Organization** — every user belongs to one. v1: each user gets a personal org of size 1.

**User** — authenticated person. Anonymous users supported until first save.

**UserIdentity** — `(provider, provider_id)` tuple. v1: email_magiclink only.

**Case** — the central entity. One case = one Blue Card application. A user can have multiple cases over time (renewal, family reunion).

**Profile** — user-level identity facts (name, DOB, nationality). Reused across cases.

**CaseFacts** — case-specific structured state (current employment, family situation at time of application, target move date, eligibility verdict). Each leaf has provenance.

**Document** — uploaded file + extracted data + confirmation status. Belongs to a case.

**Draft** — system-generated document (cover letter, employer letter, CV, VIDEX). Has version history.

**Task** — anything the user needs to do. Auto-generated by the workflow engine.

**Approval** — pending user review of an extracted/drafted/generated artifact.

**Notification** — email/etc. sent to the user. Logged for audit.

**ActivityLog** — append-only history of every consequential action.

**Thread + Message** — chat history. Append-only. `channel` field on every message.

**Entitlement** — capability granted to a user (e.g., `cover_letter_drafting`). v1 grants all to all authenticated users.

### 4.2 Tables (Drizzle)

Key fields only — full schema generated in implementation phase.

```
organizations    (id, name, kind, created_at)
users            (id, organization_id, display_name, is_anonymous, created_at, last_seen_at)
user_identities  (id, user_id, provider, provider_id, verified_at)
profiles         (user_id PK, schema_version, data jsonb, summary, updated_at)
cases            (id, user_id, status, visa_type, target_country, target_consulate,
                  target_move_date, eligibility_verdict jsonb, schema_version, created_at)
case_facts       (case_id PK, data jsonb, summary, updated_at)
documents        (id, case_id, type, file_path, status, extraction jsonb,
                  confirmed_by_user, confirmed_at, created_at)
drafts           (id, case_id, type, version, content jsonb, status,
                  approved_by_user, approved_at, created_at)
tasks            (id, case_id, kind, status, payload jsonb,
                  due_at, completed_at, created_at)
approvals        (id, case_id, target_type, target_id, status,
                  presented_at, decided_at, decision jsonb)
threads          (id, case_id, title, created_at, last_message_at)
messages         (id, thread_id, user_id, role, content, parts jsonb,
                  channel, model_version, prompt_version, created_at)
tool_calls       (id, message_id, tool_name, input jsonb, output jsonb,
                  duration_ms, error, created_at)
activity_log     (id, case_id, user_id, kind, payload jsonb, created_at)
profile_changes  (id, user_id, field_path, old_value, new_value, source,
                  source_turn_id, confidence, created_at)
case_changes     (id, case_id, field_path, old_value, new_value, source,
                  source_turn_id, confidence, created_at)
notifications    (id, user_id, case_id, channel, kind, payload jsonb,
                  sent_at, error)
entitlements     (id, user_id, capability, granted_at, expires_at, source)
verification_tokens (identifier, token, expires)  -- Auth.js v5
```

### 4.3 Provenance Wrapper

Every leaf field on Profile and CaseFacts uses:

```ts
const FieldSchema = <T>(inner: ZodType<T>) => z.object({
  value: inner.nullable(),
  source: z.enum(['user_stated', 'inferred', 'document', 'user_corrected', 'system']),
  sourceTurnId: z.string().uuid().nullable(),
  confidence: z.number().min(0).max(1),
  updatedAt: z.string().datetime(),
});
```

### 4.4 Case States

```
draft → intake → eligibility_known → documents_in_progress
  → documents_complete → drafts_in_progress → drafts_approved
  → forms_filled → forms_approved → ready_to_submit → submitted (manual)
  → outcome_recorded
```

The workflow engine derives status from underlying state, not by storing a status string. `cases.status` is a denormalized read-optimized column updated by the workflow engine on transitions.

---

## 5. Tool Catalog

The agent has access to ~25 tools. Each tool: clear single purpose, Zod-validated input, typed structured output, one-paragraph description in the spec.

### 5.1 Case state tools

| Tool | Purpose |
|---|---|
| `read_case` | Returns the current case + profile. Always available. |
| `update_case` | Single-threaded write. The ONLY way to mutate case facts. Takes `{updates, source, confidence, sourceTurnId, fieldNotes}`. Returns updated case + contradictions. |
| `add_case_note` | Append a free-form note (things that don't fit structured fields). |
| `read_activity_log` | Last N activity entries. |

### 5.2 Eligibility tools

| Tool | Purpose |
|---|---|
| `check_eligibility` | Pure function over case + rules. Returns verdict with route, requirements, blockers, warnings. |
| `simulate_what_if` | Run eligibility against a hypothetical profile diff (e.g., "what if salary were €52k?"). |
| `lookup_anabin` | Look up institution + degree in seed data. Falls back to ZAB guidance. |

### 5.3 Document tools

| Tool | Purpose |
|---|---|
| `request_document_upload` | Create a Task asking the user to upload a specific document. |
| `extract_document` | Dispatched to a worker. Returns immediately with job id. Worker sends a notification when done. |
| `classify_document` | Identify what kind of document was uploaded. |
| `confirm_extraction` | Mark extraction as user-approved; merge into case. |
| `generate_document_checklist` | Pure: case → personalized checklist. |
| `track_apostille_step` | Advance an apostille task; schedule next reminder. |

### 5.4 Drafting tools

| Tool | Purpose |
|---|---|
| `draft_cover_letter` | Generate cover letter draft from case context. |
| `draft_employer_letter` | Generate employer letter template (for user's employer to print). |
| `draft_cv` | Generate Lebenslauf in German consulate format. |
| `draft_anabin_justification` | Narrative for ambiguous degree cases. |
| `regenerate_draft` | Re-run with different framing ("more formal", "emphasize return intent"). |

### 5.5 Form tools

| Tool | Purpose |
|---|---|
| `fill_videx_form` | Map case data → 37 VIDEX fields. Returns completeness report. |
| `request_missing_field` | Create Task asking for a specific missing field. |
| `generate_filled_pdf` | Dispatch worker to fill + flatten PDF. |
| `generate_submission_package` | Bundle approved drafts + forms + uploads into ZIP. |

### 5.6 Timeline tools

| Tool | Purpose |
|---|---|
| `generate_timeline` | Phases (apostille / BA approval / consulate / arrival) with date math. |
| `schedule_reminder` | Inngest scheduled job; emails the user at a future date. |

### 5.7 Conversational tools

| Tool | Purpose |
|---|---|
| `out_of_scope` | Detect unsupported scenarios; redirect with resources. |
| `request_clarification` | Structured clarifying question (renders as a form widget in the workspace, not free chat). |
| `summarize_progress` | Short summary of where the case stands; used for session resumption. |

### 5.8 Tool design rules

- Every tool returns `{type, version, data}` discriminated union.
- Every tool's output is validated by Zod before consumption.
- Tool descriptions are written like docstrings for a junior developer.
- Tools never quote year-specific numbers in their descriptions or outputs — they read from rules YAML.
- Long-running tools (extract, generate PDF) dispatch Inngest jobs and return job ids; the agent gets notified on completion.

---

## 6. User Journey

### 6.1 Happy path (Priya-style strong case)

1. **Sign up.** User lands on `/`, clicks "Start a case." Anonymous session created. Case created with status `draft`.
2. **Intake conversation.** Chat is the primary interaction. The agent asks open-ended questions, calls `update_case` after every fact learned. Provenance captured automatically.
3. **First eligibility check.** Once nationality + degree + job offer + salary are known, the agent calls `check_eligibility`. Verdict appears in the **Overview** section of the workspace.
4. **Document checklist generated.** Personalized to consulate, route, family situation.
5. **Documents uploaded.** Drag-and-drop anywhere. Each upload kicks off async extraction. User gets a notification when extraction is ready for review.
6. **Approvals.** User reviews extracted data side-by-side with the document. Approves or corrects. Case advances.
7. **Apostille tracking.** System creates dated tasks for each apostille step; sends reminders.
8. **Drafting.** Once core docs are in, user (or agent proactively) requests cover letter, employer letter, CV. Drafts appear in **Drafts** section. User reviews, edits, regenerates if desired, approves.
9. **VIDEX filling.** System fills the form in the background. If fields are missing, system creates Tasks asking for them in the workspace — never sends user to the VIDEX site.
10. **Form approval.** User reviews filled VIDEX side-by-side with source data. Approves. Final flattened PDF generated.
11. **Quality check.** System runs cross-document consistency checks, completeness validation, risk flagging.
12. **Submission package.** ZIP with all documents in correct order, plus a checklist of what to bring to the appointment.
13. **Manual booking + submission.** User books appointment themselves (system provides URL + reminders). After submission, user marks case as `submitted`.
14. **Post-submission tracking.** System tracks expected processing timeline, sends reminders.

### 6.2 Edge cases the system handles

- **User changes a fact mid-flow.** "Actually my salary went up to €55k." Agent calls `update_case` with `source: 'user_corrected'`, re-runs eligibility, regenerates affected drafts and checklist.
- **Out-of-scope.** "I want to apply for the US too." Agent calls `out_of_scope` tool, friendly redirect, returns to main flow.
- **Document quality bad.** Extraction confidence low; system asks user to re-upload or enter manually.
- **Distance-learning degree.** System detects via Anabin lookup, adds clarification request to checklist.
- **Employment gap.** System flags as consulate question; offers cover-letter framing guidance.
- **User comes back after weeks.** Case is loaded; agent calls `summarize_progress`; user picks up where they left off.

### 6.3 Multi-persona testing

Any user can load any seeded persona via `/case/new?persona=priya-strong` (or similar). Persona library covers happy paths and edge cases. See §11.

---

## 7. Dashboard / Workspace

> **Evolution note (2026-05-31): the center column becomes a journey tracker.**
> Brainstormed with the user and specced in `docs/archive/specs/2026-05-31-journey-tracker-dashboard-design.md`. The original §7 modeled the center column as whichever nav section is active (Overview by default). It now hosts a **journey tracker**: a read-only projection of case state into ordered phases with per-phase progress (Eligibility 6/8, Documents 1/9, …), dual provenance (requirement citations + answer provenance), and expandable per-phase detail. The §7.2 sections below are **not deleted** — they survive as **left-sidebar drill-down views** (the detailed per-section screens the tracker links into). Two notable shifts: **Profile (§7.2.2) is folded into Documents** (identity is extracted from the passport upload, not entered standalone), and the layout follows "Option A" (sidebar = portal chrome + section links; center = tracker; chat pinned right). The journey covers the **application-package** arc only (ends at "ready to submit"), unchanged from the North Star. Treat the tracker spec as authoritative where it refines the text below.

### 7.1 Layout

Three columns on desktop, stacked + chat-bottom-sheet on mobile.

```
┌─────────────────┬───────────────────────────┬──────────────────┐
│   CASE NAV      │      CASE WORKSPACE       │       CHAT       │
│   (left)        │      (center)             │       (right)    │
│   ~220px        │      flexible             │       ~360px     │
│                 │                           │                  │
│  Overview       │  [Whatever is active —    │  Always visible. │
│  Profile        │   Overview by default;    │  Streaming.      │
│  Documents      │   click left nav to       │  Tool-call       │
│  Drafts         │   switch view]            │  status inline.  │
│  Forms          │                           │                  │
│  Timeline       │                           │  Input always at │
│  Tasks (3)      │                           │  bottom.         │
│  Activity       │                           │                  │
│                 │                           │                  │
└─────────────────┴───────────────────────────┴──────────────────┘
```

Chat is **never hidden behind a button**. It's a permanent panel, like Claude Projects. On mobile, it collapses to a bottom sheet that's one tap away.

### 7.2 Workspace sections

**§7.2.1 Overview** — *(superseded by the journey tracker — see the §7 evolution note; the tracker is the new center-column "overview")*. Hero content showing:
- Case status (e.g., "Documents in progress, 3 of 8 confirmed")
- Eligibility verdict (route, blockers, warnings)
- What the system is working on right now
- Top 3 action items with deep links

**§7.2.2 Profile** — *(folded into Documents per the §7 evolution note: identity facts are extracted from the passport upload and confirmed in place, not entered as a standalone phase. The `Profile` DB table is unchanged — it stays user-level and is reused across cases. This remains available as a sidebar drill-down view.)* Identity facts (name, DOB, nationality, family). Editable. Each field shows provenance on hover ("from passport scan, May 22").

**§7.2.3 Documents** — three groups:
- *Needed* — checklist of required documents not yet uploaded. Shows why each is needed.
- *Awaiting confirmation* — uploaded; extraction complete; user must review.
- *Confirmed* — locked, with link to file.

Drag-and-drop upload anywhere on this view.

**§7.2.4 Drafts** — generated documents (cover letter, employer letter, CV, etc.). Each shows status (drafting / ready for review / approved / finalized PDF). Click to read, edit inline, regenerate, or approve.

**§7.2.5 Forms** — VIDEX visa form. Shows completeness ("28 of 37 fields filled"). When complete, shows side-by-side preview before user approves and final PDF is generated.

**§7.2.6 Timeline** — phases with date ranges, dependencies, target move date. Apostille / BA approval / consulate / arrival.

**§7.2.7 Tasks** — short list of action items. Each task has a clear next step ("upload your degree certificate," "review extracted passport data," "approve cover letter").

**§7.2.8 Activity** — append-only history. "System extracted passport — 22 May 14:32." Builds trust, debuggable.

### 7.3 Chat panel behavior

- Streaming responses with token-by-token rendering.
- Tool-call status inline ("Looking up BITS Pilani in Anabin...").
- Citations inline as numbered chips, sources expandable.
- When the agent updates the case, the workspace columns auto-refresh.
- When the agent creates a Task, it appears in the Tasks section and a brief mention in chat.
- User can ask "what are you doing?" / "what's left?" any time.

### 7.4 Approval flows

When the agent has a draft / extracted data / filled form ready for review, the chat shows a compact card with "Review" button. Clicking opens the relevant workspace section in the center column with the artifact pre-selected. User approves or edits in place. State updates flow back via tools.

---

## 8. Agent Design

### 8.1 Single agent, rich tool catalog

One agent. ~25 tools. No sub-agents, no agent-of-agents. Cognition's rule applies: **only the agent writes to the case** (via `update_case`). Tools fetch, draft, dispatch — they don't mutate state directly except through `update_case`.

### 8.2 System prompt structure

Lives in `prompts/agent/v0.md`. Sections:

1. **Role.** "You are a case-management agent for German Blue Card applications."
2. **Hard limits.** Scope (Blue Card only, India source); refuse off-scope by calling `out_of_scope`.
3. **Tool usage rules.** Never quote thresholds; always call tools; always update case before reasoning.
4. **Citation style.** Inline numbered citations from tool outputs; never invent.
5. **Conversation style.** Warm, factual, concise. No bullshit. No emoji. Acknowledge uncertainty.
6. **Approval discipline.** Never silently change facts. When `update_case` returns contradictions, surface them.
7. **Drafting discipline.** Drafts are drafts until user approves. Always offer to regenerate with different framing.
8. **Session resumption.** On returning user, call `summarize_progress`.

### 8.3 Context engineering

The agent does not see the entire case state at every turn. A `buildAgentContext(caseId, turnId)` helper returns:

- The user's current message
- The last N messages (default 10)
- A structured summary of the case (eligibility verdict, top-level status, current section the user is viewing)
- Relevant knowledge chunks (3–5)
- Open tasks (top 3)
- Recent activity (last 5 entries)

Token budget per turn capped; older context summarized into a rolling summary stored on the case.

### 8.4 Single-threaded writes

The `update_case` tool is the only mutation path. All other tools that produce data return it; the agent then chooses to call `update_case` to persist. This makes contradictions explicit and gives the user a single audit trail.

### 8.5 Background work

Long-running operations (extract document, generate PDF, run eval) dispatch Inngest jobs. The agent receives a job id, the user sees a "working on it" status, and on completion the system either:
- Pushes a chat message ("I've finished extracting your passport — please review")
- Creates a Task that surfaces in the workspace
- Both, depending on user-attention requirements

---

## 9. Workflow Engine (Inngest)

### 9.1 What Inngest provides

- **Durable steps.** A workflow can survive server restarts. If extraction is mid-flight when the server reboots, it resumes from the checkpoint.
- **Scheduled jobs.** "Send a reminder in 7 days." Inngest schedules; we don't manage cron.
- **Wait-for-event.** A workflow can pause until the user approves an artifact.
- **Retries.** Transient failures retry with backoff automatically.
- **Concurrency control.** Limits per case or per user to prevent runaway jobs.

### 9.2 Core workflows

| Workflow | Trigger | Steps |
|---|---|---|
| `extractDocumentWorkflow` | `documents/uploaded` event | Classify → extract via Reducto/vision → store → notify user |
| `apostilleReminderWorkflow` | `case/apostille_started` event | Wait N days → check status → if not advanced, send reminder |
| `documentStalenessWorkflow` | scheduled daily | Check passport expiry, statement age across all active cases; flag stale ones |
| `evalMessageWorkflow` | `messages/created` event | Run LLM-as-judge; flag low-quality responses for ops review |
| `weeklyDigestWorkflow` | scheduled weekly | Summarize case progress for inactive users |
| `generatePackageWorkflow` | `case/forms_approved` event | Generate filled VIDEX → bundle ZIP → notify user |

### 9.3 Approval gates

Approvals are first-class. When the agent generates a draft, it dispatches an `awaitApprovalWorkflow` that:
1. Creates an Approval record + Task
2. Notifies user
3. Waits up to 30 days for `approval/decided` event
4. On decision, advances the case

If no decision after 7/14/21 days: send reminders.

---

## 10. External Services

| Service | Purpose | Notes |
|---|---|---|
| Anthropic (Claude Sonnet 4.6/4.7 + Haiku 4.5) | Primary LLM | ZDR addendum required. Aggressive prompt caching. |
| Vercel AI SDK | LLM abstraction | Provider-agnostic. Streaming + tool calling. |
| Inngest | Workflow engine | Durable steps, scheduled jobs, wait-for-event. |
| Supabase EU (Postgres) | Database | Row-level security for multi-tenant. |
| Drizzle | ORM | TypeScript-first. |
| Cloudflare R2 | Object storage | EU jurisdiction; SSE-S3 encryption. |
| Reducto | Document extraction (forms/IDs) | First choice for passports, certificates. |
| Anthropic Vision | Document extraction (fallback) | For one-off documents Reducto handles poorly. |
| Resend | Transactional email | Magic links + notifications. |
| Auth.js v5 | Auth | Magic-link only at v1. |
| pdf-lib | PDF AcroForm fill + flatten | In-process; no external service. |
| Vercel | Hosting | `fra1` region pinned. |
| Sentry | Error tracking | Standard. |
| Langfuse (self-hosted) | LLM observability | Trace prompts, costs, eval scores. |

### 10.1 Cost model

**Fixed monthly:** ~$130 at zero users → ~$400–500 at 1,000 active cases.

**Variable per case (one-time):** $0.65–$1.40 covering chat (~50 turns with prompt caching), document extraction (5–8 docs), drafting (cover letter + employer letter + CV with regenerations), and LLM-as-judge eval.

**Variable per active case per month:** ~$0.05–$0.10 (reminders, status checks).

At $49–$99 pricing per case, gross margin ~95%.

---

## 11. Multi-Persona Test Library

Persona seeds live in `data/personas/*.json`. Loadable via `/case/new?persona=<id>`.

Required personas at MVP:

1. **`priya-strong`** — Indian SWE with M.Tech, salary €48,500 (shortage route), spouse + child. Happy path with one complication.
2. **`arjun-it-no-degree`** — IT specialist without degree, 5 years experience. Tests §18g(2) IT route.
3. **`rahul-recent-grad`** — Fresh graduate (degree <3 years), salary €46,000. Tests recent-graduate route.
4. **`meera-strong-clean`** — Clean strong case. Salary above standard threshold. Tests standard route.
5. **`vikram-edge-anabin`** — Degree from non-H+ institution. Tests Anabin fallback + ZAB path.
6. **`kavya-distance-learning`** — Distance-learning degree. Tests consulate clarification flow.
7. **`out-of-scope-asylum`** — Triggers asylum redirect.
8. **`out-of-scope-eu-citizen`** — Triggers EU freedom-of-movement redirect.
9. **`out-of-scope-criminal`** — Triggers lawyer-referral redirect.
10. **`renewal-priya-y2`** — Priya, two years later, applying for renewal. Tests case-of-cases pattern.

Each persona ships with: profile data, 3–5 mock documents (passport, marriage cert, employer letter, etc.), a scripted intake conversation that exercises the relevant code paths, and expected end-state assertions.

---

## 12. Quality & Evaluation

### 12.1 LLM-as-judge

Every assistant message is scored asynchronously by an evaluator LLM (Claude Haiku) on:

- **Accuracy** (0–1): does it match what the rules engine + tools say?
- **Citation quality** (0–1): every factual claim cited?
- **Hallucination risk** (0–1): does it invent facts, URLs, document names?
- **Tone match** (0–1): warm-professional, no false promises?
- **Tool-use efficiency** (0–1): right tools called, in right order?

Scores below threshold flag the message for ops review. Aggregate scores tracked over time.

### 12.2 End-to-end persona tests

Each persona has scripted assertions:

- After scripted intake, eligibility verdict matches expected route
- Document checklist contains expected items
- Generated cover letter passes a structural lint
- VIDEX form fills to 100% completeness
- No off-scope drift

Run on every PR via Vitest.

### 12.3 Manual review queue

Ops dashboard (post-MVP) for human review of flagged messages. v1: alerts to email, manual log inspection.

### 12.4 Production observability

- Sentry for errors
- Langfuse for prompt traces, token costs, eval scores
- Inngest dashboard for workflow visibility
- Supabase logs for DB queries

---

## 13. Compliance & Legal

### 13.1 Data residency

EU-only data path. Vercel `fra1`, Supabase EU, Cloudflare R2 EU. Anthropic API requires signed Zero Data Retention addendum.

### 13.2 Retention

Documents auto-delete 90 days post-case-completion unless user opts into "save for renewals." Profile data persists across cases for the user's lifetime of the account or until deletion request.

### 13.3 Right to deletion (GDPR Art. 17)

Hard-delete endpoint that removes user, profile, cases, documents, messages, files. Tested before launch.

### 13.4 Subject access (GDPR Art. 15)

Export endpoint produces JSON + ZIP of all user data.

### 13.5 Disclaimers

Every output (chat, drafts, forms, package) carries:

> Relomate is not a law firm. We help prepare and organize immigration applications; we do not provide legal advice. Verify all information against official sources before submission. For complex cases, consult a licensed immigration attorney.

### 13.6 Legal positioning

Position is **tools and information**, not legal advice. Marketing must avoid "advice," "guarantee," "we'll get you approved." Language is "we help you prepare," "we organize," "we draft."

Future option: lawyer-partnership tier where a licensed German immigration attorney reviews complex cases. Architecture allows but doesn't require.

### 13.7 Encryption

- At rest: SSE-S3 on R2; Postgres encryption-at-rest via Supabase.
- In transit: TLS 1.3.
- PII never logged. Passport numbers / bank account numbers masked in all logs.

---

## 14. Notifications

### 14.1 Channels (v1)

Email only via Resend. `channel` field on every notification, set to `'email'`.

### 14.2 Notification kinds

- Magic-link login
- Document extraction ready for review
- Draft ready for review
- Filled form ready for review
- Apostille step reminder
- Document staleness warning
- Weekly digest (inactive users)
- Submission package ready

### 14.3 Multi-channel future

`Notification.channel` is already an enum: `'email' | 'whatsapp' | 'sms' | 'push'`. Adding WhatsApp is a Twilio integration + a `channelDispatcher.send()` switch.

---

## 15. Error Handling

| Scenario | Behavior |
|---|---|
| OCR confidence < 0.7 | Show manual entry form with extracted values as suggestions; yellow highlight |
| LLM malformed output | Retry once with stricter prompt; fall back to manual entry |
| LLM hallucination detected by judge | Flag message, log, do not auto-replace; rely on user catching |
| Network failure during upload | Resumable upload via R2 multipart; client retries |
| Inngest step failure | Auto-retry with backoff; permanent failures alert ops |
| User changes fact that invalidates draft | Auto-regenerate affected drafts; flag for re-approval |
| Knowledge base entry > 90 days old | Banner: "Last verified [date]; consulates may have updated" |
| Tool call timeout | Surface to user as "I need a moment, this is taking longer than expected" |
| Rate limit hit on LLM provider | Vercel AI SDK retry; if persistent, fail-soft with explanation |

---

## 16. Performance

- Page load < 2.5s on 4G
- Chat first-token < 1s
- Non-LLM API routes < 500ms
- Document extraction returns 202 immediately; result delivered async
- Knowledge base loaded once at server start; cached in memory

---

## 17. Mobile Roadmap (Not Built in MVP)

The MVP is responsive web. Native mobile arrives once web is validated. Architectural prep:

- API-first backend (every feature usable through HTTP, not only via RSC)
- Shared types package planned (not yet split out)
- Auth supports magic-link deep-links (works on mobile)
- Document upload designed camera-first (works on mobile web today)

When mobile lands: React Native via Expo. Same API. ~6–10 weeks of focused work.

---

## 18. Out of Scope (Explicit)

- Other German visas
- Other consulates / source countries / destination countries
- Multi-language UI
- Payment processing (architecture-ready)
- Native mobile apps (planned for after MVP)
- WhatsApp / SMS channels (planned for after MVP)
- Appointment booking automation (deferred indefinitely)
- Appointment monitoring (deferred to v2 at earliest)
- Real-time collaborative editing
- B2B / employer dashboards
- Lawyer-marketplace integration (planned for after MVP)
- Custom-trained ML models
- Multi-agent orchestration

---

## 19. Success Metrics (MVP)

| Metric | Target |
|---|---|
| Persona test pass rate | 100% on every CI run |
| LLM-as-judge accuracy score | > 0.9 average |
| Hallucination flags per 100 messages | < 2 |
| Time-from-start to ready-to-submit (Priya persona) | < 90 minutes |
| Cost per complete case | < $1.50 |
| End-to-end test coverage of personas | 10/10 personas |

---

## 20. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Unauthorized practice of law (Germany RDG) | Critical | Position as tools/information; mandatory disclaimers; legal review before launch |
| GDPR non-compliance | Critical | EU hosting; ZDR addenda; deletion + export endpoints; auto-retention |
| Hallucination in generated docs causing visa refusal | High | Mandatory user approval; LLM-as-judge; structured tool output; rules in YAML |
| Knowledge base becomes stale | High | Quarterly verification process; staleness banners; user feedback loop |
| Document extraction quality on real-world scans | High | Multiple extraction backends; manual entry fallback; confidence thresholds |
| Vendor lock-in on Anthropic | Medium | Vercel AI SDK abstracts; can swap providers in one line |
| Inngest pricing at scale | Medium | Architecture allows swap to Temporal or self-hosted alternative |
| Founder burnout / domain gap | High | Domain advisor / lawyer partnership; persona library makes testing fast |

---

## 21. Pre-Build Validation

Before writing code, complete:

1. 10 user interviews (real Indian Blue Card applicants)
2. 2–3 German immigration lawyer conversations
3. End-to-end walkthrough of Blue Card application as if applying yourself
4. Legal positioning paragraph drafted and reviewed by lawyer
5. PRD reviewed by 1+ technical advisor and 1+ domain expert
6. Persona library finalized with realistic scenarios

See `IMPLEMENTATION_PLAN.md` for the build sequence after validation.
