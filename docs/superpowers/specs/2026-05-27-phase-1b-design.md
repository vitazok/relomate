# Phase 1B — Design Spec

> **Goal:** Land the runtime spine of Visa: the persistence layer, auth + anonymous→authed continuity, and the streaming chat / 3-column workspace that exercises a single `update_case` tool. After 1B, Phase 2 can plug in real tools and the real system prompt without touching foundation code.

**Status:** Design (this document) — implementation plans land per sub-phase in `docs/superpowers/plans/`.

**Companion:** `docs/superpowers/plans/2026-05-27-phase-1a-foundation.md` (the now-shipped foundation), `IMPLEMENTATION_PLAN.md` Phase 1, `PRD.md` §3.3, §4, §5.1, §6, §7, §8, §9.

---

## 1. Sub-phase split

Phase 1B splits into three sub-phases. Each sub-phase has its own implementation plan, its own verification gate, and ships independently.

| Sub-phase | Scope | Risk | Verifiable how |
|---|---|---|---|
| **1B-1 — Persistence & `update_case`** | Repository layer, the `update_case` write path, change log, activity log writes. | Low | vitest integration tests against a real Supabase test schema. |
| **1B-2 — Auth.js v5 + anonymous→authed continuity** | Magic-link via Resend, the `visa_session` cookie, anonymous user creation, the merge step. | Medium | vitest integration tests + manual magic-link smoke. |
| **1B-3 — Streaming chat + 3-col workspace + Inngest scaffold** | `/case/[id]` 3-column UI, AI SDK v5 streaming chat with `update_case` registered as the only tool, Inngest webhook + one trivial function. | High | Live UI smoke (the Phase 1 verification gate from `IMPLEMENTATION_PLAN.md`). |

Each sub-phase is sized to fit comfortably in one focused build session. The order is fixed: 1B-2 depends on 1B-1's repository, and 1B-3 depends on both.

---

## 2. 1B-1 — Persistence & `update_case`

### 2.1 Architecture

Three modules with sharp boundaries. App code does **not** touch `cases`, `case_facts`, `profiles`, `case_changes`, `profile_changes`, or `activity_log` outside `repository.ts` — that's the trust boundary.

**`src/lib/case/repository.ts`** — the only DB-touching module. Public API:

- `createCase({ userId, visaType, targetCountry, targetConsulate })` — inserts `cases` + empty `case_facts`. Returns `{ caseId }`.
- `loadCase(caseId)` — returns `{ case, profile, caseFacts }` with all three JSONB blobs `Schema.parse()`'d. Throws on shape mismatch.
- `applyUpdate({ caseId, sourceTurnId, source, confidence, updates, fieldNotes })` — the workhorse. Takes dotted-path leaf changes, validates each path against `CaseFactsSchema` / `ProfileSchema`, runs in one transaction:
  1. `SELECT … FOR UPDATE` on `case_facts` + `profiles` (locks the rows).
  2. For each path, validate the leaf type, build the provenance-wrapped value `{value, source, sourceTurnId, confidence, updatedAt}`.
  3. Detect contradictions (same path previously set to a different value at higher-or-equal confidence).
  4. Merge into JSONB and `Schema.parse()` the result before writing (safety belt against bugs in step 1–2).
  5. `UPDATE case_facts` / `UPDATE profiles` with the merged JSONB.
  6. Insert one `case_changes` / `profile_changes` row per path.
  7. Insert one `activity_log` row summarising the call (kind: `case.facts.updated`).
  Returns `{ updated: CaseFacts, profile: Profile, contradictions: ContradictionReport[] }`.

**`src/lib/case/paths.ts`** — pure, no DB. Houses:
- `validateLeafPath(path)` — walks `CaseFactsSchema` / `ProfileSchema` to confirm the path resolves to a leaf and returns its inner Zod schema.
- `setAtPath(obj, path, fieldValue)` / `getAtPath(obj, path)` — immutable deep-set/get on the typed tree.
- `flattenForChangeLog(updates)` — normalises tool input into the per-row shape `case_changes` expects.

**`src/lib/ai/tools/update_case.ts`** — Vercel AI SDK `tool({...})` adapter. Zod input schema (path-keyed object, see §2.2), calls `repository.applyUpdate`, returns the discriminated-union output `{ type: 'update_case_result', version: 1, data: { updated, contradictions } }`. Zero business logic; it's an adapter.

### 2.2 Tool input shape

The `update_case` tool accepts dotted-path keys with shared provenance. This matches PRD §5.1's `{updates, source, confidence, sourceTurnId, fieldNotes}` signature directly.

```ts
{
  updates: {
    'employment.annualGrossSalaryEur': 48500,
    'employment.employerName': 'Acme GmbH',
    'education.anabinStatus': 'H+'
  },
  source: 'user_stated',
  confidence: 0.9,
  sourceTurnId: '<message-uuid>',
  fieldNotes: {
    'employment.annualGrossSalaryEur': 'mentioned in turn 3'
  }
}
```

**Why dotted paths over nested partial:** the repository's natural unit of work is "a list of leaf changes with shared provenance". Dotted paths map 1:1 to `case_changes.field_path` and to per-path contradiction detection — no flattening hop. Loss of static input type safety is recovered at runtime by `validateLeafPath` + `validateLeafValue`, which give clearer errors than a deep-partial schema parse would.

### 2.3 Data flow & trust boundaries

**Read** (`loadCase`):
```
Postgres jsonb → Drizzle ($type<T> compile-time only) → Schema.parse() → caller
```
Drizzle's `$type<CaseFacts>()` is type-level fiction. The repository runs `Schema.parse()` on every read at the boundary; callers (the tool, Phase 2's eligibility engine, the workspace renderers) trust the in-memory shape and never re-parse.

**Write** (`applyUpdate`):
```
tool input (Zod-parsed)
   │
   ▼
validateLeafPath(path)          ◀── fails with structured error if path is invalid
   │
   ▼
validateLeafValue(path, value, innerSchema)
   │
   ▼
BEGIN TRANSACTION
  SELECT … FOR UPDATE on case_facts + profiles
  build new {value, source, sourceTurnId, confidence, updatedAt} per path
  detect contradictions
  setAtPath() into JSONB blob
  CaseFactsSchema.parse(merged)              ◀── safety belt
  UPDATE case_facts / profiles
  INSERT INTO case_changes / profile_changes (one row per path)
  INSERT INTO activity_log (one row per applyUpdate call)
COMMIT
```

**Trust boundaries:**
- *External (untrusted)* — tool input, anything from the LLM → Zod-parse mandatory.
- *DB (semi-trusted)* — JSONB blobs were Zod-parsed on the way in but a migration could change shape → Zod-parse on read.
- *In-memory after parse (trusted)* — pass freely; no re-validation.

**Concurrency:** `SELECT … FOR UPDATE` per `case_id` serialises writes to that case. Cross-case writes don't block. Adequate for 1B-1 (single-user sequential turns); revisit if Phase 6+ ever fans out.

**Activity log payload shape:**
```ts
{
  kind: 'case.facts.updated',
  paths: ['employment.annualGrossSalaryEur', 'education.anabinStatus'],
  source: 'user_stated',
  sourceTurnId: '<uuid>',
  contradictions: 0,
}
```
One row per `applyUpdate` call (not per path). `case_changes` is the per-leaf auditor surface; `activity_log` is the human-skim timeline.

### 2.4 Contradiction detection

Path-local. "Same path written twice with different values at same-or-higher confidence" → contradiction. Cross-field contradictions ("salary €50k but ISCO is manager") are the eligibility engine's job in Phase 2, not the repository's.

`ContradictionReport` shape:
```ts
{
  path: 'employment.annualGrossSalaryEur',
  previousValue: 48500,
  previousConfidence: 0.9,
  newValue: 55000,
  newConfidence: 0.9,
}
```

Contradictions are surfaced in the result; they do **not** block the write. The agent will see the report and decide how to acknowledge with the user. Lower-confidence writes against a higher-confidence existing value still write but are flagged in the report.

### 2.5 Testing strategy

**Tier 1 — pure unit (no DB)** — `tests/case/paths.test.ts`
- `validateLeafPath`: valid path resolves; invalid path errors with the bad segment named; partial path (not a leaf) errors.
- `validateLeafValue`: type mismatch caught (string for salary, unknown enum for `contractType`).
- `setAtPath` / `getAtPath`: immutable updates, missing intermediate objects synthesised.

**Tier 2 — repository against real Postgres** — `tests/case/repository.test.ts`
- `beforeAll`: connect to `DATABASE_URL`, create a `test_<uuid>` schema, run `drizzle-kit migrate` against it, hand the test a Drizzle instance scoped to that schema.
- `afterAll`: `DROP SCHEMA test_<uuid> CASCADE`.
- Each `it` runs in its own transaction that rolls back on completion.

  Cases:
  1. `createCase` writes one `cases` row + one empty `case_facts` row.
  2. `applyUpdate` with a single path: jsonb gets the wrapper, `case_changes` has one row, `activity_log` has one row.
  3. `applyUpdate` with three paths: one `activity_log` row, three `case_changes` rows, jsonb merged correctly.
  4. `applyUpdate` then `loadCase`: round-trip preserves provenance.
  5. Profile-level path (e.g., `nationality`) lands in `profiles` / `profile_changes`, not `case_facts` / `case_changes`.
  6. Contradiction: same path written twice with different values at same confidence → result reports contradiction; both writes still persist.
  7. Invalid leaf path → throws, no rows written.
  8. Invalid leaf value → throws, no rows written.
  9. Concurrent writes to same case serialise (run two `applyUpdate` calls without awaiting; both succeed; row lock makes them sequential).
  10. Concurrent writes to different cases proceed in parallel (sanity check).

**Tier 3 — tool adapter** — `tests/ai/update_case.test.ts`
- The `tool()` wrapper round-trips: invalid input → Zod error; valid input → calls repository; output matches the discriminated union.
- One golden test per error class: invalid path, invalid value, contradiction surfaced.
- Mocks the repository — adapter has no business logic worth integration-testing.

**Test infra:**
- `tests/_db/setup.ts` exports `withTestSchema(fn)` — handles schema lifecycle. Reused in 1B-2 and 1B-3.
- `.env.test.local` (gitignored) with the test `DATABASE_URL`. CI dependency: a Supabase test project. Flag as ops dep, not code.

### 2.6 Verification gate (1B-1)

- [ ] `pnpm test` green, including the new repository integration tests
- [ ] `pnpm exec tsc --noEmit` clean
- [ ] `pnpm lint` clean
- [ ] `pnpm build` green
- [ ] One manual smoke from a Node REPL: `applyUpdate` against the real (non-test) Supabase project; `loadCase` reads it back; row counts in `case_changes` and `activity_log` match. Proves the schema-test harness isn't masking a real-config bug.

---

## 3. 1B-2 — Auth.js v5 + anonymous→authed continuity

### 3.1 Architecture

Three modules.

**`src/lib/auth/config.ts`** — Auth.js v5 setup.
- One provider: Resend magic-link (CLAUDE.md "Auth.js v5 (verification-only pattern)" — no `@auth/drizzle-adapter`, no `accounts` / `sessions` tables).
- `verification_tokens` table only (already in 1A schema).
- `signIn` callback returns `true` on `email.verificationRequest` (sends mail); on second invocation (post-click) returns `true` so Auth.js can set its JWT.
- `redirect` callback routes to `/case/<id>` if visitor has an anonymous case in cookies, else `/`. **Calls `promoteToAuthed` synchronously before returning the redirect URL** — this is the only place Auth.js touches our DB.
- Console-log override in dev (CLAUDE.md gotcha) so local work doesn't need a Resend account.

**`src/lib/auth/session.ts`** — the `visa_session` cookie (the app's session of record).
- `getOrCreateAnonymousSession(req)` — if no `visa_session` cookie, mint one tied to a fresh `users` row with `is_anonymous = true`. HMAC-signed (`AUTH_SECRET`), HttpOnly, Secure, SameSite=Lax, 30-day expiry.
- `getCurrentUserId()` — reads cookie, verifies HMAC, returns `userId` or `null`.
- `promoteToAuthed(anonymousUserId, email)` — see §3.2.

**`src/lib/auth/merge.ts`** — the merge step in detail.

### 3.2 Merge algorithm

Input: `anonymousUserId`, `email` (verified by Auth.js).

1. Look up `users` by email via `user_identities` join. If not found, promote `anonymousUserId` in place: set `is_anonymous = false`, insert `user_identities` row. Done.
2. If a different `targetUserId` exists, run a transaction: `UPDATE cases SET user_id = $target WHERE user_id = $anon`; same for any other user-scoped tables added later. Insert `activity_log` row describing the merge. `DELETE FROM users WHERE id = $anon`.
3. Replace the `visa_session` cookie with one tied to `targetUserId`.

**Idempotent.** Re-running with same inputs is a no-op. Race-safe: two concurrent calls don't double-create `user_identities` (unique constraint or `ON CONFLICT DO NOTHING`).

### 3.3 Dual-cookie design (intentional)

Auth.js sets its own JWT cookie (we can't disable it cleanly). We don't read it. The `visa_session` cookie is the source of truth for `userId`. Auth.js's JWT exists only because the magic-link flow writes one as a side effect; treat it as ephemeral.

This matches the "Auth.js v5 (verification-only pattern)" gotcha in CLAUDE.md — Auth.js is verification, our cookie is the session.

### 3.4 Testing strategy

**Tier 1 — pure unit** — `tests/auth/cookie.test.ts`
- HMAC sign/verify round-trip; tampered cookie rejected; expired cookie rejected.
- `visa_session` is opaque structure: `userId` in, signed string out, signed string in, `userId` out.

**Tier 2 — repository integration (real Postgres, reuses `withTestSchema`)** — `tests/auth/merge.test.ts`
- `promoteToAuthed` for a brand-new email: anonymous user becomes authed, `user_identities` row exists, `is_anonymous = false`, cases unchanged.
- `promoteToAuthed` for an email with an existing authed user with no cases: anon user's cases re-pointed, anon user deleted, `activity_log` entry written.
- `promoteToAuthed` for an email with an existing authed user who owns cases: target user owns all (their own + the merged), anon user deleted.
- Idempotent: calling twice with same inputs → same DB state.
- Race: two parallel calls for same email don't double-create `user_identities`.

**Tier 3 — auth flow integration (Next.js route handlers + cookies)** — `tests/auth/flow.test.ts`
- `getOrCreateAnonymousSession` with no cookie: creates user, returns `Set-Cookie` with HMAC.
- Same call with valid cookie: returns existing user, no new row.
- Same call with tampered cookie: treats as no cookie, creates fresh anon user.
- `getCurrentUserId` returns `null` on no/invalid cookie, `userId` on valid.

**Manual smoke (real-world auth):**
1. Local dev with console-log Resend override: visit `/`, anon user created, send magic link to `you@example.com`, copy URL from console, paste it, land on `/case/<id>`, run `loadCase` from devtools — same case as before sign-in.
2. Hit `/api/auth/signin` with an existing email that already has cases on a different anonymous session: confirm cases merged.
3. Tamper with `visa_session` cookie value in devtools: confirm fresh anon user is minted, no error spew.

### 3.5 Verification gate (1B-2)

- [ ] All vitest tiers green
- [ ] `pnpm exec tsc --noEmit` clean
- [ ] `pnpm lint` clean
- [ ] `pnpm build` green
- [ ] Manual smoke #1 (anon → authed continuity)
- [ ] Manual smoke #2 (merge actually merges — the hardest path)
- [ ] Manual smoke #3 (tampered cookie doesn't crash)

### 3.6 Out of 1B-2 scope

- Resend account setup. Ships with console-log override; `RESEND_API_KEY` is optional in dev, required in prod. Real account setup deferred to whenever you create one.
- Magic-link rate limiting. Phase 7.
- The "save your case" UI banner — punted to Phase 2 (doesn't gate the demo).

---

## 4. 1B-3 — Streaming chat + 3-col workspace + Inngest scaffold

### 4.1 Routes

- `/` — landing page. "Start a case" button → POST `/api/case/new` → redirects to `/case/<id>`.
- `/case/[id]` — the 3-column workspace. Server component for the shell, client islands for interactive parts.
- `/api/chat` — POST. AI SDK v5 streaming endpoint. Reads `caseId` + `messageId` from body, validates ownership against `getCurrentUserId()`, builds context, streams.
- `/api/case/new` — POST. Creates a case for current user (anonymous or authed), redirects.
- `/api/inngest` — Inngest webhook (mounted via `serve()`).

### 4.2 3-column workspace shell

`src/components/workspace/Layout.tsx`. CSS grid `220px 1fr 360px` on desktop. Mobile in 1B-3 is a single-column stack with a "Show chat" toggle — full bottom-sheet polish is Phase 2.

- **Left** (`Nav.tsx`) — static section list (Overview, Profile, Documents, Drafts, Forms, Timeline, Tasks, Activity). All sections except Overview are placeholder "Coming soon" panels in 1B-3.
- **Center** (`Overview.tsx`) — renders `caseFacts` summary. For 1B-3, raw fact paths with values + provenance hover. Eligibility verdict is Phase 2.
- **Right** (`ChatPanel.tsx`) — always-visible streaming chat. Message list + input.

shadcn/ui components installed in 1B-3: `button`, `card`, `scroll-area`, `input`. Nothing else.

### 4.3 Chat loop

Client uses AI SDK v5's `useChat` with `transport: new DefaultChatTransport({ api: '/api/chat' })` (CLAUDE.md gotcha — `api` option on `useChat` is gone in v5).

Server route `src/app/api/chat/route.ts`:
```ts
const messages = await convertToModelMessages(rawMessages);   // async, CLAUDE.md gotcha
const context = await buildAgentContext(caseId, lastMessageId);
return streamText({
  model: anthropic('claude-sonnet-4-7'),
  system: systemPrompt,                            // minimal placeholder; full prompt in Phase 2
  messages,
  tools: { update_case },
  stopWhen: stepCountIs(5),                        // CLAUDE.md gotcha — needed for natural reply after tool call
  providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
});
```

After every assistant turn finishes, the server inserts the assistant `messages` row + any `tool_calls` rows. The chat response stream is independent of the Inngest workflow (§4.5).

### 4.4 Auto-refresh after `update_case`

The chat panel is a client component subscribed to `useChat`. After each tool-call result lands, the chat panel calls `router.refresh()` (Next.js App Router) which re-runs the server component for the workspace and re-renders the center column with the new case data.

**Trade-off:** a full server round-trip per tool call. Fine in 1B-3 (single user, single case). Revisit with React Server Actions or an SSE channel if it gets janky in Phase 4.

### 4.5 Inngest scaffold

`src/lib/workflows/log-case-event.ts`. One trivial function:
- Listens for `case.facts.updated`.
- Writes a console.log + an `activity_log` row with kind `inngest.echo`.
- Mounted via `serve({ client, functions: [logCaseEvent] })` at `/api/inngest`.

The `update_case` tool's `execute()` emits `case.facts.updated` after the transaction commits. Payload: `{ caseId, paths, sourceTurnId }` — same shape `activity_log` already records, but going through Inngest proves the durable-step plumbing is wired correctly for Phase 3.

Local dev: `npx inngest-cli@latest dev` alongside `pnpm dev`.

### 4.6 System prompt placeholder

`prompts/agent/v0-stub.md`:
- ~10 lines: "You are a case-management agent. Use `update_case` to record facts the user mentions. Do not give legal advice."
- Real prompt is Phase 2 (PRD §8.2).
- Stub exists so we can verify the chat loop without conflating prompt quality with plumbing.

### 4.7 What 1B-3 does NOT do

- Real `buildAgentContext` (returns case summary; full PRD §8.3 implementation is Phase 2).
- More than one tool — `update_case` only; rest of the catalog is Phase 2-onward.
- Approval cards in chat.
- Mobile chat bottom sheet (single-column stack toggle is enough for verification).
- "Save your case" anonymous-user banner — punted to Phase 2.
- shadcn/ui components beyond the layout essentials.

### 4.8 Verification gate (1B-3) — the live UI smoke from `IMPLEMENTATION_PLAN.md` Phase 1

- [ ] Sign in via magic link.
- [ ] Create case → land on `/case/<id>` with the 3-col layout.
- [ ] Type "I work at Acme as a senior engineer making €55k" in chat.
- [ ] See streaming response token-by-token.
- [ ] See the `update_case` tool call inline in chat.
- [ ] See the Overview column auto-refresh with the new facts.
- [ ] See an `activity_log` row from `update_case` *and* one from the Inngest `logCaseEvent` echo.
- [ ] All persona tests still green; `pnpm test` / `pnpm build` / `pnpm exec tsc --noEmit` / `pnpm lint` all clean.

---

## 5. Cross-cutting concerns

### 5.1 Env vars (cumulative)

| Sub-phase | Adds |
|---|---|
| 1B-1 | none beyond Phase 1A's `DATABASE_URL` / `DIRECT_URL`. |
| 1B-2 | `AUTH_SECRET` (HMAC for `visa_session` + Auth.js JWT signing), `RESEND_API_KEY` (optional in dev), `EMAIL_FROM`, `AUTH_URL`. |
| 1B-3 | `ANTHROPIC_API_KEY`, `INNGEST_SIGNING_KEY` (prod), `INNGEST_EVENT_KEY` (prod). |

Each sub-phase extends `EnvSchema` in `src/lib/env.ts` with the new keys.

### 5.2 Migration hygiene

- 1B-1 — no schema changes (1A landed all PRD §4.2 tables). One migration only if `case_facts` needs a NOT NULL on `data` we missed; verify in Task 1.
- 1B-2 — no schema changes (1A includes `verification_tokens`, `users`, `user_identities`).
- 1B-3 — no schema changes (`messages`, `tool_calls`, `threads` exist).

If a migration is needed mid-phase, it ships in its own commit before the code that depends on it.

### 5.3 Logging & observability

- All sub-phases: console.log only. The `activity_log` table is the audit trail.
- Sentry + Langfuse arrive in Phase 7. The `tool_calls` table is the prompt-trace surface until then.

### 5.4 PII discipline (CLAUDE.md rule)

- `applyUpdate`'s console output never logs `value` for paths in a denylist (`passportNumber`, `passportExpiry`). Only logs path + value length. Denylist is a constant in `src/lib/case/repository.ts`.
- `activity_log.payload` may include path names but never values. `case_changes` has the values; that's gated behind the user's own data export (Phase 7 GDPR endpoint).

### 5.5 Commit cadence

- One Drizzle migration per commit when needed.
- One feature/test slice per commit. Estimated commits per sub-phase: 1B-1 ~10, 1B-2 ~8, 1B-3 ~12.
- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`.
- Push at the end of each sub-phase after the verification gate passes.

### 5.6 CLAUDE.md updates

Each sub-phase ends with a CLAUDE.md "Stack gotchas" delta if anything new bit us. Anticipated entries:
- 1B-2 — anything new about Auth.js v5's `redirect` callback timing.
- 1B-3 — anything new about `useChat` + `router.refresh()` interaction or Inngest event-after-transaction patterns.

### 5.7 Phase 2 readiness

After 1B-3 ships, Phase 2 starts without touching anything in 1B. The seams:
- New tools register in `src/lib/ai/tools/` and get added to the `tools: { ... }` map on the chat route.
- `buildAgentContext` grows from a stub to the PRD §8.3 implementation.
- `prompts/agent/v0-stub.md` becomes `prompts/agent/v0.md`.
- Workspace sections (Overview, Profile) get real content; Documents / Drafts / Forms wait for Phases 3+.

---

## 6. Open questions & follow-ups

None blocking. Items that may surface during implementation:

- **Inngest dev server signing key:** local dev may need `INNGEST_SIGNING_KEY=test` to avoid bypassing signature verification. Confirm during 1B-3 Task 1.
- **Vitest schema-per-file vs schema-per-test:** schema-per-file is the default (cheaper); fall back to schema-per-test only if `applyUpdate` race tests need stronger isolation than transaction-rollback gives.
- **Drizzle pool reuse across test schemas:** each test schema may need its own search_path setting on the pool. Detail for the 1B-1 plan.

---

## 7. Sign-off

This spec covers Phase 1B end to end. Implementation plans land per sub-phase:

- `docs/superpowers/plans/2026-XX-XX-phase-1b-1-persistence.md`
- `docs/superpowers/plans/2026-XX-XX-phase-1b-2-auth.md`
- `docs/superpowers/plans/2026-XX-XX-phase-1b-3-chat-workspace-inngest.md`

Each plan follows the Phase 1A discipline: TDD where it pays, real DB integration where it matters, conventional commits per slice, verification gate before moving on.
