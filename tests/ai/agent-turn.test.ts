import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as AiModule from 'ai';

let captured: { model?: unknown; tools?: Record<string, unknown>; system?: string; onFinish?: (e: unknown) => Promise<void> } = {};
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof AiModule>('ai');
  return {
    ...actual,
    streamText: vi.fn((opts: { model: unknown; tools: Record<string, unknown>; system: string; onFinish?: (e: unknown) => Promise<void> }) => {
      captured = { model: opts.model, tools: opts.tools, system: opts.system, onFinish: opts.onFinish };
      return { toUIMessageStreamResponse: () => new Response(null, { status: 200 }) };
    }),
  };
});

const appendChatTurnSpy = vi.fn().mockResolvedValue({ assistantMessageId: 'a1' });
vi.mock('@/lib/ai/chat/persistence', () => ({
  appendChatTurn: (...args: unknown[]) => appendChatTurnSpy(...args),
}));

const inngestSendSpy = vi.fn().mockResolvedValue(undefined);
// reason: getter defers spy read to call time — buildAgentTurn is imported at top level,
// so a direct spy reference here evaluates the (synchronous) mock factory during the hoisted
// import phase, before the const initializes (TDZ). The `ai` mock above dodges this via async import.
vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: (...args: unknown[]) => inngestSendSpy(...args) },
}));

import { buildAgentTurn } from '@/lib/ai/chat/agent-turn';

const SENTINEL_MODEL = { __sentinel: true } as never;

function baseParams() {
  return {
    model: SENTINEL_MODEL,
    repo: { appendActivity: vi.fn(), loadCase: vi.fn(), applyUpdate: vi.fn() } as never,
    caseId: 'c0000000-0000-4000-8000-000000000000',
    threadId: 't0000000-0000-4000-8000-000000000000',
    userId: 'u0000000-0000-4000-8000-000000000000',
    userMessageId: 'm0000000-0000-4000-8000-000000000000',
    caseFacts: {},
    modelMessages: [{ role: 'user', content: 'hi' }] as never,
  };
}

describe('buildAgentTurn', () => {
  beforeEach(() => { captured = {}; vi.clearAllMocks(); });

  it('passes the injected model straight through to streamText', async () => {
    await buildAgentTurn(baseParams());
    expect(captured.model).toBe(SENTINEL_MODEL);
  });

  it('registers all four tools', async () => {
    await buildAgentTurn(baseParams());
    expect(Object.keys(captured.tools ?? {}).sort()).toEqual(
      ['add_case_note', 'out_of_scope', 'read_case', 'update_case'].sort(),
    );
  });

  it('injects the case context into the system string', async () => {
    await buildAgentTurn(baseParams());
    expect(captured.system).toContain('Current case state');
  });

  it('persists and emits inngest in onFinish when update_case fired', async () => {
    await buildAgentTurn(baseParams());
    await captured.onFinish!({
      text: 'ok',
      content: [{ type: 'text', text: 'ok' }],
      toolCalls: [{ toolCallId: 'x', toolName: 'update_case', input: {} }],
      toolResults: [{ toolCallId: 'x', toolName: 'update_case', output: { type: 'update_case_result', version: 1, data: { caseId: 'c', updatedPaths: ['employment.jobTitle'], contradictions: [] } } }],
    });
    expect(appendChatTurnSpy).toHaveBeenCalledOnce();
    expect(inngestSendSpy).toHaveBeenCalledOnce();
    expect(inngestSendSpy.mock.calls[0]![0].data.paths).toEqual(['employment.jobTitle']);
  });
});
