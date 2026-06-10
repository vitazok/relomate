# CLAUDE.md — Project Context for Relomate

Persistent context. Read at session start. Update when architectural decisions change.

Companion files:
- `PRD.md` — full product spec. Reference by section number (e.g., "implement §7.2.4")
- `IMPLEMENTATION_PLAN.md` — phase-by-phase build plan with verification gates
- `docs/context-history.md` — resolved-bug post-mortems, phase write-ups, superseded decisions. The "why" behind the terse directives here. Read the relevant section before touching that area.

Multiple developers and multiple agentic tools (Claude, Codex) work on this repository. Treat
`AGENTS.md`, `CLAUDE.md`, and `docs/context-history.md` as shared handover docs, not single-agent
memory. At the end of each coding session, review these and update them when phase state,
architectural decisions, gotchas, verification notes, or next-up work changed.

**On conflict, this is the authority order:** running code > `CLAUDE.md`/`AGENTS.md` > `PRD.md` >
`IMPLEMENTATION_PLAN.md` > everything in `docs/archive/`. `CLAUDE.md` is the only doc you must
read every session; everything else is read on demand. Live phase status lives in the
"Current state" section below — not in `IMPLEMENTATION_PLAN.md` (which is the slicing) or
`PRD.md` (which is the product spec).

**`AGENTS.md` and `CLAUDE.md` are the SAME content, byte-for-byte**, except line 1 (the title:
`# CLAUDE.md` vs `# AGENTS.md`). One is for Claude Code, the other for Codex; the rules are
tool-agnostic. When you edit one, copy the change verbatim to the other — do NOT find-replace
"Claude"↔"Codex" (that corrupts model IDs like `claude-sonnet-4-6` and product facts; the stack
is Anthropic models regardless of which tool edits the file). Verify after: `diff` the two files
should show ONLY the line-1 title difference.

---

## What is Relomate?

AI-native immigration operating system for firms handling **EU Blue Card to Germany** cases. Consultants, reviewers, operations managers, applicants, and employer contacts work around one durable case file. The system builds structured facts, runs deterministic eligibility, collects and validates documents, drafts artifacts (cover letter, employer letter, CV, VIDEX visa form), prepares the submission package, and routes consequential outputs through human review.

The product is the **firm-operated case**, not the chat. Chat is one panel in the consultant workspace, but the case file, review queue, task list, audit trail, and firm console are the spine.

MVP scope: **Germany Blue Card · India/Bengaluru + Canada/Toronto source/residence flows · firm-first web app · applicant portal · multi-persona testing**.

Not in MVP: appointment booking/monitoring, native mobile, payments, multi-language UI, multi-channel notifications beyond email. Architecture supports these as contained later projects.

---

## North Star

> A firm can operate many Germany Blue Card cases with AI doing routine case work, applicants supplying inputs through a portal, and consultants/reviewers approving consequential outputs before anything is treated as ready to submit.

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
5. **Single-threaded case-fact writes.** Only the agent writes case facts via the `update_case` tool. Other tools fetch/draft/dispatch/create operational artifacts only through typed server-side paths. Deterministic review actions may call `repo.applyUpdate` where already established, but do not add new LLM-controlled write paths.
6. **No string concatenation for user-visible text.** Use i18n keys even though MVP is English-only.
7. **No hardcoded numbers/thresholds in code or prompts.** All in `config/rules/*.yaml`. The LLM never quotes a number — it calls a tool.
8. **Tool outputs are typed `{type, version, data}` discriminated unions.** Frontend dispatches via a renderer registry. Versioned for backward compat.
9. **All facts have provenance.** Every leaf on Profile / CaseFacts has `value`, `source`, `confidence`, `sourceTurnId`, `updatedAt`. Reuse the user-message uuid as `sourceTurnId` — don't mint a fresh one.
10. **Messages are append-only.** No UPDATE on `messages` / `activity_log` / `*_changes` tables.
11. **System prompt versioning.** Prompts in `prompts/`, version-controlled. Every assistant message logs `prompt_version`.
12. **Approvals are explicit and role-aware.** Extracted data, drafts, generated forms, applicant-facing messages, and package gates are drafts until the responsible role approves. Applicant confirmation and consultant/reviewer approval are distinct.
13. **Long-running work goes through Inngest.** Anything > ~1s. Tools that dispatch to workers return immediately with a job id.
14. **Background work checkpoints.** Inngest steps. Failures resume from checkpoints, not from scratch.
15. **No comments narrating what code does.** Only non-obvious intent or constraints.
16. **Conventional commits:** `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`.
17. **Firm ownership and RBAC.** The pivot target is organization-owned cases. Do not add new `case.userId === userId` guards; use `src/lib/auth/authorization.ts`. Applicants must never see internal notes, firm playbooks, risk flags, workload/SLA data, or other cases.

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
- Don't use real friends' data in Canada/Toronto testing. Create synthetic personas derived from observed flows.
- Don't log PII (passport numbers, bank account numbers). Mask in logs.
- Don't treat applicant confirmation as professional approval. Firm-ready outputs require consultant/reviewer approval.
- Don't replace deterministic rules with retrieval or firm playbooks. Retrieval can support internal playbook search; rules/thresholds/checklists stay in YAML/config.
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

## Firm-first pivot directives

Read `docs/strategy/firm-first-pivot.md` before changing ownership, auth, approvals, tasks, dashboards, or persona scope.

The next build phase is **Phase 4C-F — Firm Foundation Pivot** in `IMPLEMENTATION_PLAN.md`, not Phase 5. Finish RBAC, firm-owned cases, participants, real tasks, review inbox, firm console, applicant portal split, internal notes, firm knowledge scaffolding, and Canada/Toronto config/personas before resuming VIDEX/package automation.

Canada/Toronto is in MVP scope, but Canada-specific checklist/rule content is not yet user-verified. Use official `canada.diplo.de` sources and mark config `verifiedByUser: false` until the user verifies. Do not hardcode Toronto facts in prompts.

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
- **GitHub CLI in Codex sandbox:** `gh auth status` may report an invalid token inside the sandbox because it cannot read the macOS keyring. If the user's terminal shows `gh auth status` as logged in, run `gh ...` commands with escalated permissions instead of asking the user to re-login.

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
- **`onFinish`'s top-level `toolCalls`/`toolResults` are LAST-STEP only** (`OnFinishEvent = StepResult & { steps }`). `buildAgentTurn.onFinish` MUST aggregate `event.steps.flatMap((s) => s.toolResults)` (and `.toolCalls`) — top-level drops `tool_calls` rows AND skips the `case.facts.updated` emit when the turn ends on a text step. `event.text`/`event.content` stay last-step-only **by design** (the final reply; structured tool data lives in the `tool_calls` table). Synthesized-event fixtures (`synthesizeTurnEvent`, `chat.test.ts`) MUST populate `event.steps`, not just top-level. (Post-mortem: context-history.md.)
- **Anthropic prompt caching** via `providerOptions.anthropic.cacheControl: { type: 'ephemeral' }`. Per-message AND per-tool. Tool breakpoints live on **each tool's own `providerOptions`**.
- **Static-tool message parts serialize as `type: 'tool-${name}'`,** never `type: 'tool-call'`. Don't add a defensive `tool-call` branch — dead code. Dynamic tools use `type: 'dynamic-tool'` with separate `toolName`.
- **`ai` is pinned `^6` — do NOT re-pin `ai@5` or re-add the `as unknown as LanguageModel` casts** (model in route, transport in ChatPanel). `ai@5`'s `streamText` rejects the `LanguageModelV3` that `@ai-sdk/anthropic@3` returns, at runtime only. Caught only by live smoke (unit tests mock `streamText`). (Post-mortem: context-history.md.)
- **Exactly ONE `cache_control` breakpoint, on `lookup_anabin`** (Anthropic max is 4; one on the last-registered tool caches the whole static-tools prefix). The other tools carry NO `providerOptions`. Do NOT re-add per-tool breakpoints; do NOT add a top-level `streamText` `providerOptions.anthropic.cacheControl` (per-turn case context → cache miss + 2nd breakpoint). `lookup_anabin` MUST stay last in the `tools` object. The `agent-turn` test asserts breakpoint count == 1.

### Inngest
- Local dev: `npx inngest-cli@latest dev` alongside `pnpm dev`. Webhook is `/api/inngest`.
- Steps must be deterministic. Don't call `Date.now()` or `Math.random()` outside `step.run()` blocks.
- `step.waitForEvent()` is the approval gate primitive. 30-day max wait by default.
- **`createFunction(options, handler)` — 2-arg, not 3-arg.** v4.4 moved `triggers` inside options: `{ id: 'log-case-event', triggers: [{ event: 'case.facts.updated' }] }`. Verified at `node_modules/inngest/components/Inngest.d.ts:507`.
- **Export Inngest handlers separately for tests.** E.g. `logCaseEventHandler` exported alongside the wrapped `logCaseEvent`. Tests invoke the handler directly with a fake `step.run<T>(_id, fn) => fn()` — don't boot the runtime.
- **Event keys optional in dev, required in prod.** Use conditional spreads: `...(env.INNGEST_EVENT_KEY && { eventKey: env.INNGEST_EVENT_KEY })`. Same `superRefine` pattern as `AUTH_RESEND_KEY`.

### Auth.js v5 (verification-only pattern)
- Don't use `@auth/drizzle-adapter`; don't add `accounts` / `sessions` tables. Auth.js sends magic link, verifies token, writes a JWT cookie. Our HMAC `relomate_session` cookie is the app session of record.
- **`signIn` callback fires twice for email provider:** once at request time with `email.verificationRequest: true` (return `true` to send), once after click. Returning a redirect string short-circuits before Auth.js sets JWT — use the `redirect` callback instead.
- **`/api/claim-anonymous` is the only place that reads `auth()`.** The Auth.js `redirect` callback unconditionally routes there; the handler reads the verified email, runs `promoteToAuthed`, writes our cookie, calls `signOut({redirect: false})`. The JWT is treated as ephemeral. Don't add other call sites.
- **Adapter type imports:** `next-auth@5` re-exports adapter types at `next-auth/adapters` (NOT `@auth/core/adapters` — transitive package, couples to pnpm hoist).
- **Production env validation runs during `next build`.** `EnvSchema.superRefine` requires `AUTH_RESEND_KEY`, `EMAIL_FROM`, `AUTH_URL` in production. `EMAIL_FROM` must be a plain email (`z.string().email()`); RFC 5322 display-name format converts at the Resend call, not in env.
- **Email normalization:** lowercase + trim at every entry point (server action AND claim handler). The route's `auth()` returns whatever Auth.js parsed; assume casing/whitespace.
- **Activity-log audit trail:** `auth.promoted_anon` and `auth.merged_anon` rows log `email` INTENTIONALLY. Do NOT log email in any other `activity_log.payload` (PII rule).
- **Cross-user `loadCase`** redirects to `/`, not 404. Plan-canonical decision; observable but acceptable for MVP.
- **Anon→authed merge tombstones, never deletes, the anon user.** Branch (c) of `promoteToAuthed` re-points `cases` + transfers/drops the profile + sets `users.merged_into`, leaving the anon `users`/`organizations` rows as dead tombstones. Do NOT re-add `delete(users)`/`delete(organizations)` — FK `ON DELETE no action` on audit rows throws and rolls back the merge (sign-in 500s); re-pointing them violates rule (10). Regression test: `tests/auth/merge.test.ts` "preserves anon-owned audit rows". (Why + branch-(b) orphan fix: context-history.md.)

### Tests / vitest
- **Module-scope env validation breaks vitest imports.** `@/lib/env` validates at top-level. Tests touching env-dependent modules need `tests/_setup/env.ts` registered as `setupFiles` in `vitest.config.ts` — it loads `.env.test.local` BEFORE any module imports. Don't add a `beforeAll` shim; too late.
- **NEVER `require('@/...')` — it returns `{}` everywhere (not just vitest).** The `@` alias is a compile-time resolver for static `import`s only; CJS `require()` hits Node's resolver, which doesn't know the alias. Always static `import { db as defaultDb } from '@/lib/db/client'`. To defer env validation, register `tests/_setup/env.ts` in `setupFiles` instead. (Post-mortem — crashed RSC while every test passed: context-history.md.)
- **Repository / persistence default-db path:** `makeRepository()` and `appendChatTurn(input)` fall back to a static `defaultDb` import from `@/lib/db/client` when no `db` is passed. Routes / Inngest handlers / RSC pages may call them with no argument. Tests pass `db` explicitly OR mock `@/lib/db/client` with the getter pattern below.
- **Test mock pattern for `@/lib/db/client`:** `vi.mock('@/lib/db/client', () => ({ get db() { return testHandle.db; } }))`. The **getter** is essential — `vi.mock` is hoisted above imports, so `testHandle` isn't yet assigned when the factory runs. Do NOT include `schema` in the factory: `vi.mock` is hoisted above the `import * as schema` binding, so `{ schema }` references the TDZ and crashes any test that imports a module which transitively imports `@/lib/db/client`. Source code never reads `schema` from `@/lib/db/client`; it imports from `@/lib/db/schema` directly.
- **`/api/chat` body parsing is bounded and 4xx-safe.** Reads raw text, rejects > `MAX_BODY_BYTES` (256KB) with 413, guards `JSON.parse` (400), then `safeParse`s `BodySchema` (400). `BodySchema` requires `messages` `.min(1)` and `.max(MAX_MESSAGES)` (100). 401/403 tests must send non-empty `messages` to reach auth/ownership checks. Don't revert to `BodySchema.parse(await req.json())` — that 500s on malformed input.
- **`EMAXPOOLSREACHED` on a full-suite run is INFRA, not a code bug.** Per-core file parallelism spins up ~15 distinct-`search_path` schemas at once; the Supabase pooler allocates one pool per search_path and runs out → only DB tests fail. Fix: `pnpm exec vitest run --no-file-parallelism` (serial, ~32s, reliably green). Don't chase as a regression. (Detail: context-history.md.)

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
- **Valid `update_case` paths come from a schema-derived catalog, NOT a hand-list.** `update_case.updates` is an open `z.record(z.string(), z.unknown())`, so the model gets no key schema and WILL guess invalid paths unless told the real ones. `listLeafPaths()` / `formatLeafPathCatalog()` in `src/lib/case/paths.ts` walk `ProfileSchema` + `CaseFactsSchema` (single source of truth, can't drift from `validateLeafPath`). Injected in BOTH `buildAgentContext` (per-turn) and the `update_case` description. Add a leaf → it appears automatically, no prompt edit. (2A.2 live-smoke root cause: context-history.md.)
- **`MAX_AGENT_STEPS = 8`** (exported from `agent-turn.ts`), was 5. A turn can fan out `update_case` + `lookup_anabin`, recover via `read_case`, run `check_eligibility`, then reply. Don't lower without re-checking the multi-tool recovery path.
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

**Current shipped persona scope is pre-pivot.** Four archetype personas exist now. Phase 4C-F must add firm roles/assignment metadata and Canada/Toronto personas before relying on persona E2E as the firm-first gate. Reasoning, schema, per-persona content in `docs/archive/specs/2026-05-27-persona-library-design.md` predates the firm-first pivot and should be updated when personas change.

Currently shipped (Phase 0):
- `priya-strong` (shortage route, happy path)
- `arjun-it-no-degree` (§18g(2) IT-no-degree route)
- `vikram-edge-anabin` (Anabin-unknown refusal-to-conclude)
- `out-of-scope-asylum` (off-scope refusal)

Firm-first additions required in Phase 4C-F: `toronto-strong-pretravel`, `toronto-canadian-visa-free-option`, `toronto-non-canadian-resident`, `toronto-edge-anabin`, plus role/assignment metadata for existing India/Bengaluru personas. Deferred India personas remain `meera-strong-clean`, `rahul-recent-grad`, `kavya-distance-learning`, `out-of-scope-eu-citizen`, `out-of-scope-criminal`, `renewal-priya-y2`.

Every PR runs the persona test suite. Don't skip — strongest E2E signal we have.

---

## Build plan

`IMPLEMENTATION_PLAN.md` is the work slicing. Phases 1–3 are historical; **Phase 4 onward is sliced into session cards** — one card ≈ one agent session (≤250k tokens), self-contained (Goal / Tasks / Verify / Deferred / optional Decisions). Thin by default; brainstorm only when a card's `Decisions:` line names a real architectural fork. Don't skip a card's verification gate. Process detail: that file's "Session-card model" section.

---

## Current state (as of 2026-06-10)

**Through Phase 4B (employer-letter + CV drafting) is merged to `main` (PR #16).** All drafted-document verticals on the shared `drafts`/approval foundation are live: cover letter, employer letter, CV. The phase status table, per-phase write-ups, and PR map: `docs/context-history.md`. Run DB suites **serially** — see the `EMAXPOOLSREACHED` gotcha.

**Product direction changed on 2026-06-08:** Relomate is now firm-first. The existing automation core carries forward, but cases are moving from applicant-owned to organization-owned. **4C-F-1 through 4C-F-6 are merged to `main`** (PRs #19, #21, #22, #24)**:** `organization_members`, firm ownership columns on `cases`, `case_participants`, visibility constants, primary-applicant participant seeding, central `src/lib/auth/authorization.ts`, role-aware approval work items with `src/lib/approvals/authorization.ts`, the **real tasks foundation** (`tasks` + append-only `task_changes`, migration `0009`; `src/lib/tasks/`), the **firm console / applicant portal split** (`/console`, `/portal/[id]`, surface guard on `/case/[id]`), and **firm knowledge + Canada/Toronto scaffolding**. Legacy `cases.user_id` remains for profile/applicant compatibility while `cases.organization_id` is now the ownership key. Document approvals remain applicant-facing confirmations; draft approvals are internal firm review work by default.

**Tasks foundation (4C-F-4):** `src/lib/tasks/` — `types.ts` (status/source/role/subject enums; `done`/`cancelled` terminal), `repository.ts` (`makeTaskRepository`: create/getById/listByCase/update + `reconcileSystemTasks`), `generate.ts` (pure `deriveSystemTasks`: pending approvals → review/confirm tasks, failed docs → re-upload, failed drafts → regenerate; **sources disjoint, no double-count**), `view-model.ts` (pure `selectTopTasks`, `now`-parameterized, audience+assignee filtered, blocking→overdue→due-date ordering), `service.ts` (`reconcileCaseTasks` integration seam). System tasks dedupe via a stable `generationKey` + partial unique index on non-terminal status (same trick as the approvals pending-subject index); reconcile is idempotent (no-op on steady state) and auto-resolves cleared triggers. `escalationStatus`-style thresholds are NOT computed in code (rule 7) — `overdue` is a pure `now > dueAt`. **Not yet built:** manual-task API/server actions, Inngest SLA worker.

**Firm console + portal split (4C-F-5):** distinct-paths design. `/console` (firm operators only) shows `assignedToMe` / `unassigned` / `blockedOrOverdue` case buckets; `/portal/[id]` (applicants) shows only client-visible top tasks; `/case/[id]` stays the internal consultant workspace (chat + tracker), unchanged except a surface guard. **Access boundary is decided by pure `caseSurface(auth)→'firm'|'client'|'none'` and `canAccessConsole(role)` in `src/lib/auth/surface-access.ts`** (org role OR per-case firm participant seat → `firm`; any other access → `client`; no access → `none`). Internal routes redirect `client` viewers to `/portal/[id]` so an applicant can never reach internal views by URL; the portal redirects `firm` viewers to `/case/[id]`. The boundary is unit-tested (`tests/auth/surface-access.test.ts`) AND DB-backed (`tests/auth/surface-access.db.test.ts`) at the authorization layer — no Next runtime needed. Console buckets are pure (`src/lib/console/view-model.ts`, `bucketizeConsoleCases`, `now`-parameterized); `loadConsole`/`loadPortal` are the thin DB seams. New repo query: `Repository.listByOrganization(orgId)`. **Gotcha:** anon users are `firm_admin` of a one-person `individual_anon` org → they resolve to `firm` and keep the full workspace; only pure applicants (applicant participant, no firm role) get the portal.

**Firm knowledge + Canada/Toronto scaffolding (4C-F-6, merged to main PR #24):** `firm_knowledge_sources` / `firm_knowledge_entries` tables (migration `0010`) add organization-owned source metadata, staleness fields, `verifiedByUser`, and JSON metadata. `config/rules/firm-knowledge.yaml` defines freshness defaults and required metadata keys. `config/rules/consulates.yaml` now includes `toronto` from official `canada.diplo.de` sources with `verifiedByUser: false`; nullable consulate fields mean unknown Canada checklist details are not forced before user verification. `CaseFacts.target.targetConsulate` accepts `toronto`; `?persona=` case creation reads the persona consulate before creating the case. Persona schema now requires firm role/assignment metadata, existing India personas carry it, and four synthetic Toronto personas exist. **Do not treat Toronto checklist details as production-verified until the user confirms them.** The eligibility engine still assesses Blue Card eligibility only; Toronto residence/checklist blockers remain future consulate-readiness work.

**Anabin justification draft (4C-1, current branch):** `anabin_justification` is the fourth draft type. It uses the existing `drafts`/approval/Inngest path, has typed Zod content (`title`, `subject`, institution/degree recognition status, paragraphs, recommended next steps), and registers `draft_anabin_justification` before `lookup_anabin` so the single cache-control breakpoint still sits on the last tool. The draft is a reviewer-facing uncertainty memo for Anabin-unknown/not-found/ZAB paths, not a deterministic recognition verdict. The Drafts tracker now has four rows; only `approved` counts complete.

**Regenerate draft with framing (4C-2, current branch):** `regenerate_draft` creates a new version of an existing draft with a reviewer framing instruction. It verifies the source draft is in the active case, inserts the next version for the same draft type, dispatches `draft.requested` with optional `framingInstruction`, and logs only safe metadata (`framingProvided: true`, not the free text). `generateDraftByType` threads framing into every draft prompt after hard rules. The review route shows read-only version history; stale review URLs redirect to the latest ready version when possible.

**Drafts completeness signal (4C-3, current branch):** Draft requirements now live in `config/rules/journey.yaml` under the `drafts` phase. `requiredDraftsForRoute(verdict)` filters those requirements by route plus verdict blocker/warning conditions; `computeJourneyProgress` uses that list for the Drafts phase total/completed count. Normal recognized-degree cases require cover letter, employer letter, and CV; Anabin-unknown/H- verdicts also require `anabin_justification`. Only `approved` drafts count complete. This is a tracker signal only; Phase 6 owns the blocking package gate.

**Next up** (sliced into session cards in `IMPLEMENTATION_PLAN.md`):
- **5 (VIDEX)** — field map → PDF pipeline → Forms section → conversational gap-filling (4 cards).
- **6 (QA)** — quality engine + submission package (2 cards). **7 (prod)** — eval, observability, GDPR, hardening (4 cards).
- Standing follow-ups: internal notes UI; firm playbook retrieval/UI; production Canada checklist after user verification; portal upload/confirm/message widgets; manual-task UI; 2C-layer-3 live LLM + user-simulator; richer in-chat renderers (2B); apostille tracker + Resend emails + drag-drop-anywhere (3D); full 3-group Documents section if the tracker gets too dense.

**Open items (not regressions):**
- `/api/chat` accepts the full client transcript with no server-side history rebuild — revisit if/when it matters.
- **`messages.parts` is persisted last-step-only** (`event.content`). The `tool_calls` table IS aggregated across steps; `hydrateMessages` falls back to text `content` when persisted parts are tool-only (stops empty bubbles on reload) — but the blob is still last-step. Decide whether to aggregate `parts` at WRITE time before any feature treats it as the multi-step render source.

**Dev-only inspectors** (`node --env-file=.env.local --import tsx scripts/dev-only/<file> [args]`): `db-state.ts` — row counts + recent cases/users; `inspect-turn.ts <caseId>` — dumps a thread's persisted message parts (tool I/O/errorText) + `case_facts.data`. Reach for the latter when a chat turn misbehaves.

---

## Subsystem decisions (read the linked section BEFORE touching that area — do NOT redebate)

These are LOCKED. The full record (every "why", schema, PII discipline, follow-ups) lives in `docs/context-history.md`; this index says which section to read. Don't re-litigate a decision without reading its write-up first.

| Touching… | Read in `context-history.md` | Load-bearing one-liners |
|---|---|---|
| **Agent turn loop, chat route, persistence, Inngest emit, caching** | §Architecture seams | `buildAgentTurn` owns the loop; `lookup_anabin` stays LAST (single cache_control breakpoint); `onFinish` aggregates `event.steps`, not top-level; `appendChatTurn` requires `userId`; `MAX_AGENT_STEPS=8` |
| **Eligibility engine, personas** | §Codebase-review hardening | Engine is *slimmed*, not a verbatim Nomad port; IT-no-degree gates on **reduced** threshold; `outOfScope` flag set ONLY by `evaluateEligibility` (not the `out_of_scope` tool); `IntendedVisa` enum widened; anabin `unknown`/`H-` → `assessed` is INTENTIONAL (don't "fix") |
| **`update_case` / repository** | §Architecture seams + §hardening | Only `applyUpdate` writes case state (rule 5); lock order users→case_facts→profiles; `deepEqual` key-order insensitive; valid paths from the schema-derived catalog, not a hand-list |
| **Journey tracker** | §Journey-tracker dashboard | Read-only projection (`computeJourneyProgress`, pure); family = case data, doesn't gate verdict; Profile folds into Documents |
| **Documents: upload, extraction, review** | §Phase 3A / §3B / §3C | `documents`/`approvals` tables MUTABLE (audit = `activity_log`); presigned direct-to-R2; extraction on the finalize ROUTE not a tool; confirm via server action → `applyUpdate` at confidence 1.0, NOT an agent tool; field→leaf mapping config-driven in `documents.yaml`; tracker IS the live Documents dashboard; PII = keys/confidences only, never values |
| **Drafts (cover/employer/CV)** | §Phase 4A / §4B | `drafts` table MUTABLE; tools create a `drafting` row + dispatch Inngest (no inline generation); one worker dispatches by `draft.type`; polymorphic review route; row-level versioning; activity payloads never contain draft text |
| **Auth, anon→authed merge** | §Anon→authed merge post-mortem + Stack gotchas | Merge tombstones (never deletes) the anon user; `getCurrentUserId` hits DB (null if `merged_into` set); `users.merged_into` migration `0002` |
| **Firm ownership, RBAC, participants, tasks, review inbox, portal split** | §Firm-first pivot decision + §4C-F firm foundation pivot | `cases.organization_id` is the ownership key; `cases.user_id` remains the profile/applicant compatibility key; primary applicants are seeded into `case_participants`; use `src/lib/auth/authorization.ts` for case access and `src/lib/approvals/authorization.ts` for approval resolution; **`src/lib/auth/surface-access.ts` (`caseSurface`/`canAccessConsole`) decides firm vs client surface — internal routes redirect `client` to `/portal/[id]`**; draft approvals are internal firm review work, document confirmations remain applicant-facing |

---

## Origin

Relomate is a pivot from Nomad (`~/Projects/nomad/`). About 40–50% of Nomad ports cleanly — rules YAML, eligibility engine, Anabin seed, knowledge base, profile schema with provenance. The other half (chat UI, agent loop, renderer registry, Drizzle schema) is being redesigned for case-management. Phase 1 of the implementation plan lists what to copy.

If you need context on why a decision was made, ask the user — don't infer.
