# Phase 2C-tail — L2b Real-Stream Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, ~0-token persona test layer (L2b) that drives the *real* `buildAgentTurn` `streamText` loop with a scripted `MockLanguageModelV3` — real tools, real `stopWhen`, real multi-step recovery, real DB — and use it to drive a TDD fix of a `buildAgentTurn.onFinish` step-aggregation bug.

**Architecture:** A new `tests/_personas/mock-stream.ts` helper converts a tool-call sequence into a `MockLanguageModelV3` (shipped first-party in `ai@6`, no `msw`). A new DB-backed `tests/personas/agent-turn-loop.test.ts` scripts per-persona happy-path and one recovery sequence, runs them through `buildAgentTurn`, and asserts real DB end-state + real `onFinish` side-effects. The bug-catching assertions are expected to go red, driving a fix in `agent-turn.ts` (`onFinish` reads `event.steps[]` aggregate instead of last-step `event.toolResults`), with the two synthesized-event fixtures (`harness.ts`, `chat.test.ts`) realigned to populate `event.steps`.

**Tech Stack:** Vitest, AI SDK v6 (`ai`, `ai/test`), Drizzle + Supabase (test schemas), TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-06-02-phase-2c-tail-l2b-design.md`

---

## Pre-flight: branch setup

The current branch `feat/persona-e2e` is already merged (PR #4). Start fresh off `main`, carrying forward the two unpushed commits already on `feat/persona-e2e` (`ee169ed` CLAUDE.md trim + `c7fd3db` this spec).

- [ ] **Step 0: Create the working branch**

```bash
cd /Users/vitalii.kashin/Projects/visa
git checkout main && git pull --ff-only
git checkout -b feat/persona-l2b
# carry forward the trim + spec commits that live only on feat/persona-e2e:
git cherry-pick ee169ed c7fd3db
git log --oneline -3
```

Expected: `feat/persona-l2b` exists with the CLAUDE.md trim and the L2b spec on top of `main`. If `git pull` reports the branch is already current, that's fine.

---

## File Structure

**New files:**
- `tests/_personas/mock-stream.ts` — `ScriptStep` type + `makeScriptedModel(steps)` → `MockLanguageModelV3`. Pure helper; knows nothing about personas or the DB.
- `tests/_personas/mock-stream.test.ts` — unit tests for the helper in isolation (drive it through real `streamText`, assert step sequencing).
- `tests/personas/agent-turn-loop.test.ts` — L2b: DB-backed, runs `buildAgentTurn` with scripted models, asserts end-state + side-effects.

**Modified files:**
- `src/lib/ai/chat/agent-turn.ts` — `onFinish` aggregates `event.steps[].toolCalls/toolResults` (the fix).
- `tests/_personas/harness.ts` — `synthesizeTurnEvent` populates `event.steps` (fidelity realignment).
- `tests/api/chat.test.ts` — realign the two `onFinish` fixtures to populate `steps`.
- `package.json` — add `agent-turn-loop.test.ts` + `mock-stream.test.ts` to `test:personas`.
- `CLAUDE.md` — fix the stale `MockLanguageModelV3`/`msw` note; add an `onFinish`-reads-`event.steps` gotcha.

---

## Task 1: Scripted mock-stream helper

Build the `MockLanguageModelV3` factory in isolation, TDD. This is the one genuinely new building block.

**Files:**
- Create: `tests/_personas/mock-stream.ts`
- Test: `tests/_personas/mock-stream.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/_personas/mock-stream.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { streamText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { makeScriptedModel, type ScriptStep } from './mock-stream';

describe('makeScriptedModel', () => {
  it('emits a text-only turn that streams its text and stops', async () => {
    const model = makeScriptedModel([{ kind: 'text', text: 'hello world' }]);
    let finishText: string | undefined;
    const result = streamText({
      model,
      messages: [{ role: 'user', content: 'hi' }],
      onFinish: (e) => {
        finishText = e.text;
      },
    });
    let streamed = '';
    for await (const delta of result.textStream) streamed += delta;
    expect(streamed).toBe('hello world');
    expect(finishText).toBe('hello world');
  });

  it('drives a multi-step tool sequence: the SDK runs the real tool, then the model replies', async () => {
    const calls: string[] = [];
    const echo = tool({
      description: 'echo',
      inputSchema: z.object({ value: z.string() }),
      async execute({ value }) {
        calls.push(value);
        return { type: 'echo_result', version: 1 as const, data: { value } };
      },
    });

    const script: ScriptStep[] = [
      { kind: 'tool', toolCallId: 'c1', toolName: 'echo', input: { value: 'first' } },
      { kind: 'text', text: 'done' },
    ];
    const model = makeScriptedModel(script);

    let event: { steps: Array<{ toolResults: Array<{ toolName: string }> }> } | undefined;
    const result = streamText({
      model,
      tools: { echo },
      stopWhen: stepCountIs(8),
      messages: [{ role: 'user', content: 'go' }],
      onFinish: (e) => {
        event = e as never;
      },
    });
    let text = '';
    for await (const delta of result.textStream) text += delta;

    expect(calls).toEqual(['first']); // the REAL tool executed
    expect(text).toBe('done');
    // The result lives in steps[], not top-level (this is the SDK shape L2b depends on).
    const allToolResults = event!.steps.flatMap((s) => s.toolResults);
    expect(allToolResults.map((r) => r.toolName)).toContain('echo');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/_personas/mock-stream.test.ts`
Expected: FAIL — `Cannot find module './mock-stream'` (or `makeScriptedModel is not a function`).

- [ ] **Step 3: Write the helper**

Create `tests/_personas/mock-stream.ts`:

```ts
import { MockLanguageModelV3 } from 'ai/test';
import type { LanguageModel } from 'ai';

/**
 * One step of a scripted agent turn. A `tool` step makes the mock model emit a single tool
 * call (the SDK then runs the REAL tool and loops); a `text` step is terminal — it emits text
 * and finishReason 'stop', ending the loop.
 */
export type ScriptStep =
  | { kind: 'tool'; toolCallId: string; toolName: string; input: unknown }
  | { kind: 'text'; text: string };

const USAGE = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

function chunksFor(step: ScriptStep): unknown[] {
  if (step.kind === 'tool') {
    return [
      {
        type: 'tool-call',
        toolCallId: step.toolCallId,
        toolName: step.toolName,
        input: JSON.stringify(step.input),
      },
      { type: 'finish', finishReason: 'tool-calls', usage: USAGE },
    ];
  }
  return [
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: step.text },
    { type: 'text-end', id: 't' },
    { type: 'finish', finishReason: 'stop', usage: USAGE },
  ];
}

/**
 * Build a MockLanguageModelV3 that plays a scripted sequence of steps. The SDK calls doStream
 * once per step; this returns step i's chunks and advances. Shipped first-party in ai@6 — no msw,
 * no hand-rolled protocol. Assignable to `LanguageModel` with no cast.
 */
export function makeScriptedModel(steps: ScriptStep[]): LanguageModel {
  let i = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      const step = steps[Math.min(i, steps.length - 1)];
      i++;
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const chunk of chunksFor(step!)) controller.enqueue(chunk);
            controller.close();
          },
        }),
      };
    },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/_personas/mock-stream.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/_personas/mock-stream.ts tests/_personas/mock-stream.test.ts
git commit -m "test: scripted MockLanguageModelV3 helper for real-loop persona replay"
```

---

## Task 2: L2b happy-path test (in-scope personas) — expected to go RED

Write the DB-backed test that runs the real loop for the 3 in-scope personas. The end-state assertions will pass; the `onFinish` side-effect assertions are expected to FAIL (the bug). This is the red step that drives Task 4's fix.

**Files:**
- Create: `tests/personas/agent-turn-loop.test.ts`

- [ ] **Step 1: Write the test (happy-path, in-scope + out-of-scope branches)**

Create `tests/personas/agent-turn-loop.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedOrgAndUser, type SeededIds } from '../_db/seed';
import { makeRepository } from '@/lib/case/repository';
import {
  loadAllPersonas,
  toCaseFacts,
  deriveUpdateCalls,
  flattenLeafValues,
} from '../_personas/harness';
import { makeScriptedModel, type ScriptStep } from '../_personas/mock-stream';

// onFinish persists via appendChatTurn and emits via inngest.send. Mock both to observe
// side-effects without booting persistence/Inngest (same pattern as agent-turn-replay.test.ts).
const appendChatTurnSpy = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/ai/chat/persistence', () => ({ appendChatTurn: appendChatTurnSpy }));
const inngestSendSpy = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: inngestSendSpy } }));

const TURN_ID = '00000000-0000-4000-8000-0000000000bb';

const toValueMap = (flat: Array<{ path: string; value: unknown }>) =>
  Object.fromEntries(flat.map((l) => [l.path, l.value]));

// Aggregate tool results across all steps (the SDK puts per-step results in steps[]).
function allToolResults(persisted: { toolResults: Array<{ toolName: string }> }) {
  return persisted.toolResults;
}

describe('persona agent-turn LIVE LOOP (L2b, DB-backed)', () => {
  let handle: TestDbHandle;
  let seeded: SeededIds;

  beforeAll(async () => {
    handle = await createTestSchema();
    seeded = await seedOrgAndUser(handle);
  }, 30_000);

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  for (const persona of loadAllPersonas()) {
    it(`${persona.id}: real loop writes facts and fires onFinish side-effects`, async () => {
      const { buildAgentTurn } = await import('@/lib/ai/chat/agent-turn');
      const repo = makeRepository(handle.db, handle.schemaName);
      const { caseId, threadId } = await repo.createCase({
        userId: seeded.userId,
        visaType: 'blue_card',
        targetCountry: 'DE',
        targetConsulate: 'bengaluru',
      });

      let script: ScriptStep[];
      if (persona.expected.outOfScope) {
        script = [
          { kind: 'tool', toolCallId: 'c1', toolName: 'out_of_scope', input: { reason: 'out of scope' } },
          { kind: 'text', text: 'That is outside what I can help with here.' },
        ];
      } else {
        const bundle = deriveUpdateCalls(persona)[0]!; // in-scope personas have only the valid bundle
        script = [
          { kind: 'tool', toolCallId: 'c1', toolName: 'update_case', input: bundle },
          { kind: 'tool', toolCallId: 'c2', toolName: 'check_eligibility', input: {} },
          { kind: 'text', text: 'Recorded. Here is where you stand.' },
        ];
      }

      const result = await buildAgentTurn({
        model: makeScriptedModel(script),
        repo,
        caseId,
        threadId,
        userId: seeded.userId,
        userMessageId: TURN_ID,
        caseFacts: {},
        modelMessages: [{ role: 'user', content: 'here is my situation' }] as never,
      });

      // Drain the stream — onFinish fires only after the stream is consumed.
      for await (const _ of result.textStream) {
        void _;
      }

      // --- appendChatTurn received the turn identity + the tools that fired across all steps ---
      expect(appendChatTurnSpy).toHaveBeenCalledOnce();
      const persisted = appendChatTurnSpy.mock.calls[0]![0] as {
        threadId: string;
        userMessageId: string;
        toolCalls: Array<{ toolName: string }>;
        toolResults: Array<{ toolName: string }>;
      };
      expect(persisted.threadId).toBe(threadId);
      expect(persisted.userMessageId).toBe(TURN_ID);

      if (persona.expected.outOfScope) {
        expect(persisted.toolCalls.map((c) => c.toolName)).toContain('out_of_scope');
        expect(inngestSendSpy).not.toHaveBeenCalled();
        // No case facts written by an out_of_scope-only turn.
        const loaded = await repo.loadCase(caseId);
        expect(flattenLeafValues(loaded.caseFacts).length).toBe(0);
        return;
      }

      // In-scope: the REAL update_case + check_eligibility tools ran across steps.
      expect(persisted.toolCalls.map((c) => c.toolName)).toEqual(
        expect.arrayContaining(['update_case', 'check_eligibility']),
      );
      expect(allToolResults(persisted).map((r) => r.toolName)).toEqual(
        expect.arrayContaining(['update_case', 'check_eligibility']),
      );

      // DB end-state: the real update_case tool persisted the derived facts.
      const loaded = await repo.loadCase(caseId);
      const expectedMap = toValueMap(flattenLeafValues(toCaseFacts(persona)));
      expect(toValueMap(flattenLeafValues(loaded.caseFacts))).toEqual(expectedMap);

      // check_eligibility ran on the WRITTEN facts → its result is in the persisted toolResults.
      const elig = allToolResults(persisted).find((r) => r.toolName === 'check_eligibility') as
        | { output?: { data?: { status?: string } } }
        | undefined;
      expect(elig?.output?.data?.status).toBeDefined();

      // Inngest emit fired for the update_case write.
      expect(inngestSendSpy).toHaveBeenCalled();
      const sent = inngestSendSpy.mock.calls[0]![0] as {
        name: string;
        data: { caseId: string; paths: string[]; sourceTurnId: string };
      };
      expect(sent.name).toBe('case.facts.updated');
      expect(sent.data.caseId).toBe(caseId);
      expect(sent.data.sourceTurnId).toBe(TURN_ID);
      expect(sent.data.paths.length).toBeGreaterThan(0);
    });
  }
});
```

- [ ] **Step 2: Run the test — observe which assertions fail (confirms the bug)**

Run: `pnpm exec vitest run --no-file-parallelism tests/personas/agent-turn-loop.test.ts`
Expected: For in-scope personas, the **DB end-state** assertion PASSES (the real `update_case` tool wrote facts), but `expect(persisted.toolCalls...).toEqual(arrayContaining([...]))`, the `toolResults` assertion, and `expect(inngestSendSpy).toHaveBeenCalled()` **FAIL** — because `onFinish` reads last-step `event.toolResults` (empty when the turn ends in a text step). The out-of-scope persona likely PASSES (its emit correctly does not fire). **This red state is the evidence the bug is real.**

> If instead ALL assertions PASS on first run: the real loop carries tool results at the top level (probe evidence was wrong / no bug). In that case skip Task 4's `agent-turn.ts` change, note the outcome, and proceed — L2b stands as pure coverage. (Scope guard from the spec.)

- [ ] **Step 3: Commit the red test**

```bash
git add tests/personas/agent-turn-loop.test.ts
git commit -m "test: L2b real-loop persona replay (red — exposes onFinish last-step bug)"
```

---

## Task 3: Realign synthesized-event fixtures to populate `event.steps`

Before fixing `agent-turn.ts` (Task 4), update the two places that hand-build `onFinish` events so they mirror the real SDK shape (`steps[]` carries the tool calls/results). This keeps L2a + `chat.test.ts` green *after* the Task 4 fix reads `event.steps`. Do this first so Task 4's fix turns everything green in one move.

**Files:**
- Modify: `tests/_personas/harness.ts` (the `SynthTurnEvent` type + `synthesizeTurnEvent`)
- Modify: `tests/api/chat.test.ts` (two `streamTextOnFinish({...})` fixtures)

- [ ] **Step 1: Update the `SynthTurnEvent` type + `synthesizeTurnEvent` in `harness.ts`**

In `tests/_personas/harness.ts`, replace the `SynthTurnEvent` interface (currently `steps: never[]`) and both `return` objects in `synthesizeTurnEvent` so a single step carries the tool calls/results plus a terminal text step.

Replace the interface:

```ts
export interface SynthStep {
  text: string;
  content: Array<{ type: 'text'; text: string }>;
  toolCalls: SynthToolCall[];
  toolResults: SynthToolResult[];
}
export interface SynthTurnEvent {
  text: string;
  content: Array<{ type: 'text'; text: string }>;
  toolCalls: SynthToolCall[];
  toolResults: SynthToolResult[];
  steps: SynthStep[];
}
```

In the out-of-scope branch, replace `steps: [],` with a step carrying the out_of_scope call/result and a terminal text step:

```ts
      steps: [
        {
          text: '',
          content: [],
          toolCalls: [
            { toolCallId: 'call-oos', toolName: 'out_of_scope', input: { reason: persona.expected.reason ?? 'out of scope' } },
          ],
          toolResults: [
            { toolCallId: 'call-oos', toolName: 'out_of_scope', output: { type: 'out_of_scope_result', version: 1, data: {} } },
          ],
        },
        { text, content: [{ type: 'text', text }], toolCalls: [], toolResults: [] },
      ],
```

In the in-scope branch, replace `steps: [],` with:

```ts
    steps: [
      {
        text: '',
        content: [],
        toolCalls: [{ toolCallId: 'call-1', toolName: 'update_case', input: bundle }],
        toolResults: [
          {
            toolCallId: 'call-1',
            toolName: 'update_case',
            output: {
              type: 'update_case_result',
              version: 1,
              data: { caseId: 'case-synthetic', updatedPaths, contradictions: [] },
            },
          },
        ],
      },
      { text, content: [{ type: 'text', text }], toolCalls: [], toolResults: [] },
    ],
```

Keep the existing top-level `toolCalls`/`toolResults` as-is for now (Task 4 stops reading them; removing them is optional cleanup, not required).

- [ ] **Step 2: Update the two fixtures in `chat.test.ts`**

In `tests/api/chat.test.ts`, the success test (around line 117) builds an `onFinish` event with `steps: []`. Move its tool calls/results into a step. Replace the `steps: [],` in the FIRST `streamTextOnFinish({...})` call with:

```ts
      steps: [
        {
          text: '',
          content: [],
          toolCalls: [
            { toolCallId: 'call-1', toolName: 'update_case', input: { source: 'user_stated', confidence: 0.9, updates: { 'employment.annualGrossSalaryEur': 55000 } } },
          ],
          toolResults: [
            { toolCallId: 'call-1', toolName: 'update_case', output: { type: 'update_case_result', version: 1, data: { caseId, updatedPaths: ['employment.annualGrossSalaryEur'], contradictions: [] } } },
          ],
        },
        { text: 'Recorded.', content: [{ type: 'text', text: 'Recorded.' }], toolCalls: [], toolResults: [] },
      ],
```

The second fixture (the "no tools fired" test, around line 156) has empty tool arrays — replace its `steps: []` with a single terminal text step:

```ts
      steps: [{ text: 'Hi!', content: [{ type: 'text', text: 'Hi!' }], toolCalls: [], toolResults: [] }],
```

- [ ] **Step 3: Run the affected suites — they should STILL PASS (pre-fix, onFinish still reads top-level)**

Run: `pnpm exec vitest run --no-file-parallelism tests/personas/agent-turn-replay.test.ts tests/api/chat.test.ts`
Expected: PASS. The fixtures still carry top-level `toolResults`, which current `onFinish` reads, AND now also carry `steps`. Nothing breaks yet — this step only adds the `steps` data.

- [ ] **Step 4: Commit**

```bash
git add tests/_personas/harness.ts tests/api/chat.test.ts
git commit -m "test: synthesized onFinish events carry event.steps (mirror real SDK shape)"
```

---

## Task 4: Fix `buildAgentTurn.onFinish` to aggregate across steps — turns L2b GREEN

Apply the source fix. `onFinish` reads `event.steps[].toolCalls/toolResults` instead of last-step top-level. This turns Task 2's red assertions green while keeping Task 3's realigned fixtures green.

**Files:**
- Modify: `src/lib/ai/chat/agent-turn.ts:85-126` (the `onFinish` body)

- [ ] **Step 1: Confirm the red state (run L2b once more)**

Run: `pnpm exec vitest run --no-file-parallelism tests/personas/agent-turn-loop.test.ts`
Expected: in-scope personas still FAIL on the toolCalls/toolResults/inngest assertions (Task 2's red). (Skip to "scope guard" if it's unexpectedly green.)

- [ ] **Step 2: Apply the aggregation fix**

In `src/lib/ai/chat/agent-turn.ts`, inside `async onFinish(event) {`, add the aggregation at the top of the body and switch both consumers to it. Replace this current block:

```ts
    async onFinish(event) {
      try {
        await appendChatTurn({
          threadId,
          userMessageId,
          userMessageContent: extractLastUserText(modelMessages as never),
          assistantText: event.text,
          assistantParts: event.content,
          toolCalls: event.toolCalls.map((c) => ({
            toolCallId: c.toolCallId,
            toolName: c.toolName,
            input: c.input,
          })),
          toolResults: event.toolResults.map((r) => ({
            toolCallId: r.toolCallId,
            toolName: r.toolName,
            output: r.output,
          })),
          promptVersion: PROMPT_VERSION,
          modelVersion: MODEL_ID,
        });
      } catch (err) {
        console.error('appendChatTurn failed', err);
      }

      const updateResults = event.toolResults.filter((r) => r.toolName === 'update_case');
```

with:

```ts
    async onFinish(event) {
      // The SDK's onFinish top-level toolCalls/toolResults are the LAST STEP only
      // (index.d.ts: OnFinishEvent = StepResult & { steps }). A turn that calls a tool then
      // replies with text in a later step has an empty last step → tool parts dropped from
      // history AND the case.facts.updated emit never fires. Aggregate across all steps.
      const allToolCalls = event.steps.flatMap((s) => s.toolCalls);
      const allToolResults = event.steps.flatMap((s) => s.toolResults);

      try {
        await appendChatTurn({
          threadId,
          userMessageId,
          userMessageContent: extractLastUserText(modelMessages as never),
          assistantText: event.text,
          assistantParts: event.content,
          toolCalls: allToolCalls.map((c) => ({
            toolCallId: c.toolCallId,
            toolName: c.toolName,
            input: c.input,
          })),
          toolResults: allToolResults.map((r) => ({
            toolCallId: r.toolCallId,
            toolName: r.toolName,
            output: r.output,
          })),
          promptVersion: PROMPT_VERSION,
          modelVersion: MODEL_ID,
        });
      } catch (err) {
        console.error('appendChatTurn failed', err);
      }

      const updateResults = allToolResults.filter((r) => r.toolName === 'update_case');
```

(The rest of the `for (const result of updateResults)` loop is unchanged.)

- [ ] **Step 3: Run L2b — now green**

Run: `pnpm exec vitest run --no-file-parallelism tests/personas/agent-turn-loop.test.ts`
Expected: PASS (all 4 personas — 3 in-scope with facts+emit, 1 out-of-scope with no emit).

- [ ] **Step 4: Run the realigned synthesized-event suites — still green**

Run: `pnpm exec vitest run --no-file-parallelism tests/personas/agent-turn-replay.test.ts tests/api/chat.test.ts`
Expected: PASS. (Task 3's `steps` data is now what `onFinish` reads; top-level fields are ignored.)

- [ ] **Step 5: Commit the fix**

```bash
git add src/lib/ai/chat/agent-turn.ts
git commit -m "fix: aggregate onFinish tool results across steps (was last-step only)

A turn that calls update_case then replies with text in a later step left
the last step empty, so tool parts were dropped from chat history and the
case.facts.updated Inngest emit never fired even though facts were written.
Read event.steps[] aggregate. Surfaced by the L2b real-loop persona test."
```

---

## Task 5: Recovery scenario (one persona) — proves MAX_AGENT_STEPS=8

Add a test that scripts a tool error mid-loop then recovery, proving the step budget that 2A.2 raised for exactly this.

**Files:**
- Modify: `tests/personas/agent-turn-loop.test.ts` (add one `it(...)` after the per-persona loop)

- [ ] **Step 1: Add the recovery test**

In `tests/personas/agent-turn-loop.test.ts`, after the `for (const persona of ...)` loop (still inside the `describe`), add:

```ts
  it('recovers from a mid-loop tool error within MAX_AGENT_STEPS and writes correct facts', async () => {
    const { buildAgentTurn } = await import('@/lib/ai/chat/agent-turn');
    const persona = loadAllPersonas().find((p) => p.id === 'priya-strong')!;
    const repo = makeRepository(handle.db, handle.schemaName);
    const { caseId, threadId } = await repo.createCase({
      userId: seeded.userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
      targetConsulate: 'bengaluru',
    });

    const goodBundle = deriveUpdateCalls(persona)[0]!;
    const script: ScriptStep[] = [
      // 1) bad path → real update_case tool throws (applyUpdate validates eagerly); loop survives.
      { kind: 'tool', toolCallId: 'c1', toolName: 'update_case', input: { source: 'user_stated', confidence: 1, updates: { 'employment.bogusField': 'x' } } },
      // 2) recover by reading the case.
      { kind: 'tool', toolCallId: 'c2', toolName: 'read_case', input: {} },
      // 3) correct write.
      { kind: 'tool', toolCallId: 'c3', toolName: 'update_case', input: goodBundle },
      // 4) eligibility, then reply.
      { kind: 'tool', toolCallId: 'c4', toolName: 'check_eligibility', input: {} },
      { kind: 'text', text: 'Recovered and recorded.' },
    ];

    const result = await buildAgentTurn({
      model: makeScriptedModel(script),
      repo,
      caseId,
      threadId,
      userId: seeded.userId,
      userMessageId: TURN_ID,
      caseFacts: {},
      modelMessages: [{ role: 'user', content: 'my situation' }] as never,
    });
    for await (const _ of result.textStream) {
      void _;
    }

    // Despite the mid-loop error, the correct facts landed (5 steps < MAX_AGENT_STEPS = 8).
    const loaded = await repo.loadCase(caseId);
    const expectedMap = toValueMap(flattenLeafValues(toCaseFacts(persona)));
    expect(toValueMap(flattenLeafValues(loaded.caseFacts))).toEqual(expectedMap);

    // The good update_case fired → emit happened.
    expect(inngestSendSpy).toHaveBeenCalled();
  });
```

> Note on the bad path: `employment.bogusField` is not a valid leaf, so `applyUpdate` rejects the whole call (it never reaches a real leaf). This deliberately throws inside the real tool's `execute`; the probe confirmed `streamText` survives a throwing tool and loops on.

- [ ] **Step 2: Run the recovery test**

Run: `pnpm exec vitest run --no-file-parallelism tests/personas/agent-turn-loop.test.ts -t recovers`
Expected: PASS. (If the loop did NOT survive the throw, the stream would reject — that would be a real finding; investigate before proceeding.)

- [ ] **Step 3: Commit**

```bash
git add tests/personas/agent-turn-loop.test.ts
git commit -m "test: L2b proves mid-loop tool-error recovery within MAX_AGENT_STEPS"
```

---

## Task 6: Wire `test:personas`, update CLAUDE.md, full-suite gate

**Files:**
- Modify: `package.json` (the `test:personas` script)
- Modify: `CLAUDE.md` (Tests/vitest + AI SDK gotchas)

- [ ] **Step 1: Add the new files to `test:personas`**

In `package.json`, the current script is:

```json
"test:personas": "vitest run --no-file-parallelism tests/personas tests/journey/compute-personas.test.ts tests/_personas",
```

It already globs `tests/personas` and `tests/_personas`, so `agent-turn-loop.test.ts` and `mock-stream.test.ts` are picked up automatically. Verify the glob actually includes them:

Run: `pnpm exec vitest run --no-file-parallelism tests/personas tests/journey/compute-personas.test.ts tests/_personas 2>&1 | grep -E "agent-turn-loop|mock-stream"`
Expected: both files appear in the run output. If they do, no `package.json` edit is needed; if the glob misses them, add explicit paths.

- [ ] **Step 2: Run `test:personas`**

Run: `pnpm test:personas`
Expected: PASS — the deterministic core (now incl. L2b + mock-stream) all green.

- [ ] **Step 3: Fix the stale CLAUDE.md note + add the onFinish gotcha**

In `CLAUDE.md`, under "### Tests / vitest" (or the Pinned "Agent loop / model seam" note that says `MockLanguageModelV2` is NOT installed), replace the stale claim. Find:

```
- **`MockLanguageModelV2` is NOT installed** — `ai/test` needs `msw` (forbidden new dep). Seam tests use the dependency-free pattern from `tests/api/chat.test.ts` (`vi.mock('ai')` capturing `streamText` args + `onFinish`). The fixture-*replay* dep question is resolved in 2C, not 2A.1.
```

Replace with:

```
- **`ai@6` ships `MockLanguageModelV3` in `ai/test` with NO `msw` dependency** (the old `ai@5` `msw` requirement is gone — verified 2026-06-02). `tests/_personas/mock-stream.ts` `makeScriptedModel(steps)` wraps it to drive the REAL `buildAgentTurn` loop per-step (L2b). It assigns to `LanguageModel` with no cast. The `vi.mock('ai')` seam (capturing `streamText` args + `onFinish`) is still used by L2a/`chat.test.ts` where no real loop is wanted.
```

Then, under "### AI SDK v5/v6", add a new bullet:

```
- **`onFinish`'s top-level `toolCalls`/`toolResults` are the LAST STEP ONLY** (`OnFinishEvent = StepResult & { steps }`, `index.d.ts`). A turn that calls a tool then replies with text in a later step has an empty last step. `buildAgentTurn.onFinish` MUST aggregate `event.steps.flatMap(s => s.toolResults)` — reading top-level dropped tool parts from history AND skipped the `case.facts.updated` emit (fixed; surfaced by the L2b real-loop test `tests/personas/agent-turn-loop.test.ts`). Synthesized-event fixtures (`synthesizeTurnEvent`, `chat.test.ts`) MUST populate `event.steps`, not just top-level fields.
```

- [ ] **Step 4: Commit the docs**

```bash
git add CLAUDE.md package.json
git commit -m "docs: correct MockLanguageModelV3/msw note; add onFinish-reads-steps gotcha"
```

- [ ] **Step 5: Final gate — full suite serial + tsc + lint**

Run:
```bash
pnpm exec vitest run --no-file-parallelism
pnpm exec tsc --noEmit
pnpm lint
```
Expected: full suite green (the 27 deterministic-core tests + the new L2b/mock-stream + everything else); `tsc` clean; `lint` clean. If `EMAXPOOLSREACHED` appears on the vitest run, it's the documented pooler-saturation infra issue — re-run `pnpm exec vitest run --no-file-parallelism` once more (it's already serial).

---

## Task 7: Finish the branch

- [ ] **Step 1: Confirm clean tree + review the diff**

```bash
git status
git log --oneline main..HEAD
git diff --stat main..HEAD
```
Expected: commits for mock-stream helper, red L2b test, fixture realignment, the onFinish fix, recovery test, docs — plus the carried-forward CLAUDE.md trim + spec.

- [ ] **Step 2: Hand off for PR**

Use the `superpowers:finishing-a-development-branch` skill to decide merge/PR. The PR description should note: this slice contains a **real `src/` bug fix** (not test-only) — the `onFinish` step-aggregation fix — surfaced by the new L2b layer, plus the deterministic L2b coverage and a recovery-path test. Persona suite (`pnpm test:personas`) is the gate.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- L2b real-loop replay → Tasks 1, 2, 5. ✓
- Real DB-backed fidelity → Task 2 (reuses `createTestSchema`/`seedOrgAndUser`/`makeRepository`). ✓
- Happy-path + recovery sequence → Tasks 2, 5. ✓
- The evidenced onFinish bug + TDD fix → Tasks 2 (red), 4 (fix). ✓
- Fixture realignment (`harness.ts`, `chat.test.ts`) → Task 3. ✓
- `MockLanguageModelV3`/no-msw + the `event.steps` gotcha in CLAUDE.md → Task 6. ✓
- `test:personas` wiring → Task 6. ✓
- Scope guard (bug doesn't reproduce → no `src/` change) → Task 2 Step 2 note + Task 4 Step 1. ✓
- Out-of-scope branch (no emit) → Task 2. ✓
- Deferred L3 + CI explicitly out → not in any task (correct). ✓

**Placeholder scan:** No TBD/TODO/"add error handling"/"similar to Task N". All code blocks complete. ✓

**Type consistency:** `ScriptStep`, `makeScriptedModel`, `SynthTurnEvent`/`SynthStep`, `allToolCalls`/`allToolResults`, `deriveUpdateCalls(p)[0]`, repo signatures (`createCase` → `{caseId, threadId}`, `applyUpdate`, `loadCase`), `toCaseFacts`/`flattenLeafValues` — all match the source files read during planning. The recovery bad-path uses an invalid leaf (`employment.bogusField`) consistent with `applyUpdate`'s eager `validateLeafPath` rejection. ✓
