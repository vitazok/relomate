# CLAUDE.md — Project Context for Visa

Persistent context for Claude Code sessions. Read at session start. Update when architectural decisions change.

Companion files:
- `PRD.md` — full product spec. Reference by section number (e.g., "implement §7.2.4")
- `IMPLEMENTATION_PLAN.md` — phase-by-phase build plan with verification gates

---

## What is Visa?

AI-native case-management platform for skilled workers applying for the **EU Blue Card to Germany**. Users describe their situation in chat; the system builds a structured case file, runs deterministic eligibility, drafts the documents the user needs (cover letter, employer letter, CV, VIDEX visa form), and produces a complete submission package.

The product is the **case**, not the chat. Chat is one panel — always visible — but the case file is the spine.

MVP scope: **Germany Blue Card · India source · Bengaluru consulate · web only · multi-persona testing**.

Not in MVP: appointment booking, native mobile, payments, multi-language UI, multi-channel notifications. Architecture supports these; they're added as contained projects later.

---

## North Star

> A user spends time in the workspace and walks away with a complete, sourced, ready-to-submit Blue Card application package. Background work happens on their behalf. Every consequential write is reviewed by them.

If a feature doesn't directly serve that journey, it's out of scope. Raise it before implementing.

---

## Tech Stack (locked)

- **Runtime:** Node.js 20+, TypeScript strict
- **Framework:** Next.js 16 (App Router)
- **UI:** Tailwind 4 + shadcn/ui
- **AI SDK:** Vercel AI SDK v5+ (provider-agnostic; primary provider Anthropic)
- **Models:** Claude Sonnet 4.6/4.7 (primary), Claude Haiku 4.5 (judge + simple chat)
- **Workflow engine:** Inngest (durable steps, scheduled jobs, wait-for-event)
- **Database:** Supabase EU (Postgres) via Drizzle ORM
- **Object storage:** Cloudflare R2 (S3-compatible, EU jurisdiction, SSE-S3)
- **Auth:** Auth.js v5 magic-link via Resend
- **Document extraction:** Reducto (forms/IDs primary), Anthropic vision (fallback)
- **Email:** Resend
- **PDF:** pdf-lib (in-process; no external service)
- **Validation:** Zod everywhere — schemas, tool I/O, env, LLM outputs
- **Testing:** Vitest
- **Package manager:** pnpm
- **Hosting:** Vercel `fra1` (Frankfurt)
- **Error tracking:** Sentry
- **LLM observability:** Langfuse (self-hosted)

**Do NOT introduce:** LangChain, custom LLM abstractions, Redux, Prisma (we use Drizzle), Docker, microservices, GraphQL, multi-agent frameworks. If you think you need one, stop and ask.

---

## Architectural rules (non-negotiable)

1. **TypeScript strict.** No `any` without `// reason: ...` comment.

2. **Zod is source of truth.** Drizzle column types derive from Zod, not vice versa.

3. **Server is authoritative.** Never trust client state for case facts, eligibility, or entitlements.

4. **Single agent, many tools.** No multi-agent orchestration. No sub-agents.

5. **Single-threaded writes.** Only the agent writes to case state, and only via the `update_case` tool. Other tools fetch, draft, dispatch — they do not mutate state directly.

6. **No string concatenation for user-visible text.** Use i18n keys even though MVP is English-only. Keep strings extractable.

7. **No hardcoded numbers/thresholds in code or prompts.** All in `config/rules/*.yaml`. The LLM never quotes a number — it calls a tool that reads YAML.

8. **Tool outputs are typed `{type, version, data}` discriminated unions.** Frontend dispatches via a renderer registry. Versioned for backward compat with stored historical messages.

9. **All facts have provenance.** Every leaf field on Profile / CaseFacts has `value`, `source`, `confidence`, `sourceTurnId`, `updatedAt`. The user-message uuid is reused as `sourceTurnId` — don't generate a fresh one in the tool.

10. **Messages are append-only.** No UPDATE on `messages` or `activity_log` or `*_changes` tables.

11. **System prompt versioning.** Prompts live in `prompts/`, version-controlled. Every assistant message logs `prompt_version`.

12. **Approvals are explicit.** Extracted data, drafted documents, generated forms are drafts until the user approves. Workflow engine pauses on approval gates.

13. **Long-running work goes through Inngest.** Anything that takes more than ~1s. Tools that dispatch to workers return immediately with a job id.

14. **Background work checkpoints.** Inngest steps. Failures resume from checkpoints, not from scratch.

15. **No comments narrating what code does.** Only non-obvious intent or constraints.

16. **Conventional commits:** `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`.

---

## What NOT to do

- Do NOT have the LLM quote any year-specific number (salary thresholds, fees, processing times). Always via a tool that reads `config/rules/`.
- Do NOT skip Zod validation on tool I/O.
- Do NOT mutate the messages table.
- Do NOT implement vector search over the user's own history. Use structured case + summary.
- Do NOT introduce a new dependency without asking.
- Do NOT generate UI as markdown blocks from the LLM. Artifacts are tool outputs that render via the registry.
- Do NOT silently overwrite a fact when the user contradicts. Acknowledge, confirm, then update.
- Do NOT suggest a user "definitely qualifies." Eligibility is deterministic; uncertainty is explicit.
- Do NOT auto-submit anything anywhere — explicitly out of scope.
- Do NOT scrape consulate / VFS / VIDEX sites — out of scope.
- Do NOT add features outside the PRD. Raise it before implementing.
- Do NOT use real personal data in tests. Synthetic personas only.
- Do NOT log PII (passport numbers, bank account numbers). Mask in logs.

---

## File tree (as of phase scaffolding)

See PRD §3.3 for the full layout. Key locations:

- `prompts/agent/v0.md` — main agent system prompt
- `prompts/eval/v0.md` — LLM-as-judge prompt
- `config/rules/*.yaml` — verified facts (rules, thresholds, ISCO, family, apostille, consulates, documents)
- `content/knowledge/*.md` — markdown chunks for retrieval
- `data/personas/*.json` — multi-persona test seeds
- `src/lib/ai/tools/` — tool definitions
- `src/lib/case/` — case schema, repository, state machine
- `src/lib/rules/` — rules loader, eligibility engine
- `src/lib/drafting/` — cover letter, employer letter, CV, VIDEX
- `src/lib/workflows/` — Inngest functions
- `src/lib/eval/` — LLM-as-judge

---

## Stack gotchas

These bit us before (carried over from Nomad). Don't redo.

### Build / tooling
- **shadcn CLI:** package is `shadcn`, not `shadcn-ui`. CLI-only — run via `pnpm dlx shadcn@latest …`. Don't add as a dependency.
- **pnpm 11 build-script approvals:** live in `pnpm-workspace.yaml` under `allowBuilds:` (a `name: true|false` map), NOT `onlyBuiltDependencies:`.
- **Vercel region:** pinned in `vercel.json`, not `next.config.ts`.
- **`tsx` invocation:** `node node_modules/.bin/tsx` fails. Use `pnpm exec tsx` or a `pnpm` script.
- **Drizzle scripts** load env via Node's `--env-file=.env.local` flag (no `dotenv` package).

### Database / Supabase
- **Two connection URLs required:** `DATABASE_URL` is the **transaction pooler** (port 6543) for runtime; `DIRECT_URL` is the **session pooler** (port 5432) for `drizzle-kit migrate`. The bare direct connection is IPv6-only and won't work locally or on Vercel. Pooler username is `postgres.<project-ref>`, not `postgres`.

### Next.js 16 / React 19
- **Cookies in RSC:** server components cannot call `cookies().set()`. Split read-only (safe in RSC) and write paths (route handlers only).
- **No setState in effect:** React 19 rule. Use `useSyncExternalStore` for external state polling.

### AI SDK v5/v6
- **`convertToModelMessages` is async** — must be `await`ed.
- **`useChat` transport** is constructed explicitly: `transport: new DefaultChatTransport({ api: '/api/chat' })`. The `api` option on `useChat` is gone.
- **`tool()` from `ai`:** `{description, inputSchema (Zod), execute}`. Don't use `dynamicTool` (that's for runtime-shape MCP tools).
- **`stopWhen: stepCountIs(N)`** with N≥2 is required to get a natural-language reply *after* a tool call. Default `1` emits the call but the model never reads the result.
- **Anthropic prompt caching** is set via `providerOptions.anthropic.cacheControl: { type: 'ephemeral' }`. Per-message AND per-tool. Tool breakpoints live on **each tool's own `providerOptions`**.

### Inngest
- Local dev: run `npx inngest-cli@latest dev` alongside `pnpm dev`. Webhook is `/api/inngest`.
- Steps must be deterministic. Don't call `Date.now()` or `Math.random()` outside `step.run()` blocks.
- `step.waitForEvent()` is the approval gate primitive. 30-day max wait by default.

### Auth.js v5 (verification-only pattern)
- Don't use `@auth/drizzle-adapter`; don't add `accounts` or `sessions` tables. Auth.js sends magic link, verifies token, writes a JWT cookie. Our HMAC `visa_session` cookie is the app session of record.
- **`signIn` callback fires twice for the email provider:** once at request time with `email.verificationRequest: true` (return `true` to send), once after click. Returning a redirect string short-circuits before Auth.js sets JWT — use the `redirect` callback instead.
- Resend account required before production sign-in works. Dev path uses console-log override.

### Rules + eligibility
- **Rules loader caches in module scope.** Restart `pnpm dev` after YAML edits.
- **`evaluateEligibility(case, today)` is pure** — `today` is a parameter so tests pin it.
- **ISCO matching is prefix-based.** `iscoMatchesAny('2512', ['25'])` is `true`. ISCO-08 is hierarchical.
- **Anabin seed defaults to `'unknown'`**, not `'H+'`. The `lookup_anabin` tool returns `found: true, status: 'unknown'` so the agent says "we don't know yet" instead of inventing an H+ rating from training data.

### Tools
- **Rich descriptions.** Write tool descriptions like docstrings for a junior developer. They are the agent's primary interface.
- **Single purpose per tool.** If a tool does two things, split it.
- **No mutating state in tools other than `update_case`.** Tools fetch, draft, dispatch.
- **Long-running tools dispatch Inngest jobs** and return job ids. The agent does not await them in the chat loop.

---

## Key terminology

- **Case** — one application. Has profile, facts, documents, drafts, tasks, approvals, activity log.
- **Profile** — user-level identity (reused across cases over the user's lifetime).
- **CaseFacts** — case-specific structured state (current employment, family-as-of-application, etc.).
- **Document** — uploaded file + extracted data + confirmation status.
- **Draft** — system-generated document (cover letter, employer letter, CV, VIDEX). Has versions.
- **Task** — anything the user needs to do. Auto-generated.
- **Approval** — pending user review of an extracted/drafted/generated artifact.
- **Tool** — TypeScript function the agent can call, with Zod input + discriminated-union output.
- **Workflow** — Inngest function. Durable, resumable, may pause on approvals.
- **Channel** — `'web'` for v1. Always present for future WhatsApp/SMS/email.
- **Provenance** — metadata on every fact tracking how it was learned.

---

## When you're stuck

1. Stop and ask before implementing.
2. Propose a recommendation with reasoning.
3. Pick the most conventional option, not the most clever.

The user values predictability and explicit decisions over surprise improvements.

---

## Verifying facts

- 2026 Blue Card thresholds, family reunification, apostille flow are user-verified from official sources (Make-it-in-Germany, india.diplo.de, gesetze-im-internet.de, anabin.kmk.org, mea.gov.in).
- Anabin H+/H-/H+- ratings are NOT user-verified at seed time. Mark `verifiedByUser: false` and add to a TODO list.
- Knowledge base markdown is placeholder until verified.

---

## Persona testing

Personas are in `data/personas/*.json`. Load via `?persona=<id>` URL parameter on case creation.

**MVP scope is trimmed from PRD §11.** Ship 4 archetype personas now (each targets a distinct rules-engine branch); the remaining 6 are deferred to Phase 2 as the agent + intake come online. Reasoning, schema, and per-persona content are in `docs/superpowers/specs/2026-05-27-persona-library-design.md`.

Currently shipped (Phase 0):
- `priya-strong` (shortage route, happy path)
- `arjun-it-no-degree` (§18g(2) IT-no-degree route)
- `vikram-edge-anabin` (Anabin-unknown refusal-to-conclude)
- `out-of-scope-asylum` (off-scope refusal)

Deferred to Phase 2:
- `meera-strong-clean` (standard route)
- `rahul-recent-grad` (recent-graduate route)
- `kavya-distance-learning` (distance-learning detection)
- `out-of-scope-eu-citizen`, `out-of-scope-criminal` (additional refusal paths)
- `renewal-priya-y2` (renewal flow — requires case-of-cases pattern)

Every PR runs the persona test suite. Don't skip — these are the strongest end-to-end signal.

---

## Build plan reference

`IMPLEMENTATION_PLAN.md` is the day-by-day plan. Reference by phase number. Don't skip phases. Verify each phase's deliverables end-to-end before moving on.

Phase 0 (validation per PRD §21) is required before Phase 1. Don't write code until Phase 0 is complete.

## Current state (as of 2026-05-28)

- **Phase 0:** complete (user-declared 2026-05-27).
- **Phase 1A (foundation scaffolding):** complete. Plan at `docs/superpowers/plans/2026-05-27-phase-1a-foundation.md`. Pushed to `origin/main`.
- **Phase 1B split into 3 sub-phases.** Spec at `docs/superpowers/specs/2026-05-27-phase-1b-design.md`. Sub-phases:
  - **1B-1 (complete, pushed 2026-05-28):** persistence + `update_case`. Plan at `docs/superpowers/plans/2026-05-27-phase-1b-1-persistence.md`. Verification gate green: `pnpm test` 67/67, `pnpm build`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm smoke:1b1` round-trips against real Supabase EU. Last commit: `f7ab0be`.
  - **1B-2 (next, not yet planned):** Auth.js v5 magic-link via Resend + anonymous→authed continuity.
  - **1B-3 (not yet planned):** AI SDK v5 streaming chat + 3-col workspace + Inngest scaffold.
- **What's in the repo from 1B-1:** repository (`src/lib/case/repository.ts`: `createCase`, `loadCase`, `applyUpdate`) · path utilities (`src/lib/case/paths.ts`) · repository types (`src/lib/case/types.ts`) · `update_case` AI SDK tool adapter (`src/lib/ai/tools/update_case.ts`) · per-file Postgres test schema infra (`tests/_db/setup.ts` + `seed.ts`; pool URL has `options=-c search_path=<schema>` baked in) · smoke script (`scripts/smoke-1b1.ts`, `pnpm smoke:1b1`) · first Drizzle migration applied to fresh Supabase EU project (eu-north-1; `.env.local` and `.env.test.local` both point at it).
- **Key Phase 1A architectural decision:** the eligibility engine was *slimmed* to fit Visa's minimal `CaseFacts`, not ported verbatim from Nomad. It does NOT yet handle multi-degree arrays, ZAB statements, professional experience arrays, German level, spouse/children — those are Phase 2+ concerns. Engine emits exactly the codes the 4 personas expect.

### 1B-1 carry-overs that bind future work

- **Test schema isolation:** `tests/_db/setup.ts` strips `"public"."<table>"` references from migration SQL before applying to test schemas (drizzle-kit emits these in FK clauses; without stripping they'd cross-schema-reference back to `public`). Don't re-add them.
- **Pool search_path:** the test pool URL has `options=-c%20search_path=<schema>` baked in — every connection in the pool starts in the test schema. Repository code MUST NOT call `SET search_path = ...` itself; it would interfere. The `_schemaName` parameter on `makeRepository(db, _schemaName)` is intentionally unused.
- **Lazy `require()` in repository:** `src/lib/case/repository.ts` uses `require('@/lib/db/client').db` to avoid env-validation at test-import time. Works but non-idiomatic; deferred cleanup, not a blocker.
- **`ProfileSchema` is permissive.** All identity fields wrapped with `Optional(...)`; `schemaVersion: z.literal(1).default(1)`. Persona eligibility tests still pass because they construct full profiles.
- **CaseFacts safety belt:** `CaseFactsSchema.parse(merged)` runs before `UPDATE case_facts` in `applyUpdate`. Keep it.
- **Activity log payload shape:** one row per `applyUpdate` (not per path): `{kind: 'case.facts.updated', paths: [...], source, sourceTurnId, contradictions: number}`. 1B-3 will read it; don't drift.
- **Contradiction semantics:** path-local only — "same path written twice with different values at same-or-higher confidence." Cross-field contradictions are eligibility-engine territory. Surfaced in result, NOT blocking the write — both writes persist.
- **`update_case` tool output shape:** `{type: 'update_case_result', version: 1, data: UpdateCaseResult}` per CLAUDE.md rule #8. Frontend renderer registry will dispatch on `type`.
- **`confidence` is `numeric(3, 2)` in DB.** drizzle returns it as a string; `applyUpdate` writes `String(confidence)` and reads expect `Number(...)` casts.
- **Smoke runner uses Node 20 `--import tsx`:** `pnpm smoke:1b1` resolves to `node --env-file=.env.local --import tsx scripts/smoke-1b1.ts`.

### Resume point for the next agent: Phase 1B-2 (auth)

No plan yet. Start with brainstorming + writing-plans. Goals:
- Auth.js v5 magic-link via Resend (verification-only pattern, no `accounts`/`sessions` tables — see "Auth.js v5" gotchas above).
- App-session `visa_session` HMAC cookie (the source of truth for app sessions; Auth.js's JWT just signals successful verification).
- Anonymous→authed continuity: a user who started a case anonymously and later signs in keeps their case (org/user/case rows already exist; need to merge or transfer ownership).

---

## Origin

Visa is a pivot from an earlier project (Nomad) at `~/Projects/nomad/`. About 40–50% of Nomad's code ports cleanly — rules YAML, eligibility engine, Anabin seed, knowledge base, profile schema with provenance. The other half (chat UI, agent loop, renderer registry, Drizzle schema) is being redesigned for the case-management architecture. See Phase 1 of the implementation plan for what to copy.

The pivot decision and architecture rationale are documented in the conversation history. If you need context on why a decision was made, ask the user — don't infer.
