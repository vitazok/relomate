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
      await capturedOnFinish(synthesizeTurnEvent(persona));

      expect(appendChatTurnSpy).toHaveBeenCalledOnce();

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
        expect(sent.data.paths).toContain('employment.annualGrossSalaryEur');
      }
    });
  }
});
