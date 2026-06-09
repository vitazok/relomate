# Phase 1B-3 — Streaming Chat + 3-col Workspace + Inngest Scaffold — Design Spec

> **Goal:** Land the runtime spine that exercises the persistence layer (1B-1) and auth (1B-2): a 3-column workspace at `/case/[id]`, an AI SDK v5 streaming chat that registers `update_case` as its only tool, and an Inngest webhook with one trivial echo function. After 1B-3 ships, Phase 2 plugs in real tools, the real system prompt, and the eligibility engine without touching the chat plumbing.

**Status:** Design (this document) — implementation plan lands at `docs/superpowers/plans/2026-05-28-phase-1b-3-chat-workspace.md`.

**Companions:**
- `docs/superpowers/specs/2026-05-27-phase-1b-design.md` §4 (the Phase 1B umbrella spec; this document supersedes §4 with concrete decisions).
- `IMPLEMENTATION_PLAN.md` Phase 1 verification gate.
- `PRD.md` §3.3 (file tree), §8 (agent), §9 (Inngest).
- `CLAUDE.md` "Stack gotchas" — Next.js 16 / AI SDK v5 / Inngest.

---

## 1. What ships

A user can:
1. Visit `/`, click **Start a case**.
2. Land on `/case/<id>` with a 3-column layout (left nav · center Overview · right always-visible chat).
3. Type a message in chat, see token-by-token streaming, watch the assistant call `update_case`.
4. Watch the center Overview re-render with the new fact after the tool call returns.
5. See an `activity_log` row written by `update_case` *and* a second `activity_log` row written by the Inngest `logCaseEvent` echo.
6. Sign in with a magic link from the chat panel and have the case persist (1B-2 already covers the merge).

A developer can:
- Run `pnpm dev` and `npx inngest-cli@latest dev` side-by-side and exercise the loop end-to-end against real Supabase EU.
- Run `pnpm test` green with new vitest tiers covering chat persistence, the `/api/chat` route handler, and the Inngest function.

What does **not** ship: real `buildAgentContext`, real system prompt, more than one tool, approval cards, mobile bottom-sheet polish, anonymous-banner UX, persona-driven E2E tests.

---

## 2. Architecture

### 2.1 Module map (additions)

```
src/
  app/
    page.tsx                           # / — landing CTA (replace existing stub)
    case/
      [id]/
        page.tsx                       # /case/[id] — RSC shell, loads case via repository
    api/
      case/
        new/route.ts                   # POST — ensureAnonymousSession + createCase + redirect
      chat/route.ts                    # POST — AI SDK v5 streamText
      inngest/route.ts                 # serve(client, [logCaseEvent])
  components/
    workspace/
      Layout.tsx                       # 3-col CSS grid, server component
      Nav.tsx                          # left rail (placeholder sections)
      Overview.tsx                     # center column, renders caseFacts
      ChatPanel.tsx                    # right column, 'use client', useChat
    ui/                                # shadcn primitives: button, card, scroll-area, input
  lib/
    ai/
      provider.ts                      # one Anthropic client; reads env.ANTHROPIC_API_KEY
      chat/
        system-prompt.ts               # loads prompts/agent/v0-stub.md as a constant string
        context-builder.ts             # buildAgentContext stub: { recentMessages, caseFactsJson }
        persistence.ts                 # appendChatTurn: writes user + assistant + tool_calls in one tx
      tools/
        update_case.ts                 # already shipped (1B-1); registered on /api/chat
    inngest/
      client.ts                        # new Inngest({ id: 'visa', eventKey?, signingKey? })
      functions/
        log-case-event.ts              # listens for 'case.facts.updated', writes activity_log row
prompts/
  agent/
    v0-stub.md                         # ~10 lines, placeholder; Phase 2 replaces with v0.md
```

**Existing modules touched (small, surgical):**
- `src/lib/case/repository.ts` — `createCase` extends to insert one row in `threads` inside the same tx (one-thread-per-case rule).
- `src/lib/env.ts` — adds `ANTHROPIC_API_KEY` (required), `INNGEST_EVENT_KEY` (optional dev / required prod), `INNGEST_SIGNING_KEY` (same).
- `src/app/page.tsx` — replaces the Phase 1A scaffold stub with the landing CTA.
- `src/app/layout.tsx` — adds the `<Toaster />` slot if shadcn ships one as part of the four primitives (defer if not needed).

### 2.2 Trust boundaries

- *Browser → `/api/chat`:* request body Zod-parsed (`{ caseId: uuid, messages: <AI SDK shape> }`). Server mints a fresh `userMessageId: crypto.randomUUID()` per request — clients do not control message ids.
- *Ownership check:* `getCurrentUserId()` reads the cookie; we then `SELECT user_id FROM cases WHERE id = $caseId` and 403 on mismatch.
- *AI SDK v5 → tools:* `update_case` already does its own Zod parse via the shipped tool adapter. Nothing else hits the case repository from the chat path.
- *Inngest emit:* fired in `onFinish` *after* the persistence tx commits. If `inngest.send` throws we log + continue — the durable audit trail is `activity_log`, not the Inngest event.
- *Inngest webhook → `logCaseEvent`:* the Inngest SDK verifies signatures in prod (signing key required); in dev the inngest CLI proxies events without signature.

---

## 3. Routes & request shapes

### 3.1 `GET /`

Server component. Renders a hero + a single `<form action={POST /api/case/new}>` button. No session reads — landing page is identical for anon and authed users in 1B-3 (return-visitor UX is Phase 2's call).

### 3.2 `POST /api/case/new`

```ts
export async function POST(req: Request) {
  const { userId } = await ensureAnonymousSession();
  const { caseId } = await makeRepository().createCase({
    userId,
    visaType: 'eu_blue_card_germany',
    targetCountry: 'DE',
    targetConsulate: 'bengaluru',
  });
  return NextResponse.redirect(new URL(`/case/${caseId}`, req.url), { status: 303 });
}
```

`ensureAnonymousSession` is a 1B-2 export — RSC-unsafe but route-handler-safe. `createCase` (extended in this phase) inserts the case row, the `case_facts` row, *and* one `threads` row, all in a single transaction.

### 3.3 `GET /case/[id]`

Server component.
1. `userId = getCurrentUserId()` — null is allowed (anon).
2. `loaded = makeRepository().loadCase(id)` — throws if not found → Next.js renders a 404 page.
3. If `loaded.case.userId !== userId` → render a 403 page.
4. Pass `{ case, caseFacts, profile, recentMessages }` to `<Layout>`. `recentMessages` is the last 50 messages in the case's thread (more than the agent gets, less than infinite scroll); the chat panel uses these as `useChat`'s `initialMessages`.

### 3.4 `POST /api/chat`

```ts
export const runtime = 'nodejs';

const BodySchema = z.object({
  caseId: z.string().uuid(),
  messages: z.array(z.unknown()),       // AI SDK v5 will re-validate via convertToModelMessages
});

export async function POST(req: Request) {
  const body = BodySchema.parse(await req.json());
  const userId = await getCurrentUserId();
  if (!userId) return new Response('unauthorized', { status: 401 });

  const repo = makeRepository();
  const loaded = await repo.loadCase(body.caseId);
  if (loaded.case.userId !== userId) return new Response('forbidden', { status: 403 });

  const userMessageId = crypto.randomUUID();
  const modelMessages = await convertToModelMessages(body.messages);
  const ctx = await buildAgentContext({ caseId: body.caseId, caseFacts: loaded.caseFacts });

  const result = streamText({
    model: anthropic('claude-sonnet-4-7'),
    system: systemPrompt,
    messages: modelMessages,
    tools: {
      update_case: makeUpdateCaseTool(repo, {
        defaultCaseId: body.caseId,
        defaultSourceTurnId: userMessageId,
      }),
    },
    stopWhen: stepCountIs(5),
    providerOptions: {
      anthropic: { cacheControl: { type: 'ephemeral' } },
    },
    async onFinish({ response, toolCalls }) {
      await appendChatTurn({
        threadId: loaded.threadId,
        userMessageId,
        userMessageContent: extractLastUserText(modelMessages),
        assistantResponse: response,
        toolCalls,
        promptVersion: 'v0-stub',
        modelVersion: 'claude-sonnet-4-7',
      });
      const updateCalls = toolCalls.filter((c) => c.toolName === 'update_case');
      for (const call of updateCalls) {
        await inngest.send({
          name: 'case.facts.updated',
          data: { caseId: body.caseId, paths: call.output?.data?.updatedPaths ?? [], sourceTurnId: userMessageId },
        }).catch((err) => console.error('inngest emit failed', err));
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
```

Three things bind this code to decisions:
- `userMessageId` is server-generated and threaded into `update_case` as `sourceTurnId` so the tool's existing Zod schema sees a valid uuid without the LLM having to invent one. This requires a small shape change to the tool factory — see §4.4.
- The system prompt and the `update_case` tool both carry `providerOptions.anthropic.cacheControl.type: 'ephemeral'`. Per CLAUDE.md, breakpoints live on each tool's own `providerOptions`, not on the top-level `tools` map.
- `stopWhen: stepCountIs(5)` is the CLAUDE.md gotcha — without N≥2 the model emits the tool call but never gets to read its result, so there is no natural-language reply.

### 3.5 `GET/POST /api/inngest`

```ts
import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { logCaseEvent } from '@/lib/inngest/functions/log-case-event';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [logCaseEvent],
});
```

`runtime = 'nodejs'`. Inngest's `serve` already speaks all three verbs.

---

## 4. Components in detail

### 4.1 Workspace shell — `src/components/workspace/Layout.tsx`

```tsx
export function Layout({ caseId, caseFacts, recentMessages }: LayoutProps) {
  return (
    <div className="grid h-screen grid-cols-[220px_1fr_360px]">
      <Nav caseId={caseId} />
      <Overview caseFacts={caseFacts} />
      <ChatPanel caseId={caseId} initialMessages={recentMessages} />
    </div>
  );
}
```

Server component. CSS-grid only, no responsive breakpoints in 1B-3 (mobile bottom sheet is Phase 2; spec §4.2 explicitly punts it).

### 4.2 Left rail — `Nav.tsx`

Static list with a single active item ("Overview"). The other items (Profile, Documents, Drafts, Forms, Timeline, Tasks, Activity) render as disabled-looking placeholders. No interactivity.

### 4.3 Center column — `Overview.tsx`

Server component. Receives `caseFacts: CaseFacts`. Renders one `<Card>` per top-level key (`employment`, `education`, `family`, `risk`) and inside each card lists the leaf facts present, with their values. If a fact has provenance, hover renders the `{source, confidence, updatedAt}` triple as a small popover.

If `caseFacts` is empty (fresh case), shows: *"Your case file is empty. Tell the agent on the right what's going on."*

Eligibility verdict, "what we still need" prompts, anything that requires the rules engine — all Phase 2.

### 4.4 Right column — `ChatPanel.tsx` (client island)

```tsx
'use client';

const transport = new DefaultChatTransport({
  api: '/api/chat',
  body: { caseId },                                    // attached to every send
});

const { messages, sendMessage } = useChat({
  transport,
  initialMessages,
  onFinish: ({ message }) => {
    if (messageContainsUpdateCase(message)) {
      router.refresh();
    }
  },
});
```

Three notes:
- `useChat`'s v5 transport API. Per CLAUDE.md, the `api` option on `useChat` itself is gone — the `api` URL belongs on `DefaultChatTransport`.
- The exact attachment hook for `caseId` (`body` option vs `experimental_prepareRequestBody` vs per-`sendMessage` body) is pinned by the implementation plan against the installed `ai@5.0.192`. The shape of the parsed request body on the server side does not depend on this choice.
- The `router.refresh()` trigger is `onFinish`, gated on whether the assistant's message parts contain at least one `update_case` tool call. One refresh per turn that mutated state. Pure-conversation turns (no tool call) skip the refresh.

### 4.5 `update_case` tool — small refactor

The 1B-1 tool currently takes a full `UpdateCaseInput` from the LLM, including `caseId` and `sourceTurnId`. For 1B-3 the LLM must NOT see those — they're plumbing the route already knows. Change `makeUpdateCaseTool` to accept defaults at construction time:

```ts
export function makeUpdateCaseTool(
  repo: Pick<Repository, 'applyUpdate'>,
  defaults: { defaultCaseId: string; defaultSourceTurnId: string }
) {
  return tool({
    description,
    inputSchema: UpdateCaseInputSchemaForLLM,   // omits caseId + sourceTurnId
    async execute(input) {
      const result = await repo.applyUpdate({
        ...input,
        caseId: defaults.defaultCaseId,
        sourceTurnId: defaults.defaultSourceTurnId,
      });
      return { type: 'update_case_result' as const, version: 1 as const, data: result };
    },
    providerOptions: {
      anthropic: { cacheControl: { type: 'ephemeral' } },
    },
  });
}
```

`UpdateCaseInputSchemaForLLM` derives from `UpdateCaseInputSchema` via `.omit({ caseId: true, sourceTurnId: true })`. The 1B-1 tests still construct the full schema directly against `repo.applyUpdate`; we keep the existing tests untouched and add new tests that drive through the LLM-facing factory shape.

This is a small, contained refactor. The tool's existing integration tests in `tests/ai/update_case.test.ts` need a one-line change to pass `defaults`.

### 4.6 Persistence helper — `appendChatTurn`

```ts
export async function appendChatTurn(
  input: AppendChatTurnInput,
  db: Db = getDefaultDb(),
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(messages).values({
      id: input.userMessageId,
      threadId: input.threadId,
      role: 'user',
      content: input.userMessageContent,
      parts: null,
      channel: 'web',
    });

    const assistantMessageId = crypto.randomUUID();
    await tx.insert(messages).values({
      id: assistantMessageId,
      threadId: input.threadId,
      role: 'assistant',
      content: input.assistantResponse.text,
      parts: input.assistantResponse.messages,           // jsonb dump of UIMessage parts
      channel: 'web',
      modelVersion: input.modelVersion,
      promptVersion: input.promptVersion,
    });

    for (const call of input.toolCalls) {
      await tx.insert(toolCalls).values({
        messageId: assistantMessageId,
        toolName: call.toolName,
        input: call.input,
        output: call.output ?? null,
        durationMs: null,                                 // populate in Phase 2 if we measure
        error: call.error?.message ?? null,
      });
    }

    await tx
      .update(threads)
      .set({ lastMessageAt: new Date() })
      .where(eq(threads.id, input.threadId));
  });
}
```

One transaction per turn. The `db` parameter mirrors the `repository.ts` lazy-default pattern (CJS `require('@/lib/db/client').db`) so tests can pass a schema-scoped `db` without triggering env validation at import time — same shape used by `makeRepository(db)` in 1B-1.

If the transaction throws, `streamText` has already shown the assistant's reply to the user — that's a known gap in 1B-3 (no UI rollback) and we accept it. Logged to console; users see the response visually but don't get persistence on failure. Phase 2's eval workflow will catch persistent failures in trends.

### 4.7 System prompt — `prompts/agent/v0-stub.md`

```
You are a case-management assistant for German Blue Card applications.

Your only available tool is `update_case`. Call it whenever the user mentions
a fact about themselves: their employment, education, family, current location.

Use dotted paths like `employment.annualGrossSalaryEur`, `employment.employerName`,
`education.degreeCountry`, `education.anabinStatus`, `nationality`.

Do not quote thresholds, fees, or processing times. Do not give legal advice.
This is a stub for development; the real system prompt arrives in Phase 2.
```

Loaded at module import time as a constant string via Node's `fs.readFileSync` so we don't pay per-request I/O. The build step copies `prompts/` into the deployed bundle.

### 4.8 Context builder stub — `buildAgentContext`

```ts
export async function buildAgentContext(input: {
  caseId: string;
  caseFacts: CaseFacts;
}): Promise<{ caseFactsJson: string }> {
  return { caseFactsJson: JSON.stringify(input.caseFacts) };
}
```

Returned to the route handler but not used yet — `streamText` already gets the message history via `messages`, and the system prompt is static. We pre-compute `caseFactsJson` so Phase 2 can fold it into the system prompt or a system message without re-architecting.

### 4.9 Inngest client + function

```ts
// src/lib/inngest/client.ts
export const inngest = new Inngest({
  id: 'visa',
  eventKey: env.INNGEST_EVENT_KEY,
  ...(env.INNGEST_SIGNING_KEY && { signingKey: env.INNGEST_SIGNING_KEY }),
});

// src/lib/inngest/functions/log-case-event.ts
export const logCaseEvent = inngest.createFunction(
  { id: 'log-case-event' },
  { event: 'case.facts.updated' },
  async ({ event, step }) => {
    await step.run('write-activity-log', async () => {
      await db.insert(activityLog).values({
        caseId: event.data.caseId,
        userId: null,
        kind: 'inngest.echo',
        payload: { paths: event.data.paths, sourceTurnId: event.data.sourceTurnId },
      });
    });
  },
);
```

Step-deterministic: no `Date.now()` outside `step.run`. The function is intentionally trivial — it proves the wiring (event arrives, step runs, row written) without asking 1B-3 to design real workflow semantics.

---

## 5. Data flow per chat turn

```
Browser useChat sendMessage
        │
        ▼
POST /api/chat  { caseId, messages }
        │
        ▼
Zod-parse body  → mint userMessageId  → loadCase + ownership check
        │
        ▼
streamText(system, messages, tools={update_case}, stopWhen=stepCountIs(5))
        │      ┌────────────────────────────────────┐
        │      │ assistant streams tokens to UI     │
        │      │ may call update_case 0..N times    │
        │      │ each call → applyUpdate (own tx)   │
        │      └────────────────────────────────────┘
        ▼
onFinish (server)
   ├─ appendChatTurn(tx)         # one user + one assistant + N tool_calls rows
   ├─ inngest.send(...) per update_case call (best-effort)
   └─ stream closes
        ▼
Browser onFinish:
   if message contains update_case → router.refresh()
        ▼
RSC re-renders /case/[id]:
   loadCase → Overview re-renders with new facts
        │
        ▼
Inngest dev server delivers event:
   logCaseEvent → activity_log row kind='inngest.echo'
```

Two independent durability rails:
- **Tool-side rail:** `update_case`'s own tx writes `case_facts` + `case_changes` + the `case.facts.updated` activity_log row. Already shipped in 1B-1.
- **Chat-side rail:** `appendChatTurn`'s tx writes `messages` + `tool_calls`. New in 1B-3.

If the tool tx commits but `appendChatTurn` fails, the case file is updated and the chat history loses the turn. The Overview will show the new fact when the page next loads (it reads from `case_facts`, not `messages`). The agent's next turn will see slightly stale message history but the case state remains correct. Acceptable failure mode for 1B-3.

---

## 6. Error handling

| Failure | What happens |
|---|---|
| User unauth (no cookie) on `/api/chat` | 401, no DB writes. ChatPanel surfaces the error toast. |
| User authed but case belongs to another user | 403, no DB writes. RSC shell already 403'd before chat could open, so this is defense-in-depth. |
| `convertToModelMessages` throws | Caught by Next.js, returns 500. ChatPanel re-renders the input field. |
| `update_case` rejects path | Returned as a tool result with error. Agent sees it, can retry or apologize. |
| `applyUpdate` throws (DB down) | Tool result is an error; agent sees it. No `case_facts` change, no Inngest event. |
| `appendChatTurn` throws | Logged. User sees the assistant reply (already streamed) but turn is missing from history. Refresh works because case_facts already wrote. |
| `inngest.send` throws | Logged, swallowed. Activity log shows the `case.facts.updated` row from `update_case` but no `inngest.echo` row. Verification gate notices. |
| Inngest function throws | Inngest retries automatically; each retry runs only the steps that failed. |
| `loadCase` throws on `/case/[id]` (case missing) | Next.js 404. |

Nothing in 1B-3 produces a true catastrophic state — every failure has a known degraded behavior and we surface enough information (console + activity_log) to debug.

---

## 7. Testing strategy

### 7.1 Tier 1 — pure unit (no DB, no network)

`tests/ai/chat/persistence.test.ts`
- `appendChatTurn` with no tool calls writes 2 messages rows, 0 tool_calls, updates `threads.lastMessageAt`.
- With 2 update_case tool calls writes 2 messages + 2 tool_calls.
- Throws if the threadId doesn't exist (FK violation surfaces as a thrown error).
- Uses the existing `withTestSchema` infra from 1B-1.

`tests/ai/chat/context-builder.test.ts`
- Returns `caseFactsJson` matching `JSON.stringify(input.caseFacts)`. (Trivial, but cheap to lock the shape so Phase 2 doesn't accidentally break the contract.)

`tests/ai/chat/system-prompt.test.ts`
- Loaded constant matches the `prompts/agent/v0-stub.md` file contents byte-for-byte (regression: prompt drift).

### 7.2 Tier 2 — repository extensions

`tests/case/repository.test.ts` (extend existing file)
- `createCase` now also inserts a thread row; `loadCase` returns the thread id.

### 7.3 Tier 3 — route handler integration (Next.js + mocked AI SDK)

`tests/api/chat.test.ts`
- POST without `visa_session` cookie → 401.
- POST with cookie for user A targeting case owned by user B → 403.
- POST with valid cookie, mocked `streamText` returning a fixed result with one update_case call → assert: `messages` has user + assistant rows, `tool_calls` has one row, `case_facts` updated, `inngest.send` called with shape `{ name: 'case.facts.updated', data: { caseId, paths, sourceTurnId } }`.
- Same as above but mocked `streamText` produces zero tool calls → assert no Inngest send, just messages rows.
- Mock seam: `vi.mock('ai', ...)` overrides `streamText` to call `onFinish` synchronously with a fixture response.
- Mock seam: `vi.mock('@/lib/inngest/client', ...)` so Inngest sends are observable spies, not real network.

### 7.4 Tier 4 — Inngest function integration

`tests/inngest/log-case-event.test.ts`
- Construct a fake event payload, call `logCaseEvent.execute({ event, step })` with a mocked `step.run` that just runs the callback.
- Assert one `activity_log` row with `kind='inngest.echo'` and matching payload.

### 7.5 Manual smoke (live UI)

Per `IMPLEMENTATION_PLAN.md` Phase 1 verification gate:

1. `pnpm dev` + `npx inngest-cli@latest dev` running side-by-side.
2. Visit `/`, click **Start a case**, land on `/case/<id>`.
3. Three columns visible. Center shows "Your case file is empty…". Right shows empty chat with input.
4. Type: "I work at Acme as a senior engineer making €55k a year."
5. Observe streaming response.
6. Observe `update_case` tool call in chat (rendered as a small card or text, however UIMessage parts surface tool calls).
7. Center column auto-refreshes within ~1s of the tool call completing. New facts appear in the Employment card.
8. Inngest dev UI shows one `case.facts.updated` event delivered to `log-case-event`.
9. Check Supabase: `messages` has 2 rows, `tool_calls` has 1 row, `case_changes` has 1+ rows, `activity_log` has *both* a `case.facts.updated` row AND an `inngest.echo` row.
10. Open `/signin` in another tab (the route already exists from 1B-2), enter the same email used by the anonymous session, click the magic link from the dev console. Redirect lands back on `/`; navigating to the same `/case/<id>` shows the case still owned by the now-authed user (1B-2's `promoteToAuthed` already covers the merge).

---

## 8. Verification gate

- [ ] `pnpm test` green, including all four new tiers.
- [ ] `pnpm exec tsc --noEmit` clean.
- [ ] `pnpm lint` clean.
- [ ] `pnpm build` green (with prod env validation — `ANTHROPIC_API_KEY` mandatory, Inngest keys mandatory).
- [ ] Manual smoke #1–9 (live UI loop, Inngest echo, DB rows match).
- [ ] CLAUDE.md updated with any new gotcha (anticipated: AI SDK v5 onFinish shape, Inngest signing-key dev posture, shadcn Tailwind 4 init notes).

---

## 9. Cross-cutting

### 9.1 Env (additions on top of 1B-2's set)

```ts
ANTHROPIC_API_KEY: z.string().min(1),                // required everywhere
INNGEST_EVENT_KEY:   optionalString,                 // required in production
INNGEST_SIGNING_KEY: optionalString,                 // required in production
```

`superRefine` adds production checks for the two Inngest keys, mirroring the existing AUTH_RESEND_KEY pattern.

### 9.2 New deps

- `@ai-sdk/anthropic` — provider for AI SDK v5.
- `inngest` — client + Next.js adapter.
- `@inngest/agent-kit` — **NOT** added; rejected per CLAUDE.md "no multi-agent frameworks."
- `@radix-ui/*` — installed transitively by shadcn add commands; pinned via shadcn CLI.

shadcn install commands:

```
pnpm dlx shadcn@latest init        # choose Tailwind 4 / CSS variables when prompted
pnpm dlx shadcn@latest add button card scroll-area input
```

### 9.3 No new migrations

All required tables (`threads`, `messages`, `tool_calls`, `activity_log`) shipped in Phase 1A. The `createCase` extension uses the existing `threads` table.

### 9.4 PII discipline

- `messages.content` stores user-typed text including any PII the user types. That's expected: the chat panel is the user's own input. Not redacted.
- `tool_calls.input` and `.output` may contain values written via `update_case`. These are the same values that already land in `case_changes`, which is gated by the existing 1B-1 GDPR-export plan. No additional PII surface.
- `activity_log.payload` for `inngest.echo` only contains paths + sourceTurnId — never values.

### 9.5 Observability

Console only. Anthropic responses include cache hit/miss in the response metadata; we log it in `onFinish` for 1B-3 visibility. Sentry + Langfuse are Phase 7.

### 9.6 Commit cadence

Conventional commits. Estimated ~14 commits for 1B-3:
1. Add deps + shadcn init (one commit).
2. `prompts/agent/v0-stub.md`.
3. `provider.ts` + system-prompt loader.
4. `context-builder.ts` + tests.
5. `persistence.ts` (`appendChatTurn`) + tests.
6. Extend `createCase` to insert thread + tests.
7. Refactor `update_case` tool factory (defaults; LLM-facing schema) + tests.
8. `/api/case/new` route + tests.
9. Inngest client + `logCaseEvent` + `/api/inngest` route + tests.
10. `/api/chat` route + tests.
11. Workspace shell components.
12. ChatPanel client island.
13. Replace `/` landing page.
14. CLAUDE.md updates + final smoke notes.

Push at the end after the verification gate passes.

---

## 10. Out of scope (explicitly)

- Real `buildAgentContext` (full PRD §8.3). Phase 2.
- Real system prompt (`prompts/agent/v0.md`). Phase 2.
- More than one tool. Phase 2.
- Approval cards / approval gates. Phase 3.
- Mobile bottom-sheet chat. Phase 2.
- "Save your case" anonymous-banner UI. Phase 2.
- Persona-driven E2E tests over the chat. Phase 2 (when real tools + agent logic make persona output meaningful).
- Sentry / Langfuse instrumentation. Phase 7.
- Rate limiting on `/api/chat`. Phase 7.
- Streaming-abort-rollback for partial assistant messages. Phase 2 if needed; degraded-but-safe today.

---

## 11. Open questions

None blocking. Items that may surface during implementation:

- **AI SDK v5 `streamText` `onFinish` shape:** the exact field that holds tool calls (`toolCalls` vs the more granular per-step iteration) may have moved between minor versions. Plan Task 5 verifies against the installed `ai@5.0.192`.
- **Tool result rendering in UI:** AI SDK ships a default UIMessage parts dispatcher. For 1B-3 we accept the default. Renderer registry per CLAUDE.md rule #8 lands when we have more than one tool to dispatch on.
- **`router.refresh()` jank:** if the refresh causes a visible flash, swap to React Server Actions's revalidatePath. Plan Task 11's smoke step checks for it.
- **Anthropic cache hit rate:** a stub system prompt is too short to hit the 1024-token minimum for caching. Document the no-op and revisit when the real prompt lands in Phase 2.
- **Inngest streaming + Vercel:** Inngest's webhook depends on Vercel routing the request to the Node runtime. We pin `runtime = 'nodejs'` on the route. If Vercel preview environments behave differently, surface in plan Task 9.

---

## 12. Sign-off

This spec covers Phase 1B-3 end to end and supersedes §4 of `2026-05-27-phase-1b-design.md`. The implementation plan lands at `docs/superpowers/plans/2026-05-28-phase-1b-3-chat-workspace.md` and follows the same TDD-where-it-pays / real-DB-where-it-matters discipline as 1B-1 and 1B-2.
