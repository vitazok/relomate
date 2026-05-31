# CLAUDE.md — Project Context for Visa

Persistent context. Read at session start. Update when architectural decisions change.

Companion files:
- `PRD.md` — full product spec. Reference by section number (e.g., "implement §7.2.4")
- `IMPLEMENTATION_PLAN.md` — phase-by-phase build plan with verification gates

---

## What is Visa?

AI-native case-management platform for skilled workers applying for the **EU Blue Card to Germany**. Users describe their situation in chat; the system builds a structured case file, runs deterministic eligibility, drafts the documents (cover letter, employer letter, CV, VIDEX visa form), and produces a complete submission package.

The product is the **case**, not the chat. Chat is one panel — always visible — but the case file is the spine.

MVP scope: **Germany Blue Card · India source · Bengaluru consulate · web only · multi-persona testing**.

Not in MVP: appointment booking, native mobile, payments, multi-language UI, multi-channel notifications. Architecture supports these as contained later projects.

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
5. **Single-threaded writes.** Only the agent writes case state, only via the `update_case` tool. Other tools fetch/draft/dispatch — they don't mutate.
6. **No string concatenation for user-visible text.** Use i18n keys even though MVP is English-only.
7. **No hardcoded numbers/thresholds in code or prompts.** All in `config/rules/*.yaml`. The LLM never quotes a number — it calls a tool.
8. **Tool outputs are typed `{type, version, data}` discriminated unions.** Frontend dispatches via a renderer registry. Versioned for backward compat.
9. **All facts have provenance.** Every leaf on Profile / CaseFacts has `value`, `source`, `confidence`, `sourceTurnId`, `updatedAt`. Reuse the user-message uuid as `sourceTurnId` — don't mint a fresh one.
10. **Messages are append-only.** No UPDATE on `messages` / `activity_log` / `*_changes` tables.
11. **System prompt versioning.** Prompts in `prompts/`, version-controlled. Every assistant message logs `prompt_version`.
12. **Approvals are explicit.** Extracted data, drafts, generated forms are drafts until the user approves. Workflow engine pauses on approval gates.
13. **Long-running work goes through Inngest.** Anything > ~1s. Tools that dispatch to workers return immediately with a job id.
14. **Background work checkpoints.** Inngest steps. Failures resume from checkpoints, not from scratch.
15. **No comments narrating what code does.** Only non-obvious intent or constraints.
16. **Conventional commits:** `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`.

---

## What NOT to do

- LLM never quotes year-specific numbers (salary thresholds, fees, processing times). Always via a tool that reads `config/rules/`.
- Don't skip Zod validation on tool I/O.
- Don't mutate the messages table.
- Don't implement vector search over the user's own history. Use structured case + summary.
- Don't introduce a new dependency without asking.
- Don't generate UI as markdown blocks from the LLM. Artifacts are tool outputs that render via the registry.
- Don't silently overwrite a fact when the user contradicts. Acknowledge, confirm, then update.
- Don't suggest a user "definitely qualifies." Eligibility is deterministic; uncertainty is explicit.
- Don't auto-submit anything anywhere — out of scope.
- Don't scrape consulate / VFS / VIDEX sites — out of scope.
- Don't add features outside the PRD. Raise it before implementing.
- Don't use real personal data in tests. Synthetic personas only.
- Don't log PII (passport numbers, bank account numbers). Mask in logs.
- Don't drop a load-bearing detail from CLAUDE.md without checking it's in code or Stack gotchas.

---

## File tree

See PRD §3.3 for the full layout. Key locations:

- `prompts/agent/v0.md` — main agent system prompt (`PROMPT_VERSION = 'v0'`)
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

These bit us before. Don't redo.

### Build / tooling
- **shadcn CLI:** package is `shadcn` (not `shadcn-ui`). CLI-only — `pnpm dlx shadcn@latest …`. Don't add as a dependency. shadcn 4.x's `init` repeatedly tries to add itself; remove from `package.json` afterward. shadcn 4.x init in this repo: `style: "radix-nova"`, `iconLibrary: "lucide"`, full alias map.
- **Bogus `@import "shadcn/tailwind.css"`:** `shadcn init` injects this into `globals.css`; the export doesn't exist and breaks `pnpm build`. Removed (`d6596e1`); remove again if re-injected.
- **pnpm 11 build-script approvals:** `pnpm-workspace.yaml` under `allowBuilds:` (a `name: true|false` map), NOT `onlyBuiltDependencies:`.
- **Vercel region:** pinned in `vercel.json`, not `next.config.ts`.
- **`tsx` invocation:** `node node_modules/.bin/tsx` fails. Use `pnpm exec tsx` or a `pnpm` script.
- **Drizzle scripts** load env via Node's `--env-file=.env.local` flag (no `dotenv` package).

### Database / Supabase
- **Two URLs:** `DATABASE_URL` is the **transaction pooler** (port 6543) for runtime; `DIRECT_URL` is the **session pooler** (port 5432) for `drizzle-kit migrate`. The bare direct connection is IPv6-only and won't work locally or on Vercel. Pooler username is `postgres.<project-ref>`.
- **Test schema isolation** (`tests/_db/setup.ts`) strips `"public"."<table>"` references from migration SQL before applying to test schemas (drizzle-kit emits these in FK clauses; without stripping they cross-schema-reference back to `public`). Don't re-add.
- **Pool `search_path`** is baked into the test URL via `options=-c%20search_path=<schema>`. Repository code MUST NOT call `SET search_path = ...` itself. The unused `_schemaName` parameter on `makeRepository(db, _schemaName)` is intentional.
- **`confidence` is `numeric(3, 2)`.** Drizzle returns it as a string; writes use `String(confidence)`, reads need `Number(...)` casts.

### Next.js 16 / React 19
- **Cookies in RSC:** server components cannot call `cookies().set()`. Split read-only (RSC-safe) and write paths (route handlers / server actions only). `getCurrentUserId()` is RSC-safe; `requireAuthedUserId()` and `ensureAnonymousSession()` are writers.
- **No setState in effect:** React 19 rule. Use `useSyncExternalStore` for external state polling.
- **Pages reading cookies + DB at render need `runtime = 'nodejs'` AND `dynamic = 'force-dynamic'`.** Without force-dynamic, Next tries to statically optimize and fails at build.
- **`useFormState` is soft-deprecated in React 19.** Use `useActionState` from `react` (gives `isPending`).

### AI SDK v5/v6
- **`convertToModelMessages` is async** — must be `await`ed.
- **`useChat` transport** is constructed explicitly: `transport: new DefaultChatTransport({ api: '/api/chat' })`. The `api` option on `useChat` is gone.
- **`useChat` v5 option name is `messages`, not `initialMessages`.** AI SDK v5 renamed it. Component prop name on `<ChatPanel>` stays `initialMessages` (public API), but the `useChat` option must be `messages: initialMessages`.
- **`useChat` keeps the FIRST render's transport in a ref.** Subsequent transport instances are ignored. Use `useMemo([caseId])` to allocate once. To swap endpoints, bump `useChat`'s `id` prop.
- **`tool()` from `ai`:** `{description, inputSchema (Zod), execute}`. Don't use `dynamicTool` (that's for runtime-shape MCP tools).
- **`stopWhen: stepCountIs(N)` with N≥2** is required to get a natural-language reply *after* a tool call. Default `1` emits the call but the model never reads the result.
- **Anthropic prompt caching** via `providerOptions.anthropic.cacheControl: { type: 'ephemeral' }`. Per-message AND per-tool. Tool breakpoints live on **each tool's own `providerOptions`**.
- **Static-tool message parts serialize as `type: 'tool-${name}'`,** never `type: 'tool-call'`. Don't add a defensive `tool-call` branch — dead code. Dynamic tools use `type: 'dynamic-tool'` with separate `toolName`.
- **`ai` aligned to `^6` (resolved 2026-05-30, 2A.1 live smoke).** Previously the repo pinned `ai@5` while `@ai-sdk/react@3` transitively bundled `ai@6`; `@ai-sdk/anthropic@3.0.80` returns a `LanguageModelV3` that `ai@5`'s `streamText` rejects at **runtime** (`AI_UnsupportedModelVersionError: v3`) — every `/api/chat` call 500'd, and the `as unknown as LanguageModel` cast hid it from `tsc`. Fix: bump `ai` to `^6` (its `LanguageModel` union includes V3), dedupes onto the `6.0.191` react already used; both `as unknown` casts (model in route, transport in ChatPanel) removed. **Caught only by the live smoke — all unit tests mock `streamText` and never hit the real provider→SDK handshake.** Don't re-add the casts or re-pin `ai@5`.
- **Anthropic allows max 4 `cache_control` breakpoints.** **Resolved in 2A.2 (`c466a0e`/`cdcf40c`):** the per-tool breakpoints were consolidated to a SINGLE breakpoint on `lookup_anabin` (the last-registered tool — a breakpoint there caches the whole static tools prefix). The other five tools carry NO `providerOptions`. Do NOT re-add per-tool breakpoints, and do NOT add a top-level `streamText` `providerOptions.anthropic.cacheControl` (the system string embeds per-turn case context → near-certain miss + would be a 2nd breakpoint). `lookup_anabin` MUST stay last in the `tools` object. The `agent-turn` test asserts exactly-one breakpoint (count, not position).

### Inngest
- Local dev: `npx inngest-cli@latest dev` alongside `pnpm dev`. Webhook is `/api/inngest`.
- Steps must be deterministic. Don't call `Date.now()` or `Math.random()` outside `step.run()` blocks.
- `step.waitForEvent()` is the approval gate primitive. 30-day max wait by default.
- **`createFunction(options, handler)` — 2-arg, not 3-arg.** v4.4 moved `triggers` inside options: `{ id: 'log-case-event', triggers: [{ event: 'case.facts.updated' }] }`. Verified at `node_modules/inngest/components/Inngest.d.ts:507`.
- **Export Inngest handlers separately for tests.** E.g. `logCaseEventHandler` exported alongside the wrapped `logCaseEvent`. Tests invoke the handler directly with a fake `step.run<T>(_id, fn) => fn()` — don't boot the runtime.
- **Event keys optional in dev, required in prod.** Use conditional spreads: `...(env.INNGEST_EVENT_KEY && { eventKey: env.INNGEST_EVENT_KEY })`. Same `superRefine` pattern as `AUTH_RESEND_KEY`.

### Auth.js v5 (verification-only pattern)
- Don't use `@auth/drizzle-adapter`; don't add `accounts` / `sessions` tables. Auth.js sends magic link, verifies token, writes a JWT cookie. Our HMAC `visa_session` cookie is the app session of record.
- **`signIn` callback fires twice for email provider:** once at request time with `email.verificationRequest: true` (return `true` to send), once after click. Returning a redirect string short-circuits before Auth.js sets JWT — use the `redirect` callback instead.
- **`/api/claim-anonymous` is the only place that reads `auth()`.** The Auth.js `redirect` callback unconditionally routes there; the handler reads the verified email, runs `promoteToAuthed`, writes our cookie, calls `signOut({redirect: false})`. The JWT is treated as ephemeral. Don't add other call sites.
- **Adapter type imports:** `next-auth@5` re-exports adapter types at `next-auth/adapters` (NOT `@auth/core/adapters` — transitive package, couples to pnpm hoist).
- **Production env validation runs during `next build`.** `EnvSchema.superRefine` requires `AUTH_RESEND_KEY`, `EMAIL_FROM`, `AUTH_URL` in production. `EMAIL_FROM` must be a plain email (`z.string().email()`); RFC 5322 display-name format converts at the Resend call, not in env.
- **Email normalization:** lowercase + trim at every entry point (server action AND claim handler). The route's `auth()` returns whatever Auth.js parsed; assume casing/whitespace.
- **Activity-log audit trail:** `auth.promoted_anon` and `auth.merged_anon` rows log `email` INTENTIONALLY. Do NOT log email in any other `activity_log.payload` (PII rule).
- **Cross-user `loadCase`** redirects to `/`, not 404. Plan-canonical decision; observable but acceptable for MVP.
- **Anon→authed merge tombstones, never deletes, the anon user.** Branch (c) of `promoteToAuthed` (anon signs in with an email that already has an account) re-points `cases` + transfers/drops the profile, then leaves the anon `users`/`organizations` rows in place as dead tombstones. It does NOT delete them. Reason: `activity_log` + `profile_changes` rows written under the anon id during the session reference `users.id` with `ON DELETE no action`; deleting throws an FK violation (rolls back the whole merge → sign-in 500s), and re-pointing those audit rows would violate the append-only rule (10). The merge pointer is recoverable from the `auth.merged_anon` log row (`{from, into}`). Do NOT re-add the `delete(users)`/`delete(organizations)` calls. Regression test: `tests/auth/merge.test.ts` "preserves anon-owned audit rows".

### Tests / vitest
- **Module-scope env validation breaks vitest imports.** `@/lib/env` validates at top-level. Tests touching env-dependent modules need `tests/_setup/env.ts` registered as `setupFiles` in `vitest.config.ts` — it loads `.env.test.local` BEFORE any module imports. Don't add a `beforeAll` shim; too late.
- **`require('@/...')` is broken everywhere — not just vitest.** The `@` alias is a Vite/Turbopack/tsc resolver applied to **static `import` statements at compile time**. CJS `require()` calls go straight to Node's resolver, which has no knowledge of the alias and returns `{}`. Bit us in `repository.ts` / `persistence.ts` `getDefaultDb()` — the bare-call path crashed RSC at runtime even though every test passed (because tests pass `db` explicitly, never hitting the lazy path). Fix is always static `import { db as defaultDb } from '@/lib/db/client'`. If the *reason* for the lazy import is to defer env validation, register `tests/_setup/env.ts` in `setupFiles` so eager validation just succeeds — that's the working pattern.
- **Repository / persistence default-db path:** `makeRepository()` and `appendChatTurn(input)` fall back to a static `defaultDb` import from `@/lib/db/client` when no `db` is passed. Routes / Inngest handlers / RSC pages may call them with no argument. Tests pass `db` explicitly OR mock `@/lib/db/client` with the getter pattern below.
- **Test mock pattern for `@/lib/db/client`:** `vi.mock('@/lib/db/client', () => ({ get db() { return testHandle.db; } }))`. The **getter** is essential — `vi.mock` is hoisted above imports, so `testHandle` isn't yet assigned when the factory runs. Do NOT include `schema` in the factory: `vi.mock` is hoisted above the `import * as schema` binding, so `{ schema }` references the TDZ and crashes any test that imports a module which transitively imports `@/lib/db/client` (e.g. `tests/api/chat.test.ts` importing `makeRepository`). Source code never reads `schema` from `@/lib/db/client`; it imports from `@/lib/db/schema` directly.
- **`/api/chat` body parsing is bounded and 4xx-safe.** The route reads raw text, rejects payloads > `MAX_BODY_BYTES` (256KB) with 413, guards `JSON.parse` (400 on malformed), then `safeParse`s `BodySchema` (400 on bad shape). `BodySchema` requires `messages` non-empty (`.min(1)`) and `.max(MAX_MESSAGES)` (100). 401/403 tests must send non-empty `messages` to reach auth/ownership checks. Don't revert to `BodySchema.parse(await req.json())` — that 500s on malformed input.
- **`EMAXPOOLSREACHED` on a full-suite run is INFRA, not a code bug.** Each test schema baked a distinct `search_path` into its connection URL, and the Supabase pooler (Supavisor) allocates one pool per distinct search_path. The default per-core file parallelism spins up ~15 schemas at once; repeated full-suite runs in one session compound it past the pooler's pool-count limit, and DB-touching suites fail with `error: (EMAXPOOLSREACHED) max pools count reached` (Postgres `FATAL XX000`) — only the DB tests fail; pure-logic tests stay green. Fix: re-run with `pnpm exec vitest run --no-file-parallelism` (serial, ~32s, reliably green). Don't chase it as a regression.

### Rules + eligibility
- **Rules loader caches in module scope.** Restart `pnpm dev` after YAML edits.
- **`evaluateEligibility(case, today)` is pure** — `today` parameterized so tests pin it.
- **ISCO matching is prefix-based.** `iscoMatchesAny('2512', ['25'])` is `true`. ISCO-08 is hierarchical.
- **Anabin seed defaults to `'unknown'`,** not `'H+'`. `lookup_anabin` returns `found: true, status: 'unknown'` so the agent says "we don't know yet" instead of inventing from training data.

### Tools
- Rich descriptions — write like docstrings for a junior developer.
- Single purpose per tool.
- No mutating state in tools other than `update_case`.
- Long-running tools dispatch Inngest jobs and return job ids. The agent does not await them in the chat loop.
- **`update_case` output shape:** `{type: 'update_case_result', version: 1, data: UpdateCaseResult}`. Frontend renderer registry dispatches on `type`.
- **Activity log payload from `applyUpdate`:** one row per call (not per path): `{kind: 'case.facts.updated', paths: [...], source, sourceTurnId, contradictions: number}`. Don't drift.
- **Contradiction semantics** are path-local — "same path written twice with different values at same-or-higher confidence." Cross-field contradictions are eligibility-engine territory. Surfaced in result, NOT blocking the write — both writes persist.
- **`makeUpdateCaseTool(repo, defaults)` factory** takes `defaults = { defaultCaseId, defaultSourceTurnId }`. The LLM-facing schema omits `caseId` and `sourceTurnId` — the route injects them. Phase 2 tools follow the same pattern.
- **Valid `update_case` paths come from a schema-derived catalog, NOT a hand-list.** `update_case.updates` is an open `z.record(z.string(), z.unknown())`, so the model gets no key schema and WILL guess invalid paths (`education.level`, `employment.jobCity`) unless told the real ones. `listLeafPaths()` / `formatLeafPathCatalog()` in `src/lib/case/paths.ts` enumerate the leaves (with enum options) by walking `ProfileSchema` + `CaseFactsSchema` — single source of truth, can't drift from `validateLeafPath` (a test asserts every enumerated path resolves). The catalog is injected in BOTH `buildAgentContext` (per-turn) and the `update_case` description. **2A.2 live-smoke root cause** (`c466a0e`): without it, errored path-guesses triggered retries that exhausted the step budget → dead-end no-answer turn. If you add a `CaseFacts`/`Profile` leaf, it appears in the catalog automatically — no prompt edit needed.
- **`MAX_AGENT_STEPS = 8`** (exported from `agent-turn.ts`), was 5. A turn can fan out `update_case` + `lookup_anabin`, recover via `read_case`, run `check_eligibility`, then reply — 5 dead-ended such turns. Don't lower it without re-checking the multi-tool recovery path.
- **`check_eligibility` / `lookup_anabin` (2A.2):** `check_eligibility(repo, {defaultCaseId, defaultUserId, now?})` — runs engine FIRST (out_of_scope wins over incomplete), then `assessReadiness`, then `summarizeFigures`; returns `{type:'eligibility_result', version:1, data}` with `status: out_of_scope | incomplete | assessed`; logs `case.eligibility.checked` on incomplete+assessed only (codes/paths only — NO salary, PII rule). `lookup_anabin()` — no repo, read-only; `found:false` (not seeded) vs `found:true,status:'unknown'` (seeded, unrated). Renderers `eligibility_result` + `anabin_result` in the registry.

---

## Key terminology

- **Case** — one application. Has profile, facts, documents, drafts, tasks, approvals, activity log.
- **Profile** — user-level identity (reused across cases over the user's lifetime).
- **CaseFacts** — case-specific structured state (current employment, family-as-of-application, etc.).
- **Document** — uploaded file + extracted data + confirmation status.
- **Draft** — system-generated document (cover letter, employer letter, CV, VIDEX). Versioned.
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

**MVP scope is trimmed from PRD §11.** Ship 4 archetype personas now (each a distinct rules-engine branch); 6 deferred to Phase 2. Reasoning, schema, per-persona content in `docs/superpowers/specs/2026-05-27-persona-library-design.md`.

Currently shipped (Phase 0):
- `priya-strong` (shortage route, happy path)
- `arjun-it-no-degree` (§18g(2) IT-no-degree route)
- `vikram-edge-anabin` (Anabin-unknown refusal-to-conclude)
- `out-of-scope-asylum` (off-scope refusal)

Deferred to Phase 2: `meera-strong-clean`, `rahul-recent-grad`, `kavya-distance-learning`, `out-of-scope-eu-citizen`, `out-of-scope-criminal`, `renewal-priya-y2`.

Every PR runs the persona test suite. Don't skip — strongest E2E signal we have.

---

## Build plan

`IMPLEMENTATION_PLAN.md` is the day-by-day plan. Reference by phase number. Don't skip phases. Verify each phase end-to-end.

Phase 0 (validation per PRD §21) precedes Phase 1.

---

## Current state (as of 2026-05-31)

| Phase | Status | Notes |
|---|---|---|
| 0 | complete | user-declared 2026-05-27 |
| 1A foundation | complete, pushed | plan: `docs/superpowers/plans/2026-05-27-phase-1a-foundation.md` |
| 1B-1 persistence + `update_case` | complete, pushed 2026-05-28 | plan: `docs/superpowers/plans/2026-05-27-phase-1b-1-persistence.md`. Last commit `f7ab0be` |
| 1B-2 auth + anon→authed merge | complete, pushed 2026-05-28 | spec: `docs/superpowers/specs/2026-05-28-phase-1b-2-auth-design.md`. 88/88 tests |
| 1B-3 chat + workspace + Inngest | complete, pushed 2026-05-29 | spec: `docs/superpowers/specs/2026-05-28-phase-1b-3-chat-workspace-design.md`. Plan: `docs/superpowers/plans/2026-05-28-phase-1b-3-chat-workspace.md`. 110/110 tests; smoke green |
| 2A.1 agent brain | **complete; merged to main** (PR #1 `4a457c9` + smoke-fix PR #2 `f405d59`); live-smoke PASSED 2026-05-30 | plan: `docs/superpowers/plans/2026-05-29-phase-2a-1-agent-brain.md`. 128/128 tests, build/lint/tsc clean. Live-smoke caught + fixed 3 runtime bugs the mocked unit tests missed: `ai@5`→`^6` (v3-model 500, casts removed), 5th cache_control breakpoint (400), bogus `MODEL_ID` `-4-7`→`-4-6` (404). Verified live: `update_case` self-corrects on tool errors, contradiction path, `out_of_scope` activity log + renderer output shape. |
| 2A.2 — eligibility + knowledge | **complete; live-smoke PASSED 2026-05-31** | spec: `docs/superpowers/specs/2026-05-31-phase-2a-2-eligibility-knowledge-design.md`; plan: `docs/superpowers/plans/2026-05-31-phase-2a-2-eligibility-knowledge.md`. 157/157 tests, build/lint/tsc clean. Tools `check_eligibility` + `lookup_anabin` wired in; `simulate_what_if` deferred (fold into `check_eligibility.overrides` if needed). Live-smoke caught + fixed a pre-existing bug: agent guessed invalid `update_case` paths → errored retries exhausted the step budget → dead-end no-answer turn. Fix: schema-derived path catalog (`listLeafPaths`) injected into context + tool description; `MAX_AGENT_STEPS` 5→8. Not yet merged to main (on branch `worktree-phase-2a-2-eligibility-knowledge`). |
| **2B journey-tracker dashboard (NEXT)** | **designed 2026-05-31, not started** (build as 2B centerpiece) | spec: `docs/superpowers/specs/2026-05-31-journey-tracker-dashboard-design.md` (commit `4db6846`). Reconceives PRD §7: center column becomes a journey tracker (read-only projection over case state), sidebar sections demoted to drill-downs. See "Journey-tracker dashboard" under Next. |
| 2C persona-driven E2E | designed | layered strategy; see Pinned. After 2B. |

**Post-1B-3 review pass (2026-05-29, commits `8241e7a` + `f33895c`):** external red-flag review fixed the merge FK bug (tombstone, see Auth.js gotcha), `/api/chat` input bounds + 4xx safety, generic auth error, test `afterAll` cleanup guards, gitignore `*.swp`. Two of its deferred items are now done in 2A.1 (`buildAgentContext`/`v0` prompt; `ai@6` alignment + cast removal). **Still open, NOT a regression:** `/api/chat` accepts the full client transcript with no server-side history rebuild — revisit if/when it matters.

**Key Phase 1A decision:** the eligibility engine was *slimmed* to fit Visa's minimal `CaseFacts`, not ported verbatim from Nomad. It does NOT yet handle multi-degree arrays, ZAB statements, professional experience arrays, German level, spouse/children — Phase 2+ concerns. Engine emits exactly the codes the 4 personas expect.

### Next: Phase 2B — workspace comes alive (journey-tracker dashboard)

Phase 2 is sliced into four sessions (kept well below 1M tokens each — session-token budget, not API cost, drove the cut). **2A.1 and 2A.2 are done.** Remaining slices:

- **2B — workspace comes alive (NEXT):** the **journey-tracker dashboard** is the centerpiece — see the dedicated subsection below. Plus rich renderers (the 2A.2 registry has minimal in-chat cards) and the left-sidebar section drill-downs. 2A.2 shipped the pure `evaluateEligibility` + `summarizeFigures` + `assessReadiness` helpers the tracker reuses.
- **2C — persona-driven E2E** (layered, see Pinned): deterministic core every PR + fixture-replayed agent loop (uses 2A.1's `buildAgentTurn` model seam); live LLM nightly/on-demand. **2C gains** per-persona `computeJourneyProgress` assertions (pure, ~0 tokens) once the tracker lands.

**2A.2 outcome (complete 2026-05-31):** `check_eligibility` (ephemeral verdict + `case.eligibility.checked` activity trail; statuses out_of_scope / incomplete / assessed) and `lookup_anabin` (not-found vs seeded-unknown) are registered. Figures are threshold-centric (`summarizeFigures` reads the engine's exported `activeThreshold` — no drift; the card pairs thresholds with the engine's granted `routes`, never re-deriving). Single cache breakpoint on `lookup_anabin` (last tool). `simulate_what_if` deferred. **Live-smoke fix (see "Tools" gotcha below):** the agent was guessing invalid `update_case` paths; now a schema-derived path catalog is injected into context + the tool description, and `MAX_AGENT_STEPS` is 8.

The Pinned decisions below carry forward.

### Journey-tracker dashboard (2B centerpiece — designed 2026-05-31, not started)

Full spec: `docs/superpowers/specs/2026-05-31-journey-tracker-dashboard-design.md` (commit `4db6846`). Build **as part of 2B, after 2A.2** — it shows the eligibility verdict, which 2A.2's `check_eligibility` completes through the agent loop. Not blocked by 2A.2 (the engine computes the verdict directly), but sequencing it after avoids two passes over `CaseFacts`/`documents.yaml`/rules-loader.

Decisions locked in the spec (do NOT redebate — brainstormed with the user 2026-05-31):
- **Center column = journey tracker**, a *read-only projection* over existing case state. No new write path (rule 5 holds). Layout "Option A": tracker is the center; chat stays pinned right; **left sidebar stays** as portal chrome + section drill-down links. Tracker and sidebar are two projections of one case state.
- **Approach: config-driven.** New `config/rules/journey.yaml` (phase manifest) + pure `computeJourneyProgress(caseFacts, profile, documents, verdict, today)` in `src/lib/journey/`. Mirrors `evaluateEligibility` + rules-loader. Honors rule 7.
- **4 phases:** eligibility (8 curated steps) · documents (dynamic count from `documents.yaml`) · drafts (locked) · VIDEX+package (locked). Locked phases render greyed "coming soon" from day one.
- **Identity (Profile) folds into Documents** — extracted from passport upload, confirmed in place, consumed by VIDEX. `Profile` DB table untouched (user-level, load-bearing for anon→authed merge). No standalone Profile phase.
- **Family = one account, family as case data.** Extends `CaseFacts.family` with `spouse` + `children[]` mini-profiles (identity fields for per-member VIDEX/passport docs; address defaults to primary's, overridable). Reuses `FieldSchema`/`ArrayFieldSchema`/`CurrentAddressValue`. **Eligibility engine untouched** (family doesn't gate the primary's verdict). No auth change.
- **`documents.yaml` gains optional `condition`** (`{path, in|equals}`) so the doc count is honest (ZAB only when Anabin unknown/H-; distance-learning clarification only for distance/online; marriage/birth certs only when spouse/children present). Rules loader parses it.
- **Dual provenance (trust layer):** every step shows *requirement provenance* (`resolveCitation(cite)` resolving `legalBasis`/`sources`/`lastVerified` from the authoritative YAML — never duplicated into the manifest) AND *answer provenance* (rule-9 `source`/`updatedAt` → human copy: "You told us in chat", "Read from your passport upload", etc.). Compact line + expandable detail.
- **Renderer/ChatPanel note from 2A.1 pinned decisions still applies** — the tracker supersedes `Overview.tsx` (preserve its empty-state copy).

`scripts/dev-only/db-state.ts` is the one-shot DB state inspector; runs via `node --env-file=.env.local --import tsx scripts/dev-only/db-state.ts`.

### Pinned decisions — do NOT redebate

- Server mints `userMessageId`; never trust client-supplied ids.
- Two independent tx per turn (tool-side `update_case` + chat-side `appendChatTurn`). Chat-side failure = history loses a turn, case file still correct. Accepted; eval workflow in Phase 7 catches trends.
- Inngest emit lives in `buildAgentTurn`'s `onFinish` (best-effort), not in the tool or the route. Repository stays Inngest-free. (Pre-2A.1 it lived in `/api/chat`'s `onFinish`; Task 8 moved the loop into the factory.)
- Inngest **event** payload (`case.facts.updated`) is `{ caseId, paths, sourceTurnId }` — `caseId` MUST travel in the event (no other carrier at emit time; `CaseFactsUpdatedEvent` in `inngest/client.ts` types all three). The **handler** then writes an `activity_log` row with `caseId` in the `case_id` column and `{ paths, sourceTurnId }` in the JSON `payload`. Don't conflate the two. `kind: 'inngest.echo'` for the trivial logger.
- `onFinish` mapping (now in `buildAgentTurn`): filter `event.toolResults` (not `toolCalls`) by `toolName === 'update_case'`, read `result.output.data.updatedPaths`. Variables are `updateResults` / `result`.
- **`buildAgentTurn({ model, repo, ... })`** (`src/lib/ai/chat/agent-turn.ts`) owns the `streamText` loop: composes `systemPrompt + "\n\n" + context.systemContext`, registers the tool set, sets `stopWhen: stepCountIs(5)` + ephemeral cache, and runs `onFinish` (persist + Inngest emit). The route injects the real Anthropic model; tests inject a mock via `vi.mock('ai')` capturing `streamText` args (the 2C fixture-replay seam — `MockLanguageModelV2` stays uninstalled, needs forbidden `msw`). Route keeps only HTTP concerns.
- **Renderer registry** (`src/components/workspace/renderers/registry.tsx`): `resolveRenderer(type)` → React renderer, `FallbackResult` for unknown. Dispatches on `type` ONLY; `version` deliberately ignored while all outputs are v1 (key on `${type}@${version}` when a v2 ships — comment in file). `ChatPanel` reads the static-tool part's result off `part.output` (AI SDK v5 shape; `if (!out?.type) return null` skips in-flight/errored parts). Minimal renderers now; rich UI is 2B. NOTE for 2B: `OutOfScopeResult` is a block-level amber card rendered inside the chat bubble — revisit whether block renderers should sit outside the bubble.
- Prompt cache: system + tool only in 1B-3. Per-message and per-context caching wait for Phase 2.
- `router.refresh()` fires once per turn from `useChat.onFinish`, gated on whether the assistant message contains an `update_case` tool part. `messageContainsUpdateCase` only checks `tool-update_case*` parts.
- Anthropic model: `claude-sonnet-4-6` pinned in `src/lib/ai/provider.ts` (constant `MODEL_ID`). **(Corrected 2026-05-30: the prior pin `claude-sonnet-4-7` is NOT a real Anthropic model — the API returns `not_found_error`. Verified `claude-sonnet-4-6` against `/v1/models`. Don't restore `-4-7`.)**
- Prompt: `prompts/agent/v0.md`, `PROMPT_VERSION = 'v0'` (2A.1; the `v0-stub` was removed).
- `createCase` wraps cases + case_facts + threads in a single tx, returns `{ caseId, threadId }`. `loadCase` returns `threadId`. Exactly one thread per case in MVP.
- `appendChatTurn(input, db?)` is the single chat-persistence path; one tx per call.
- `buildAgentContext` returns `{ systemContext }` (full `CaseFacts` JSON + section-presence summary); `buildAgentTurn` composes `system = v0.md + "\n\n" + systemContext`. (Async signature kept for future Phase 2 awaits, e.g. activity tail.)

### Phase 2 pinned decisions (set during 2A.1 brainstorming — do NOT redebate)

- **Phase 2 sliced 2A.1 / 2A.2 / 2B / 2C** to keep each session well below 1M tokens. `simulate_what_if` folds into 2A.2 (it's the YAGNI tool; not on the happy path).
- **Persona testing = layered (strategy A).** Deterministic core (pure `evaluateEligibility` + tool-unit + scripted-sequence→end-state) runs every PR at ~0 tokens. The LLM-driven loop is recorded once and replayed in CI (0 tokens/PR). Live LLM run is deliberate nightly/on-demand. This is why 2A.1 builds the injectable-model seam.
- **`buildAgentTurn({ model, ... })`** (`src/lib/ai/chat/agent-turn.ts`) owns the `streamText` loop (system+context, tools, `stopWhen`, caching, `onFinish`). Route injects the real provider; tests inject a mock. The model-injection seam for 2C. Route keeps only HTTP concerns.
- **`MockLanguageModelV2` is NOT installed** — `ai/test` needs `msw` (forbidden new dep). Seam tests use the dependency-free pattern from `tests/api/chat.test.ts` (`vi.mock('ai')` capturing `streamText` args + `onFinish`). The fixture-*replay* dep question is resolved in 2C, not 2A.1.
- **Context injects FULL `CaseFacts`; `read_case` stays minimal** (targeted section/path/provenance the summary abbreviates — agent uses it sparingly). No activity tail in 2A.1's context (added in 2A.2/2B).
- **`add_case_note` → `activity_log` `kind:'case.note.added'`**; **`out_of_scope` → `activity_log` `kind:'case.out_of_scope'`**, via `repo.appendActivity({caseId,userId,kind,payload})`. No `notes` table. Neither touches case state (rule 5 holds — append-only audit log).
- **`out_of_scope` does NOT set the eligibility `outOfScope` flag.** The tool = "agent declines a conversational request"; the flag = "engine determined the case is unassessable" (set only by `evaluateEligibility`, 2A.2). A refused apartment-search request must never read as a refused eligibility assessment.
- **Renderer registry** (`src/components/workspace/renderers/registry.tsx`): `resolveRenderer(type)` dispatches tool `{type}` outputs → React component, `FallbackResult` for unknown. Minimal renderers (closes rule-8 gap; `ChatPanel` no longer renders `[tool-name]`); rich UI is 2B's job.
- **`v0.md` covers the full Phase 2 tool catalog.** As of 2A.2, all six tools (`update_case`/`read_case`/`add_case_note`/`out_of_scope`/`check_eligibility`/`lookup_anabin`) are registered and un-caveated in the prompt. `PROMPT_VERSION` stays `v0` (the Phase-2 generation, built incrementally — reserve a bump for the next generational rewrite).
- `Overview.tsx` `SECTION_ORDER` is `['employment', 'education', 'family', 'target']` (the design-doc said 'risk', which doesn't exist on `CaseFacts`). **(Superseded by 2B journey-tracker: `Overview.tsx` → `Tracker.tsx`, which renders phases not raw sections. Preserve the empty-state copy. See tracker spec.)**
- CSS Grid layout columns hardcoded `220px_1fr_360px` in `Layout.tsx`. Update there if design shifts. **(2B journey-tracker keeps Option-A 3-column shape — sidebar / tracker / chat — so the grid likely stands; confirm against tracker spec.)**
- **Renderer registry "rich UI is 2B's job" note** (above): 2B's rich UI is now anchored by the journey-tracker dashboard. The minimal renderers stay for in-chat tool outputs; the tracker is a separate center-column projection, not a renderer.
- **2B journey-tracker dashboard** (designed 2026-05-31, spec `docs/superpowers/specs/2026-05-31-journey-tracker-dashboard-design.md`): see the "Journey-tracker dashboard" subsection under Next for the full locked decision list. Touches `CaseFacts.family` (spouse/children mini-profiles), `documents.yaml` (`condition` field), rules loader, and adds `src/lib/journey/` + `Tracker.tsx`. Build after 2A.2.

---

## Origin

Visa is a pivot from Nomad (`~/Projects/nomad/`). About 40–50% of Nomad ports cleanly — rules YAML, eligibility engine, Anabin seed, knowledge base, profile schema with provenance. The other half (chat UI, agent loop, renderer registry, Drizzle schema) is being redesigned for case-management. Phase 1 of the implementation plan lists what to copy.

If you need context on why a decision was made, ask the user — don't infer.
