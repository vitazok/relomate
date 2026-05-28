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
- **Adapter type imports:** `next-auth@5` re-exports adapter types at `next-auth/adapters` (NOT `@auth/core/adapters` — that's a transitive package and importing from it couples to pnpm hoist).
- **Production-mode env validation runs during `next build`.** `EnvSchema.superRefine` requires `AUTH_RESEND_KEY`, `EMAIL_FROM`, `AUTH_URL` in production; during the "Collecting page data" phase Next sets `NODE_ENV=production` and evaluates routes. If `.env.local` is missing those, the build fails. `EMAIL_FROM` must be a plain email (`z.string().email()`) — RFC 5322 display-name format (`"Name <addr>"`) is rejected. Resend's API accepts the display-name form at the provider level, so format conversion happens in the provider call, not the env.
- **Module-scope env validation breaks vitest imports.** `@/lib/env` runs validation at top-level import. Tests that pull in any env-dependent module (cookie, session, merge) need `tests/_setup/env.ts` registered as `setupFiles` in `vitest.config.ts` — it loads `.env.test.local` into `process.env` before any test module imports. Don't add a `beforeAll(() => process.env.X = ...)` shim; it runs after import.
- **CJS `require('@/...')` doesn't resolve under vitest.** Inside tests, use `await import('@/...')` for dynamic re-imports. The `@` alias is a Vite resolver; CJS doesn't see it.
- **`useFormState` from `react-dom` is soft-deprecated in React 19.** Still works in 19.2.x; canonical is `useActionState` from `react`. Migrate when you want the third tuple element (`isPending`) for "Sending…" UI state.
- **Email normalization:** lowercase + trim at every entry point (server action AND claim handler). The route's `auth()` returns whatever Auth.js parsed; assume it may include casing/whitespace.

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
  - **1B-2 (complete, pushed 2026-05-28):** Auth.js v5 magic-link via Resend + `visa_session` HMAC cookie + anon→authed continuity. Spec at `docs/superpowers/specs/2026-05-28-phase-1b-2-auth-design.md`, plan at `docs/superpowers/plans/2026-05-28-phase-1b-2-auth.md`. Verification gate green: `pnpm test` 88/88, `pnpm build` (4 routes), `pnpm exec tsc --noEmit`, `pnpm lint`. Manual smokes deferred to user follow-up. Last commit: see `git log`.
  - **1B-3 (Tasks 1–14 code shipped locally; manual smoke FAILED; debug instrumentation committed; NOT pushed — 22 commits ahead of `origin/main`):** AI SDK v5 streaming chat + 3-col workspace + Inngest scaffold. Spec at `docs/superpowers/specs/2026-05-28-phase-1b-3-chat-workspace-design.md`. Plan at `docs/superpowers/plans/2026-05-28-phase-1b-3-chat-workspace.md` — 15 tasks. **Tasks 1–14 code complete and committed locally** (last automated gate at Task 11 was: `pnpm test` 109/109, `pnpm exec tsc --noEmit` clean, `pnpm lint` clean, `pnpm build` green). **Task 14 manual smoke FAILED:** clicking "Start a case" on `/` redirects to `/case/<uuid>` but the page renders the `not-found.tsx` view ("Case not found / Start a new case") instead of the workspace. DB state is healthy (3 cases, all owned by the same anon user, each with 1 thread + 1 case_facts row), so `loadCase(id)` should succeed for the redirected case — yet the case page's `try { ... } catch { notFound() }` is firing. The bare catch in commit `2e1b642` swallowed the actual error; commit `a9efc73` adds `console.error('[CasePage] loadCase threw for', { id, userId, err })` and a `[CasePage] ownership mismatch` log so the next reproduction prints the real cause. Task 15 (final gate), CLAUDE.md "1B-3 complete" update, and `git push` are all blocked on the smoke. Next agent: resume at the **debugging picking-up point** below — do NOT proceed to Task 15 or push until the smoke is green.
- **What's in the repo from 1B-1:** repository (`src/lib/case/repository.ts`: `createCase`, `loadCase`, `applyUpdate`) · path utilities (`src/lib/case/paths.ts`) · repository types (`src/lib/case/types.ts`) · `update_case` AI SDK tool adapter (`src/lib/ai/tools/update_case.ts`) · per-file Postgres test schema infra (`tests/_db/setup.ts` + `seed.ts`; pool URL has `options=-c search_path=<schema>` baked in) · smoke script (`scripts/smoke-1b1.ts`, `pnpm smoke:1b1`) · first Drizzle migration applied to fresh Supabase EU project (eu-north-1; `.env.local` and `.env.test.local` both point at it).
- **What's in the repo from 1B-2:** five auth modules (`src/lib/auth/{cookie,session,config,adapter,merge}.ts`) · `/api/auth/[...nextauth]` (Auth.js handler mount) · `/api/claim-anonymous` (post-verification merge route) · `/signin` page + server action · auth seed helpers (`tests/_db/seed-auth.ts`) · vitest setupFile (`tests/_setup/env.ts`) loading `.env.test.local` for env-dependent tests · second Drizzle migration (UNIQUE on `user_identities(provider, provider_id)`).
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

### 1B-2 carry-overs that bind future work

- **`getCurrentUserId()` is RSC-safe; `requireAuthedUserId()` and `ensureAnonymousSession()` are route-handler/server-action only.** Calling the writers from an RSC throws (Next.js can't `cookies().set()` in RSC). Don't paper over with try/catch.
- **`writeAuthedSession(userId)` and `clearSession()`** are exported from `session.ts` for direct use by routes that bypass `ensureAnonymousSession` (e.g., `/api/claim-anonymous` writes the authed cookie directly).
- **`promoteToAuthed(db, {anonymousUserId, email})` is the merge.** Three branches: (a) no anon, no existing → new user from scratch; (b) anon present, no existing → promote in place; (c) existing found → re-point cases, transfer profile only if target has none, delete anon user + anon org. Self-merge fast-path (existing.id === anonymousUserId) just touches `last_seen_at`. `email` MUST arrive lowercased + trimmed.
- **`organizations.kind` strings:** `'individual'` (authed individual users from branch-a or merged-into target), `'individual_anon'` (anon orgs created by `ensureAnonymousSession`). The 1B-1 seed used `'personal'` — diverged on purpose; the column is plain text.
- **`activity_log` payloads from auth:** `auth.promoted_anon` (branch b) `{email, from: 'anonymous'}` on `userId=anonId`; `auth.merged_anon` (branch c) `{from, into, email, casesMerged, profileTransferred}` on `userId=targetId`. Email is logged INTENTIONALLY in `auth.*` rows — that's the audit trail. Do NOT log email in any other `activity_log.payload` (PII rule).
- **`onConflictDoNothing({target: [provider, providerId]})` on user_identities** is what makes branch (b) race-safe. The UNIQUE constraint added in migration `0001_high_leo.sql` is what makes the ON CONFLICT clause resolvable. Tests verify both.
- **`/api/claim-anonymous` is the only place that reads `auth()`.** The Auth.js `redirect` callback unconditionally routes there; the handler reads the verified email, runs `promoteToAuthed`, writes our cookie, calls `signOut({redirect: false})` to drop Auth.js's JWT. Don't add other call sites — the JWT is treated as ephemeral.
- **Test-time env loading:** `vitest.config.ts` registers `tests/_setup/env.ts` as a setupFile; it loads `.env.test.local` into `process.env` BEFORE any module imports. Without it, `@/lib/env`'s validation runs against an empty env at import time and throws. Don't add a `beforeAll` shim — too late.
- **No tests for `session.ts`** — its read APIs depend on Next.js's `cookies()` runtime. Exercised by `tests/auth/claim.test.ts` (mocked `cookies()`) and the manual smoke. Task 11 mocking pattern: `vi.mock('@/lib/db/client', () => ({ get db() { return testHandle.db; }, schema }))` — getter is essential so `beforeAll` can write `testHandle` before the route resolves it.

### 1B-3 carry-overs that bind future work (Tasks 1–14, established so far)

- **shadcn 4.x in this repo:** initialized with `style: "radix-nova"`, `iconLibrary: "lucide"`, full alias map (`ui`, `lib`, `hooks`, `components`, `utils`). The `shadcn` package is **not** a dependency — adding it back contradicts CLAUDE.md. shadcn 4.x's `init` command repeatedly tries to add itself; if you run shadcn CLI again, remove it from `package.json` afterward.
- **`@import "shadcn/tailwind.css"` is bogus.** `shadcn init` injects this line into `globals.css`; the file doesn't exist as a package export and breaks `pnpm build`. We removed it (commit `d6596e1`). If shadcn's CLI re-injects it after a future `add`, remove it again.
- **System prompt:** `prompts/agent/v0-stub.md` loaded as a constant via `readFileSync` at module load. `PROMPT_VERSION = 'v0-stub'`. Phase 2 replaces the file with `v0.md` and bumps the constant; logged on every assistant message.
- **`makeUpdateCaseTool(repo, defaults)` signature:** factory now takes `defaults = { defaultCaseId, defaultSourceTurnId }`. The LLM-facing schema (`UpdateCaseInputSchemaForLLM`) omits `caseId` and `sourceTurnId` — the route injects them. Phase 2 tools that follow the same pattern should pass route-known plumbing as `defaults`, not as LLM input. Tool's `providerOptions.anthropic.cacheControl: { type: 'ephemeral' }` is set so prompt-caching at the tool boundary survives the Phase 2 catalog expansion.
- **`createCase` now wraps cases + case_facts + threads in a single tx** and returns `{ caseId, threadId }`. `loadCase` returns `threadId`. Exactly one thread per case in MVP. The previous unwrapped two-insert pattern is gone (orphan-case risk closed as a side effect).
- **`appendChatTurn(input, db?)` is the single chat-persistence path** (`src/lib/ai/chat/persistence.ts`). One tx writes user msg + assistant msg + N tool_calls + updates `threads.lastMessageAt`. Server mints `assistantMessageId`; caller provides `userMessageId`. Returns `{ assistantMessageId }`. Two transactions per turn (tool-side via `update_case` + chat-side via this) — if chat-side fails after tool-side succeeds, the case file is correct but history loses a turn. Accepted degradation; eval workflow in Phase 7 will catch trends.
- **`buildAgentContext` is a stub** (`src/lib/ai/chat/context-builder.ts`). Currently returns `{ caseFactsJson: JSON.stringify(input.caseFacts) }`. Async signature is intentional — Phase 2 adds awaits for messages/eligibility/knowledge.
- **`MODEL_ID = 'claude-sonnet-4-7'`** in `src/lib/ai/provider.ts`. Pinned; don't change without checking in.
- **`@ai-sdk/anthropic` and `@ai-sdk/react` are deps, not just `ai`.** v5 split the React hook surface into a separate package.
- **Inngest v4 API change:** the plan's `createFunction(opts, trigger, handler)` 3-arg form is OBSOLETE in v4.4. The actual signature is `createFunction(options, handler)` where `triggers` lives inside options: `{ id: 'log-case-event', triggers: [{ event: 'case.facts.updated' }] }`. Verified at `node_modules/inngest/components/Inngest.d.ts:507`. Task 9's `serve({ client, functions })` from `inngest/next` is unchanged; the v4 break is scoped to `createFunction`.
- **Inngest function handlers exported separately for tests.** `logCaseEventHandler` is exported alongside the wrapped `logCaseEvent`. Tests invoke the handler directly with a fake `step.run<T>(_id, fn) => fn()` rather than booting the Inngest runtime.
- **Inngest payload shape:** `{ paths, sourceTurnId }` only — `caseId` lives on the `activity_log.case_id` parent column. Don't duplicate. `kind: 'inngest.echo'` for the trivial logger; future workflows add their own kinds.
- **Inngest event keys are optional in dev, required in prod.** The client uses conditional spreads (`...(env.INNGEST_EVENT_KEY && { eventKey: env.INNGEST_EVENT_KEY })`) so undefined keys aren't passed to `new Inngest({...})`. Same `superRefine` pattern as `AUTH_RESEND_KEY` in `EnvSchema`.
- **`vi.mock('@/lib/db/client', () => ({ get db() { return testHandle.db; }, schema }))` getter pattern** is mandatory whenever a route or Inngest handler imports `db` directly (non-lazy). Without the getter, `testHandle` is undefined when vitest hoists the mock factory. Persistence helpers and the repository use lazy `require('@/lib/db/client').db` to sidestep this — but route handlers can't, since hoisted top-level imports don't see lazy require.
- **CJS `require('@/lib/db/client').db` does not resolve under vitest.** This was hypothesized in CLAUDE.md and confirmed by Tasks 10/11. Routes (`/api/case/new`, `/api/chat`) must `import { db } from '@/lib/db/client'` and pass it explicitly to `makeRepository(db)` and `appendChatTurn(input, db)`. The `get db()` mock getter then takes effect. The lazy `getDefaultDb()` path inside `repository.ts` and `persistence.ts` only works for non-test consumers (RSC, smoke). **Phase 2 routes must follow the same pattern.**
- **`/api/chat` request body schema:** `z.object({ caseId: z.string().uuid(), messages: z.array(z.unknown()).min(1) })`. Empty messages array is rejected with 400. The 401 (no cookie) and 403 (cross-user) tests must send a non-empty `messages` array to reach the auth/ownership checks instead of failing at parse.
- **`/api/chat` `onFinish` payload mapping:** filter `event.toolResults` (not `toolCalls`) by `toolName === 'update_case'`, then read `result.output.data.updatedPaths` to build the Inngest `case.facts.updated` event. Variable names in route.ts are `updateResults` / `result` — not `updateCalls` / `call`. Don't drift back: results carry `toolName` AND `output`; calls don't carry `output`.
- **`anthropic(MODEL_ID) as unknown as LanguageModel` cast in `/api/chat`** is required because the lockfile has both `ai@5.0.192` AND `ai@6.0.191` installed (`@ai-sdk/react@3.0.193` transitively pulls in `ai@6`). `@ai-sdk/anthropic@3.0.80` returns `LanguageModelV3` while `ai@5`'s `streamText` types `LanguageModelV2`. Same runtime shape; nominal TS mismatch. Has a `// reason:` comment per CLAUDE.md rule #1. **Phase 2 cleanup:** align `ai` to `^6` (or downgrade `@ai-sdk/react`) and remove the cast; while doing so, also re-check the `ChatPanel.tsx` cast (#3 below). All `streamText` / `convertToModelMessages` / `stepCountIs` / `tool()` call-sites are likely backward-compatible with v6, but verify.
- **`ChatPanel.tsx`'s `transport` cast** is the same dual-`ai`-package issue (`Parameters<typeof useChat>[0] extends { transport?: infer T } ? T : never`). Has the same `// reason:` comment; remove together with the route cast when `ai` is unified.
- **`useChat` v5 option name is `messages`, not `initialMessages`.** Plan said `initialMessages`; AI SDK v5 renamed it. The component prop name on `<ChatPanel>` is still `initialMessages` (the public API), but the option destructured into `useChat` must be `messages: initialMessages`.
- **`useChat` keeps the FIRST render's transport in a ref.** Subsequent transport instances are ignored. `ChatPanel.tsx` uses `useMemo([caseId])` to express that intent (`new DefaultChatTransport(...)` is allocated once per `caseId`). If a future change wants the transport to react to a new prop (e.g. swapping endpoints), the right pattern is to bump `useChat`'s `id` prop, not to rely on transport reference equality.
- **`messageContainsUpdateCase` only checks `tool-update_case*` parts.** AI SDK v5's `UIMessagePart` discriminator never produces `type: 'tool-call'` for static tools — they serialize as `type: 'tool-${name}'`. Don't add a defensive `tool-call` branch back; it would be dead code (Task 13 review removed it). Dynamic tools use `type: 'dynamic-tool'` with a separate `toolName`, but `update_case` is a static `tool()`.
- **CSS Grid layout:** `<div className="grid h-screen grid-cols-[220px_1fr_360px]">`. Nav (left), Overview (center scrollable), ChatPanel (right). The `220px` and `360px` track widths are hardcoded in `Layout.tsx`. If the design doc shifts, update there.
- **`Overview.tsx` `SECTION_ORDER` is `['employment', 'education', 'family', 'target']`.** The plan and design-doc both said `'risk'`, which doesn't exist on `CaseFacts` — Phase 1A's schema only defines `target` (not `risk`). The fix landed in Task 12 (`18a6a8a`); flagged here so future readers don't "fix" it back. The eligibility verdict (`EligibilityVerdictSchema` in `case/schema.ts`) is a separate top-level export, not a key on `CaseFacts`.
- **`isFieldValue` type guard in `Overview.tsx` only checks `'value' in v && 'source' in v`.** It claims `confidence: number` and `updatedAt: string` in its type predicate but does not validate them at runtime. Acceptable because every leaf reaching it comes from `CaseFactsSchema`-validated JSONB written via `update_case`. If you ever feed Overview from a non-validated source, tighten the predicate or use a small `getDisplayValue(field)` helper.
- **`/case/[id]/page.tsx` exports `runtime = 'nodejs'` AND `dynamic = 'force-dynamic'`.** Both required: Node runtime for `pg`/`next-auth`, force-dynamic because it reads cookies + DB at render time. Without the latter, Next will try to statically optimize and fail at build.
- **Cross-user case access redirects to `/`, not 404.** `loaded.case.userId !== userId → redirect('/')`. This is observable (different from `notFound()`) but acceptable for MVP (case IDs are uuids; enumeration impractical). Plan-canonical decision; don't change without spec discussion.
- **`messages.role` is plain text** in the schema (`role: text('role').notNull()`). The case page narrows it via `m.role as 'user' | 'assistant' | 'system'` when constructing `initialMessages: UIMessage[]`. If a future migration adds a `'tool'` role on the messages table, this narrowing breaks silently — add the new variant to the cast and to `ChatPanel.tsx`'s render.
- **Initial messages fall back to `[{ type: 'text', text: m.content }]`** when `m.parts` is null — which it is for user-message rows (we store `parts: null` per `appendChatTurn`). The fallback gives the renderer something to draw on the first paint after a hard refresh.

### Active issue at end of Tasks 1–14: manual smoke fails with "Case not found"

**Symptom:** `/` → "Start a case" → POST `/api/case/new` → 303 redirect to `/case/<uuid>` → page renders `not-found.tsx` ("Case not found / Start a new case"), NOT the 3-column workspace.

**What's verified:**
- `pnpm test` 109/109 green; `tsc --noEmit` clean; `lint` clean; `build` green.
- DB state inspected via `scripts/debug-db-state.ts` (`pnpm exec tsx scripts/debug-db-state.ts` with `--env-file=.env.local` — see commit `a9efc73`): organizations=1, users=1 (anon), cases=3, case_facts=3, threads=3, messages=0. All cases owned by the same anon user. Each case has exactly 1 thread + 1 case_facts row. So `loadCase(id)` *should* return cleanly for any of those caseIds.
- The route under test is server-rendered: `src/app/case/[id]/page.tsx`. Its `try { loaded = await repo.loadCase(id); } catch (err) { console.error(...); notFound(); }` is the only path to `not-found.tsx` (other than `redirect('/')` on missing user or ownership mismatch, which would NOT show "Case not found" — it would show the landing page).
- A bare `catch` in commit `2e1b642` swallowed the actual exception. Commit `a9efc73` adds `console.error('[CasePage] loadCase threw for', { id, userId, err })` and `console.error('[CasePage] ownership mismatch', { id, caseUserId, cookieUserId })` so the next repro prints the real cause to the `pnpm dev` terminal.

**Hypotheses NOT yet ruled out (in rough likelihood order):**
1. `loadCase` is throwing on something non-obvious — Zod parse on `case_facts.data = {}` (empty object), profile lookup on a userId with no profile row (returns null, parsed to null — should be fine), the threads query (verified: each case has exactly 1 thread, so `threadRows[0]?.id` should resolve). The new `console.error` will pinpoint which step.
2. Cookie-vs-DB drift: the browser's `visa_session` cookie points to a userId that no longer exists (e.g. DB was wiped between sessions; cookie persisted; `getCurrentUserId()` returns a stale userId; `redirect('/')` fires on the unauthenticated path before `notFound`). But this would show the landing page, not "Case not found". Unless — and this is the cleanest unverified explanation — the redirect from `/api/case/new` is somehow landing on a stale URL the browser had cached. **Ask the user to: (a) restart `pnpm dev` after the latest commits, (b) hard-refresh `/` in a fresh tab, (c) Cmd-Shift-Delete cookies if needed, (d) click "Start a case", and copy the `pnpm dev` terminal output.**
3. The `not-found.tsx` route is rendering for a DIFFERENT reason — Next.js's automatic 404 might fire if `dynamic = 'force-dynamic'` isn't picked up by the dev server until restart. The route was added in `2e1b642`; if `pnpm dev` was running before that, it may not have re-detected the route. **A `pnpm dev` restart should be the first step on resume.**
4. A middleware or layout file is intercepting — but `next.config.ts` is minimal (verified) and there is no `src/middleware.ts` (verified). Ruled out.

**Resume protocol:**

1. `git pull` is unnecessary — branch is 22 commits ahead of `origin/main` and not pushed. The latest local commit is `a9efc73 debug: log loadCase error + ownership mismatch in case page; add db-state inspector`.
2. Stop any running `pnpm dev` and `npx inngest-cli@latest dev`. Restart both.
3. Open `http://localhost:3000` in a fresh tab (consider clearing `localhost` cookies first to make sure the cookie path doesn't leak from prior sessions).
4. Click "Start a case". Watch the `pnpm dev` terminal for `[CasePage] loadCase threw for ...` or `[CasePage] ownership mismatch ...` log lines.
5. If you see an error log: that's the root cause — read the stack, fix, recommit. Remove the debug `console.error` once fixed (keep the structured logs minimal).
6. If you see NO error log but still get "Case not found": Next is rendering `not-found.tsx` without entering `CasePage`. That's a routing issue (force-dynamic, runtime, or the dynamic segment); inspect `dynamic`/`runtime` exports, check the URL the redirect lands on, and check Next's compile output for whether `/case/[id]` actually compiled.
7. If the smoke is green: revert the debug commit `a9efc73` (or just remove the `console.error` lines and `scripts/debug-db-state.ts`), commit the cleanup, then proceed to Task 15.

`scripts/debug-db-state.ts` is a one-off DB state inspector. Run with `node --env-file=.env.local --import tsx scripts/debug-db-state.ts`. It prints table counts, the most recent 5 cases (with thread/facts cardinality), the most recent 3 users, and the threads schema. Useful any time you suspect data drift; not a long-term tool — delete or move to `scripts/dev-only/` later.

### Resume point for the next agent: finish Task 14 manual smoke, then Task 15

Tasks 1–14 code is complete and committed locally; branch is 22 commits ahead of `origin/main` (3 pre-execution design-doc commits + 19 implementation commits from Tasks 1–14 + 1 debug-instrumentation commit). NOT pushed. **Task 14's manual smoke FAILED** — see "Active issue" section above for full diagnostic state.

Read in order:

1. The "Active issue at end of Tasks 1–14" section above — full debugging context, verified facts, hypotheses, and resume protocol.
2. `docs/superpowers/specs/2026-05-28-phase-1b-3-chat-workspace-design.md` — design (canonical when ambiguity arises).
3. `docs/superpowers/plans/2026-05-28-phase-1b-3-chat-workspace.md` — original 15-task plan.

**Pick up by reproducing the smoke** with the new `console.error` instrumentation in place (commit `a9efc73`). Apply the systematic-debugging skill — root cause before fix. The instrumentation will tell you whether `loadCase` is throwing (and what), or whether ownership mismatch is firing, or whether the route isn't compiling at all (no error log → routing issue, see hypothesis #3).

After the smoke is green:
- **Cleanup:** remove the `console.error` lines from `src/app/case/[id]/page.tsx` (keep the bare `catch { notFound() }` shape) and decide whether `scripts/debug-db-state.ts` stays (probably yes, as a Phase-2 sanity tool, but rename to `scripts/dev-only/db-state.ts` if we want a separate convention).
- **Task 15** — Final verification gate: `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`. No code changes.
- **CLAUDE.md update** — mark 1B-3 complete, replace this resume-point block with a Phase 2 pointer, move the active-issue section to a "Resolved issues" log if you want a paper trail (or just delete).
- **Push** — `git push origin main`. Branch is 22 commits + however many cleanup/fix commits ahead.

Use `superpowers:subagent-driven-development` only if the smoke fix turns out to be a multi-task remediation. For a one-shot fix, do it directly with the systematic-debugging skill.

**Pinned decisions the plan inherits — do NOT redebate:**
- Server mints `userMessageId`; never trust client-supplied ids.
- Persistence is two independent tx per turn (tool-side `update_case` + chat-side `appendChatTurn`). Chat-side failure = history loses a turn, case file is still correct.
- Inngest emit lives in `/api/chat`'s `onFinish` (best-effort), not in the tool. Repository stays Inngest-free.
- Prompt cache: system + tool only in 1B-3 (per-message and per-context caching wait for Phase 2).
- `router.refresh()` fires once per turn from `useChat.onFinish`, gated on whether the assistant message contains an `update_case` tool part.
- Anthropic model: `claude-sonnet-4-7` (pinned in `src/lib/ai/provider.ts`).
- Inngest dev keys optional; production env validation requires them.
- Cross-user `loadCase` redirects to `/`, not 404.
- `useChat` v5 option name: `messages` (NOT `initialMessages`); component prop name still `initialMessages`.
- Dual `ai@5` + `ai@6` install (transitive via `@ai-sdk/react@3`); two contained `as unknown as` casts have `// reason:` comments. Phase 2 cleanup: align package versions.

**Last commit:** `a9efc73 debug: log loadCase error + ownership mismatch in case page; add db-state inspector`. Branch tip is 22 commits ahead of `origin/main`. User paused execution after the manual smoke failed and asked to checkpoint state for the next agent.

After 1B-3 lands, the next phase is Phase 2 per `IMPLEMENTATION_PLAN.md`: real `prompts/agent/v0.md`, real `buildAgentContext` (PRD §8.3), the rest of the tool catalog, eligibility wiring, persona-driven E2E.

---

## Origin

Visa is a pivot from an earlier project (Nomad) at `~/Projects/nomad/`. About 40–50% of Nomad's code ports cleanly — rules YAML, eligibility engine, Anabin seed, knowledge base, profile schema with provenance. The other half (chat UI, agent loop, renderer registry, Drizzle schema) is being redesigned for the case-management architecture. See Phase 1 of the implementation plan for what to copy.

The pivot decision and architecture rationale are documented in the conversation history. If you need context on why a decision was made, ask the user — don't infer.
