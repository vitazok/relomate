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
        targetConsulate: persona.caseFacts.target?.consulate ?? 'bengaluru',
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
        // reason: a minimal valid ModelMessage; streamText is real but the scripted model ignores
        // input, so the precise ModelMessage[] shape is irrelevant here.
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
        toolResults: Array<{ toolName: string; output?: { data?: { status?: string } } }>;
      };
      expect(persisted.threadId).toBe(threadId);
      expect(persisted.userMessageId).toBe(TURN_ID);

      if (persona.expected.outOfScope) {
        expect(persisted.toolCalls.map((c) => c.toolName)).toContain('out_of_scope');
        expect(inngestSendSpy).not.toHaveBeenCalled();
        const loaded = await repo.loadCase(caseId);
        expect(flattenLeafValues(loaded.caseFacts).length).toBe(0);
        return;
      }

      // In-scope: the REAL update_case + check_eligibility tools ran across steps.
      expect(persisted.toolCalls.map((c) => c.toolName)).toEqual(
        expect.arrayContaining(['update_case', 'check_eligibility']),
      );
      expect(persisted.toolResults.map((r) => r.toolName)).toEqual(
        expect.arrayContaining(['update_case', 'check_eligibility']),
      );

      // DB end-state: the real update_case tool persisted the derived facts.
      const loaded = await repo.loadCase(caseId);
      const expectedMap = toValueMap(flattenLeafValues(toCaseFacts(persona)));
      expect(toValueMap(flattenLeafValues(loaded.caseFacts))).toEqual(expectedMap);

      // check_eligibility ran on the WRITTEN facts → its result is in the persisted toolResults.
      const elig = persisted.toolResults.find((r) => r.toolName === 'check_eligibility');
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
      // reason: minimal valid ModelMessage; the scripted model ignores input (see above).
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
  }, 15_000);
});
