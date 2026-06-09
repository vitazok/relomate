# Phase 1B-2 — Auth + Anonymous→Authed Continuity (Design)

> **Goal:** Land magic-link auth (Auth.js v5 via Resend) and the `visa_session` HMAC cookie that is the app's session of record. A visitor who started a case anonymously and signs in keeps it.

**Status:** Design — implementation plan to follow at `docs/superpowers/plans/2026-05-28-phase-1b-2-auth.md`.

**Companions:** `docs/superpowers/specs/2026-05-27-phase-1b-design.md` (umbrella for 1B), `CLAUDE.md` (Auth.js v5 verification-only pattern, Next.js 16 cookie gotchas), Phase 1A schema (`src/lib/db/schema.ts`).

**Predecessor in spirit:** Nomad's `src/lib/auth/{cookie,anonymous,config,adapter}.ts` and `src/app/api/claim-anonymous/route.ts`. Visa carries the proven shape forward; this spec documents the deltas.

---

## 1. Scope

In scope:
- Auth.js v5 magic-link via Resend, console-log override in dev.
- `visa_session` HMAC cookie as the app session of record.
- Anonymous user bootstrap (org + user row, cookie set) — exposed as a server action; no caller wired in 1B-2.
- `/api/claim-anonymous` route: post-verification merge step.
- `/signin` page: bare email-entry form + server action.
- `promoteToAuthed` pure transaction (the merge).
- Read APIs: `getCurrentUserId()` (RSC-safe) + `requireAuthedUserId()` (route-handler / server-action only).

Out of scope (deferred to 1B-3 or later):
- Anonymous-bootstrap call site (`/`, `/api/case/new` — both 1B-3).
- `/case/[id]` workspace shell (1B-3).
- "Save your case" anonymous-banner UI (Phase 2).
- Magic-link rate limiting (Phase 7).
- Real Resend account / domain verification (whenever the user creates one; dev path doesn't need it).
- A login-history audit trail beyond the `activity_log` row the merge writes.

---

## 2. Architecture

Five files in `src/lib/auth/` plus three route/page files. Each file has a single responsibility and a small surface.

```
src/lib/auth/
  cookie.ts          — HMAC encode/decode of visa_session payload (pure, no DB)
  session.ts         — visa_session read/write + anon bootstrap + current-user accessors
  config.ts          — Auth.js v5 setup (Resend + dev console override)
  adapter.ts         — minimal Auth.js Adapter for the verification_tokens path only
  merge.ts           — promoteToAuthed(db, anonUserId, email): pure DB transaction

src/app/api/auth/[...nextauth]/route.ts   — { GET, POST } from Auth.js handlers
src/app/api/claim-anonymous/route.ts      — GET handler; runs the merge post-verification
src/app/signin/
  page.tsx           — server component shell
  SignInForm.tsx     — client form
  actions.ts         — 'use server' requestMagicLink action
```

### 2.1 Module responsibilities

**`cookie.ts` (pure).**
HMAC-SHA256 sign/verify of a JSON `SessionPayload = { userId, iat, exp }`. `encodeSession(payload) → 'body.sig'`. `decodeSession(token) → SessionPayload | null`. Returns `null` on tamper, expiry, parse error, sig length mismatch — never throws. No imports from `next/*` or DB.

**`session.ts` (Next.js cookie API + DB).**
- `getCurrentUserId(): Promise<string | null>` — RSC-safe; reads `visa_session` cookie via `cookies()`, verifies HMAC, returns `userId` or `null`. Read-only — never sets the cookie.
- `requireAuthedUserId(): Promise<string>` — wraps `getCurrentUserId`; throws if `null`. Use from route handlers and server actions only.
- `ensureAnonymousSession(): Promise<{ userId: string; isNew: boolean }>` — server-action / route-handler only (sets cookie). If a valid `visa_session` exists, returns its `userId, isNew: false`. Otherwise creates org + user (`is_anonymous=true`), writes a fresh signed cookie, returns `{ userId, isNew: true }`.
- `writeAuthedSession(userId)` — writes a fresh `visa_session` cookie tied to an authed user (used by `/api/claim-anonymous`). Internal-ish; exported so the claim handler can call it without re-implementing the cookie write.
- `clearSession()` — removes the cookie. Used by sign-out.
- Cookie options: `HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/`, `Max-Age=30 days`.

**`config.ts` (Auth.js v5 wiring).**
- One provider: `Resend` from `next-auth/providers/resend`.
- `session: { strategy: 'jwt' }` — Auth.js's JWT exists as a side effect of the magic-link verification; we don't read it directly except in `/api/claim-anonymous`.
- `secret: env.AUTH_SECRET`.
- `pages: { signIn: '/signin' }`.
- `signIn` callback: returns `true` unconditionally (allows both verification-request and post-click invocations).
- `redirect` callback: same-origin only; unconditionally routes to `/api/claim-anonymous`. The claim handler is the *only* place we read `auth()`'s verified email.
- Dev override: when `NODE_ENV !== 'production'`, the provider's `sendVerificationRequest` is replaced with one that `console.log`s the magic-link URL. `AUTH_RESEND_KEY` and `EMAIL_FROM` become optional in dev, required in production (enforced in `EnvSchema` via a `.refine` keyed on `NODE_ENV`).

**`adapter.ts` (Auth.js Adapter, minimal).**
Only the methods Auth.js's email provider hits with `session.strategy='jwt'`:
- `createVerificationToken({ identifier, token, expires })` → insert into `verification_tokens`.
- `useVerificationToken({ identifier, token })` → DELETE … RETURNING; returns the row or null.
- `getUserByEmail(email)` → look up via `user_identities` join; return adapter-shaped user or null.
- `createUser(user)` → returns the input shape with a fresh UUID; does **not** insert into `users`. Real user creation belongs to `ensureAnonymousSession` and `promoteToAuthed`.
- `updateUser(user)` → re-resolves email from `user_identities` so the resulting JWT carries it.
- `linkAccount`, `getUser`, `getUserByAccount` — return undefined/null. JWT strategy never calls `createSession`/`getSessionAndUser`.

We deliberately do **not** use `@auth/drizzle-adapter`. Reason: our user table is populated by the anonymous-first flow, not by Auth.js.

**`merge.ts` (pure DB transaction).**
Single export: `promoteToAuthed(db, { anonymousUserId, email }): Promise<{ targetUserId: string }>` where `anonymousUserId: string | null`. Takes a Drizzle instance so it's testable without `getDb()` / env validation. Email arrives lowercased and trimmed (`/api/claim-anonymous` does that). Algorithm in §3.

### 2.2 Route handlers

**`src/app/api/auth/[...nextauth]/route.ts`** — `export const { GET, POST } = handlers;` from `@/lib/auth/config`. Standard Auth.js mount.

**`src/app/api/claim-anonymous/route.ts`** — `runtime = 'nodejs'`. `GET(req)`:
1. `const session = await auth();` — reads Auth.js's verified JWT.
2. `const verifiedEmail = session?.user?.email?.toLowerCase().trim();`
3. If no verified email → `302 /signin?error=verification`.
4. Read the current `visa_session` cookie (may be null) → `anonymousUserId`.
5. Call `promoteToAuthed(db, { anonymousUserId, email: verifiedEmail })` → `{ targetUserId }`.
6. `await writeAuthedSession(targetUserId);`
7. `await signOut({ redirect: false });` — clears Auth.js's JWT cookie. Our cookie is the source of truth from here on.
8. `302 /` (1B-3 will hand off to `/case/<id>` once the workspace exists; 1B-2's smoke just verifies the cookie is set and points to an authed user).

### 2.3 `/signin` UI

Bare. Server-rendered shell + client form + server action.
- `page.tsx` — server component, renders `<SignInForm />`.
- `SignInForm.tsx` — `'use client'`. `useFormState(requestMagicLink, { status: 'idle' })`. Renders email input + submit button. On `status: 'sent'` shows "Check your email." On `status: 'error'` shows the message.
- `actions.ts` — `'use server'`; calls `signIn('resend', { email, redirect: false })`. Returns `{ status: 'sent', email }` or `{ status: 'error', message }`.

No styling beyond Tailwind defaults. shadcn components arrive in 1B-3.

---

## 3. Merge algorithm

`promoteToAuthed(db, { anonymousUserId, email })` runs in a single transaction:

1. **Resolve target.** SELECT user via `user_identities` where `provider='email_magiclink' AND provider_id = email`. Call this `existing` (may be null).

2. **Three branches:**

   **(a) No existing user, no anonymous user.** New user from scratch.
   - Insert `organizations` (kind='individual'), then `users` (org_id, is_anonymous=false). Insert `user_identities` (provider='email_magiclink', provider_id=email, verified_at=now). Return `{ targetUserId: newUserId }`. Reachable when a user opens the magic-link URL in a browser that has no `visa_session` cookie (different browser, cookie cleared, or the dev who pasted the URL into a curl command).

   **(b) No existing user, anonymous user present.** Promote in place.
   - `UPDATE users SET is_anonymous=false WHERE id=$anon`.
   - INSERT `user_identities` (user_id=$anon, provider='email_magiclink', provider_id=email, verified_at=now). `ON CONFLICT (provider, provider_id) DO NOTHING` for race-safety.
   - Insert `activity_log` row: `kind='auth.promoted_anon'`, payload `{ from: 'anonymous', email }`, user_id=$anon.
   - Return `{ targetUserId: anonymousUserId }`.

   **(c) Existing user found (with or without anon).** Re-point.
   - If `existing.id === anonymousUserId` → idempotent no-op; touch `users.last_seen_at`. Return `{ targetUserId: existing.id }`.
   - Otherwise:
     - `UPDATE cases SET user_id=$target WHERE user_id=$anon` (only if anonymousUserId given).
     - **Profile transfer policy:**
       - If `SELECT 1 FROM profiles WHERE user_id=$target` returns no row AND anon profile exists → `UPDATE profiles SET user_id=$target WHERE user_id=$anon`.
       - Otherwise → `DELETE FROM profiles WHERE user_id=$anon`.
     - `DELETE FROM users WHERE id=$anon` (cascade-deletes the anon org via a separate `DELETE FROM organizations WHERE id=$anon_org_id` — orgs aren't auto-cascaded; we look up the org_id first and delete it after the user).
     - Insert `activity_log` row: `kind='auth.merged_anon'`, payload `{ from: anonymousUserId, into: targetUserId, email, casesMerged: <count> }`, user_id=$target.
     - Touch `users.last_seen_at`.
     - Return `{ targetUserId: existing.id }`.

3. **Idempotency.** If called twice with the same anon-user (now deleted) → second call's branch (a) skips the anon-side work since `anonymousUserId` won't resolve to a row; the second call still finds `existing` and returns `{ targetUserId: existing.id }`.

4. **Race safety.** Two concurrent claim handlers for the same email:
   - `user_identities (provider, provider_id)` has a UNIQUE constraint (added in 1B-2 migration §6). The `ON CONFLICT DO NOTHING` ensures the second insert is harmless.
   - The `cases` re-point is idempotent — running twice on already-re-pointed rows is a no-op.
   - The anon `DELETE` is the failure point: if both transactions try to delete the same anon row, one wins, the other rolls back. Caller treats rollback as a retry-able situation; in practice the second call sees the email is already attached to `existing` and short-circuits to branch (c)'s idempotent path.

### 3.1 Transaction shape

Single `db.transaction(async tx => { ... })` for branches (b) and (c). Branch (a) can be a single transaction too — keeps the call site uniform.

`SELECT … FOR UPDATE` is **not** needed here. We're operating on identity-level rows (one user per email, one org per anon user), not the `case_facts` JSONB blob 1B-1 protected with row locks. The UNIQUE constraint on `user_identities` is the serialization point. The `UPDATE cases SET user_id=$target WHERE user_id=$anon` is safe under concurrency: it's an idempotent set operation, and the second concurrent transaction sees zero rows to update once the first has committed.

### 3.2 Activity-log payload shapes

```ts
// branch (b)
{ kind: 'auth.promoted_anon', email: '<lowercased>', from: 'anonymous' }

// branch (c)
{ kind: 'auth.merged_anon', from: '<anonUserId>', into: '<targetUserId>',
  email: '<lowercased>', casesMerged: <number>, profileTransferred: <boolean> }
```

Email is logged here intentionally — `auth.*` kinds are the audit trail for sign-ins. Other (case-facts) `activity_log` rows MUST NOT log email (PRD §17 PII discipline).

---

## 4. Trust boundaries & cookie semantics

### 4.1 Two cookies, one source of truth

Auth.js sets a JWT cookie (`__Secure-authjs.session-token` or similar) as a side effect of the magic-link flow. We don't read it after `/api/claim-anonymous` runs. The `visa_session` HMAC cookie is the source of truth for `userId` everywhere else.

The claim handler explicitly `signOut({ redirect: false })`s after writing `visa_session`, dropping the Auth.js JWT. This guarantees only one cookie tells us "who the user is" downstream.

### 4.2 Cookie payload

```ts
type SessionPayload = {
  userId: string;
  iat: number;  // ms since epoch
  exp: number;  // ms since epoch (30 days from issue)
};
```

Encoded as `b64url(JSON).b64url(HMAC-SHA256(b64url(JSON), AUTH_SECRET))`. Verify uses `timingSafeEqual` and length check before comparing. Expiry is server-trusted (the cookie's `Max-Age` is advisory; `decodeSession` rejects `exp < Date.now()`).

### 4.3 Tamper / expiry handling

`decodeSession` returns `null` for any of:
- Missing `.` separator.
- `b64urlDecode` failure or invalid JSON.
- Signature length mismatch or `timingSafeEqual` mismatch.
- `userId` not a string or `exp` not a number.
- `exp < Date.now()`.

Callers treat `null` as "no session." `getCurrentUserId` returns `null`; `ensureAnonymousSession` mints a new anon (which writes a fresh cookie, replacing the stale/tampered one). Never throws to the request handler.

### 4.4 RSC vs route-handler split

CLAUDE.md flags: server components cannot call `cookies().set()`. Enforced by file convention:
- `getCurrentUserId` calls `cookies()` read-only — safe in RSC.
- `ensureAnonymousSession`, `writeAuthedSession`, `clearSession` call `cookies().set/.delete` — must be invoked from route handlers, server actions, or `route.ts`. Calling them from an RSC throws (Next.js error).

We don't add type-level enforcement. Naming + a one-line comment on each set/delete-using export is sufficient.

---

## 5. Environment

`EnvSchema` extension:

```ts
NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
DATABASE_URL: z.string().url(),
DIRECT_URL: optionalUrl,
AUTH_SECRET: z.string().min(32),         // required everywhere
AUTH_URL: z.string().url().optional(),   // Auth.js callback URL; required in production
AUTH_RESEND_KEY: z.string().optional(),  // see refine below
EMAIL_FROM: z.string().email().optional(),
```

`.superRefine` block:
```ts
if (NODE_ENV === 'production') {
  if (!AUTH_RESEND_KEY) ctx.addIssue('AUTH_RESEND_KEY required in production');
  if (!EMAIL_FROM) ctx.addIssue('EMAIL_FROM required in production');
  if (!AUTH_URL) ctx.addIssue('AUTH_URL required in production');
}
```

`AUTH_SECRET`: 32+ chars, used both for the `visa_session` HMAC and Auth.js JWT signing. One secret, one rotation surface.

---

## 6. Database changes

Phase 1A's schema covers the tables we need. Two delta migrations land at the start of 1B-2:

1. **`user_identities` UNIQUE constraint on `(provider, provider_id)`** — required for race safety and to make "find user by email" semantically correct. Phase 1A's schema didn't add this; add now.
2. **`users.last_seen_at` index on `(id, last_seen_at)` desc** — *deferred*. No query in 1B-2 reads ordered by `last_seen_at`. Add when first needed.

Migration 1 only. Drizzle migration in its own commit before any code that depends on it.

---

## 7. Testing strategy

Three tiers — reuse `tests/_db/setup.ts` from 1B-1 (per-file Postgres test schema, `options=-c search_path=<schema>` on the pool URL).

### 7.1 Tier 1 — pure unit (no DB)

**`tests/auth/cookie.test.ts`**
- HMAC sign/verify round-trip preserves payload.
- Tampered body → `decodeSession` returns `null`.
- Tampered signature → `null`.
- Expired payload (`exp < Date.now()`) → `null`.
- Malformed token (no `.` separator, invalid base64, invalid JSON) → `null`.
- Empty `userId` → `null` (the schema check rejects).
- `timingSafeEqual` length mismatch → `null` (no throw).

### 7.2 Tier 2 — merge against real Postgres

**`tests/auth/merge.test.ts`**

Helpers in `tests/_db/seed-auth.ts`:
- `seedAnonUser(db) → { orgId, userId }` — inserts org + user (`is_anonymous=true`).
- `seedAuthedUser(db, email) → { orgId, userId }` — inserts org + user (`is_anonymous=false`) + `user_identities` row.
- `seedCaseFor(db, userId) → caseId` — minimal row in `cases` + empty `case_facts`.
- `seedProfileFor(db, userId, data) → void`.

Cases:
1. **Promote in place (branch b).** Anon user with cases → `promoteToAuthed`. After: `users.is_anonymous=false`, `user_identities` row exists, cases unchanged in count, anon user_id preserved on cases. `activity_log` has one `auth.promoted_anon` row.
2. **Merge into existing (branch c, with cases).** Anon user with two cases + existing authed user with one case → after: existing user owns three cases, anon user gone, anon org gone, `activity_log` has one `auth.merged_anon` with `casesMerged: 2`.
3. **Profile transfer — target has none.** Anon user has profile data, target doesn't → after merge, `profiles.user_id=target`. `profileTransferred: true`.
4. **Profile transfer — target has profile.** Both have profiles → after merge, target's profile preserved, anon's deleted. `profileTransferred: false`.
5. **Idempotent.** Run merge once, run again with same email, no anon-user → second call returns `{ targetUserId: existing }` without throwing; DB state unchanged from first call's end-state.
6. **Self-merge.** Existing authed user signs in via magic link with no anon session → branch (c) sees `existing.id === anonymousUserId` is false (anon is null), takes the empty-anon path: just touches `last_seen_at`. No `activity_log` row.
7. **Race.** Spawn two parallel `promoteToAuthed` calls for the same email + same anon → only one wins the `user_identities` insert; both return the same `targetUserId`; cases re-pointed exactly once. Sanity-check: `casesMerged` total across both rows in `activity_log` matches actual cases re-pointed (one row's `casesMerged: N`, the other's `casesMerged: 0`).
8. **Email normalization.** `promoteToAuthed` is called with `'  Foo@Bar.com '` (mixed case + whitespace). The handler, not `merge.ts`, normalizes — but we test that `merge.ts` doesn't double-lowercase or fail on a pre-normalized email.
9. **Branch (a) — no anon, no existing.** Call `promoteToAuthed` with `anonymousUserId=null`, fresh email. After: new org + new user + `user_identities` row. `cases` table empty. No `activity_log` row (nothing to merge or promote — the verification itself isn't a `case_*` event).

### 7.3 Tier 3 — adapter + claim handler integration

**`tests/auth/adapter.test.ts`** — exercises adapter methods directly against real Postgres:
- `createVerificationToken` writes a row.
- `useVerificationToken` deletes and returns the row.
- `getUserByEmail` returns adapter-shape or null.
- `updateUser` re-resolves email from `user_identities`.

**`tests/auth/claim.test.ts`** — exercises `/api/claim-anonymous` flow without a real browser. Two sub-tests:
- **Mock `auth()`** to return a session with `user.email='priya@example.com'`. Set a `visa_session` cookie pointing at a seeded anon user with one case. Hit the route. Assert: anon user gone, target user owns the case, response is `Set-Cookie` with a `visa_session` whose `userId` matches target, response is `302 /`.
- **No verified email.** Mock `auth()` to return `null`. Hit the route. Assert: `302 /signin?error=verification`, no DB changes.

Mocking strategy: `auth()` is the only Auth.js touchpoint in the route. Use `vi.mock('@/lib/auth/config', () => ({ auth: vi.fn(), signOut: vi.fn() }))` per test.

### 7.4 Tier 4 — manual smoke

1. **Magic-link round-trip.** `pnpm dev` (with `AUTH_RESEND_KEY` unset, NODE_ENV=development). Visit `/signin`, submit `you@example.com`. Console logs the magic-link URL. Click it (or paste it in the address bar). Land on `/`. Inspect cookies: `visa_session` present, decoded payload's `userId` resolves to a user with `is_anonymous=false` and a `user_identities` row.
2. **Anon → authed merge.** Set a `visa_session` cookie pointing at a manually-seeded anon user with a case. Visit `/signin`, sign in with a fresh email. After click: `visa_session` points to the new authed user; the case is now owned by them. Verify in DB.
3. **Tampered cookie.** In devtools, edit `visa_session` to `garbage.garbage`. Visit `/signin` and sign in. The flow proceeds — branch (a) creates a new authed user from scratch — no error spew.

---

## 8. Verification gate (1B-2)

- [ ] `pnpm test` green (all four tiers).
- [ ] `pnpm exec tsc --noEmit` clean.
- [ ] `pnpm lint` clean.
- [ ] `pnpm build` green.
- [ ] Manual smoke #1 (magic-link round-trip).
- [ ] Manual smoke #2 (anon → authed merge — the hardest path).
- [ ] Manual smoke #3 (tampered cookie doesn't crash).
- [ ] CLAUDE.md updated with any new gotchas surfaced during build.
- [ ] Commit graph: migration → cookie → session → adapter → config → merge → claim route → signin page → tests, each as its own commit. Conventional commits.

---

## 9. Cross-cutting concerns

### 9.1 Logging

`activity_log` rows: `auth.promoted_anon`, `auth.merged_anon`. These are the audit trail. Console.log is fine for dev.

### 9.2 PII discipline (CLAUDE.md rule)

- Email IS logged in `auth.*` activity_log payloads — that's the audit trail's purpose.
- Email MUST NOT appear in any other `activity_log.payload` (case-facts updates, etc.).
- The cookie payload contains `userId` only — no email, no name. (Trivial today; spelled out so future changes don't drift.)

### 9.3 Phase 2 readiness

After 1B-2 ships:
- `getCurrentUserId` is the universal "who is the user" accessor for RSC and route handlers.
- `ensureAnonymousSession` is the single entry point for anon-bootstrap, ready for 1B-3 to call from `/api/case/new`.
- The `merge.ts` transaction is the only DB-touching auth code; reusable as-is for any future identity-attachment flow (OAuth, SSO).

### 9.4 What 1B-2 explicitly does NOT prepare for

- `/case/[id]` ownership checks. 1B-3 implements `requireAuthedUserId()` calls in the workspace shell.
- Multi-org users. The current model is one user, one org. Multi-org is Phase 6+.
- Email-change flows. PRD §13.1 has it as Phase 7.

---

## 10. Open questions & follow-ups

- **Auth.js `signIn('resend')` from a server action that returns:** Nomad's pattern works; we adopt it. If `signIn` throws on transport-level failures (Resend rate limit), the action returns `{ status: 'error' }`. Confirm during build that the catch path covers all real failure modes.
- **`AUTH_URL` in production:** required for absolute callback URLs. Vercel sets `AUTH_URL` automatically when `NEXTAUTH_URL` is unset, but the v5 docs prefer `AUTH_URL`. Confirm during deployment, not 1B-2.
- **Cookie name conflicts on shared dev domains:** `visa_session` is unambiguous. No conflict with Auth.js's own cookies.
- **Race in `ensureAnonymousSession` itself:** if a user double-clicks something that calls it twice with no cookie, two anon users could be created. Acceptable for 1B-2 (the second invocation overwrites the cookie; the first anon is orphaned). Cleanup deferred to a Phase 7 GC pass.

---

## 11. Sign-off

This spec covers Phase 1B-2 end to end. Implementation plan lands at:

- `docs/superpowers/plans/2026-05-28-phase-1b-2-auth.md`

Plan follows 1B-1 discipline: TDD where it pays (cookie, merge), real DB integration where it matters (adapter, claim), conventional commits per slice, verification gate before pushing.
