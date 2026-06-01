import { describe, it, expect, beforeEach, vi } from 'vitest';
import type * as AiModule from 'ai';
import type { Repository } from '@/lib/case/repository';
import { loadAllPersonas, toCaseFacts, synthesizeTurnEvent } from '../_personas/harness';

// --- Mocks (hoisted) ---
const appendChatTurnSpy = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/ai/chat/persistence', () => ({
  appendChatTurn: appendChatTurnSpy,
}));

const inngestSendSpy = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: inngestSendSpy },
}));

// Capture the onFinish callback streamText receives; return a no-op stream response.
let capturedOnFinish: ((event: unknown) => Promise<void>) | undefined;
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof AiModule>('ai');
  return {
    ...actual,
    streamText: vi.fn((opts: { onFinish?: (e: unknown) => Promise<void> }) => {
      capturedOnFinish = opts.onFinish;
      return { toUIMessageStreamResponse: () => new Response(null, { status: 200 }) };
    }),
  };
});

// Minimal Repository stub — tools never execute (streamText is mocked) and onFinish calls
// appendChatTurn/inngest (both mocked), not repo. It only needs to satisfy the type.
function stubRepo(): Repository {
  const notCalled = () => {
    throw new Error('repo method should not be called in the replay test');
  };
  // reason: the stub only needs to satisfy the Repository type — no method is reached at runtime
  // (streamText is mocked so tools never run; onFinish calls the mocked appendChatTurn/inngest).
  return {
    createCase: notCalled,
    loadCase: notCalled,
    applyUpdate: notCalled,
    appendActivity: notCalled,
  } as unknown as Repository;
}

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const THREAD_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const TURN_ID = '44444444-4444-4444-8444-444444444444';

describe('persona agent-turn onFinish replay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnFinish = undefined;
  });

  for (const persona of loadAllPersonas()) {
    it(`${persona.id}: onFinish persists the turn and emits inngest iff update_case fired`, async () => {
      const { buildAgentTurn } = await import('@/lib/ai/chat/agent-turn');

      await buildAgentTurn({
        model: { dummy: true } as never,
        repo: stubRepo(),
        caseId: CASE_ID,
        threadId: THREAD_ID,
        userId: USER_ID,
        userMessageId: TURN_ID,
        caseFacts: toCaseFacts(persona),
        modelMessages: [{ role: 'user', content: 'here is my situation' }] as never,
      });

      if (!capturedOnFinish) throw new Error('streamText onFinish was not captured');
      const event = synthesizeTurnEvent(persona);
      await capturedOnFinish(event);

      // appendChatTurn must receive the turn identity + the synthesized tool calls/results,
      // not just be called — this guards onFinish's mapping into the persistence input.
      expect(appendChatTurnSpy).toHaveBeenCalledOnce();
      const persisted = appendChatTurnSpy.mock.calls[0]![0] as {
        threadId: string;
        userMessageId: string;
        toolCalls: Array<{ toolName: string }>;
        toolResults: Array<{ toolName: string }>;
      };
      expect(persisted.threadId).toBe(THREAD_ID);
      expect(persisted.userMessageId).toBe(TURN_ID);
      expect(persisted.toolCalls.map((c) => c.toolName)).toEqual(
        event.toolCalls.map((c) => c.toolName),
      );
      expect(persisted.toolResults.map((r) => r.toolName)).toEqual(
        event.toolResults.map((r) => r.toolName),
      );

      if (persona.expected.outOfScope) {
        expect(inngestSendSpy).not.toHaveBeenCalled();
      } else {
        expect(inngestSendSpy).toHaveBeenCalledOnce();
        const sent = inngestSendSpy.mock.calls[0]![0] as {
          name: string;
          data: { caseId: string; paths: string[]; sourceTurnId: string };
        };
        expect(sent.name).toBe('case.facts.updated');
        expect(sent.data.caseId).toBe(CASE_ID);
        expect(sent.data.sourceTurnId).toBe(TURN_ID);
        // Couples to a path all 3 current in-scope personas carry. If a future in-scope persona
        // omits employment salary, weaken to `expect(sent.data.paths.length).toBeGreaterThan(0)`.
        expect(sent.data.paths).toContain('employment.annualGrossSalaryEur');
      }
    });
  }
});
