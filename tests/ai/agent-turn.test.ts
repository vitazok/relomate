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

import { buildAgentTurn, MAX_AGENT_STEPS } from '@/lib/ai/chat/agent-turn';

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

  it('allows enough steps for a multi-tool recovery turn (>= 8)', () => {
    // A turn can fan out update_case + lookup_anabin, recover via read_case, run
    // check_eligibility, then reply. The old budget of 5 dead-ended such turns.
    expect(MAX_AGENT_STEPS).toBeGreaterThanOrEqual(8);
  });

  it('passes the injected model straight through to streamText', async () => {
    await buildAgentTurn(baseParams());
    expect(captured.model).toBe(SENTINEL_MODEL);
  });

  it('registers all seven tools', async () => {
    await buildAgentTurn(baseParams());
    expect(Object.keys(captured.tools ?? {}).sort()).toEqual(
      ['add_case_note', 'check_eligibility', 'lookup_anabin', 'out_of_scope', 'read_case', 'request_document_upload', 'update_case'].sort(),
    );
  });

  it('attaches exactly one cache_control breakpoint across the tool set', async () => {
    // Verifies breakpoint COUNT only. The position invariant (breakpoint must sit on the
    // last-registered tool, lookup_anabin) relies on the comments in agent-turn.ts + lookup_anabin.ts.
    await buildAgentTurn(baseParams());
    const tools = (captured.tools ?? {}) as Record<string, { providerOptions?: { anthropic?: { cacheControl?: unknown } } }>;
    const withBreakpoint = Object.values(tools).filter(
      (t) => t.providerOptions?.anthropic?.cacheControl !== undefined,
    );
    expect(withBreakpoint).toHaveLength(1);
  });

  it('injects the case context into the system string', async () => {
    await buildAgentTurn(baseParams());
    expect(captured.system).toContain('Current case state');
  });

  it('passes the userId through to appendChatTurn (#6)', async () => {
    await buildAgentTurn(baseParams());
    await captured.onFinish!({
      text: 'ok',
      content: [{ type: 'text', text: 'ok' }],
      toolCalls: [],
      toolResults: [],
      steps: [{ text: 'ok', content: [{ type: 'text', text: 'ok' }], toolCalls: [], toolResults: [] }],
    });
    expect(appendChatTurnSpy).toHaveBeenCalledOnce();
    expect(appendChatTurnSpy.mock.calls[0]![0].userId).toBe('u0000000-0000-4000-8000-000000000000');
  });

  it('persists a tool-error part from step.content as a tool result carrying error (#7)', async () => {
    await buildAgentTurn(baseParams());
    // An update_case call whose execute() threw: it appears in step.toolCalls and as a
    // `tool-error` part in step.content, but NOT in step.toolResults.
    await captured.onFinish!({
      text: 'I could not record that.',
      content: [{ type: 'text', text: 'I could not record that.' }],
      toolCalls: [],
      toolResults: [],
      steps: [
        {
          text: '',
          content: [
            { type: 'tool-call', toolCallId: 'e1', toolName: 'update_case', input: { updates: { 'education.level': 'x' } } },
            { type: 'tool-error', toolCallId: 'e1', toolName: 'update_case', input: {}, error: new Error('unknown path: education.level') },
          ],
          toolCalls: [{ toolCallId: 'e1', toolName: 'update_case', input: { updates: { 'education.level': 'x' } } }],
          toolResults: [],
        },
        { text: 'I could not record that.', content: [{ type: 'text', text: 'I could not record that.' }], toolCalls: [], toolResults: [] },
      ],
    });
    expect(appendChatTurnSpy).toHaveBeenCalledOnce();
    const arg = appendChatTurnSpy.mock.calls[0]![0];
    const errResult = arg.toolResults.find((r: { toolCallId: string }) => r.toolCallId === 'e1');
    expect(errResult).toBeDefined();
    expect(errResult.error).toMatch(/unknown path: education\.level/);
    // a failed update_case must NOT emit case.facts.updated
    expect(inngestSendSpy).not.toHaveBeenCalled();
  });

  it('persists and emits inngest in onFinish when update_case fired', async () => {
    await buildAgentTurn(baseParams());
    // onFinish reads event.steps[] (the SDK puts per-step tool results there; top-level is
    // last-step only). Carry the update_case call/result in a step, then a terminal text step.
    const updateResult = {
      toolCallId: 'x',
      toolName: 'update_case',
      output: { type: 'update_case_result', version: 1, data: { caseId: 'c', updatedPaths: ['employment.jobTitle'], contradictions: [] } },
    };
    await captured.onFinish!({
      text: 'ok',
      content: [{ type: 'text', text: 'ok' }],
      toolCalls: [{ toolCallId: 'x', toolName: 'update_case', input: {} }],
      toolResults: [updateResult],
      steps: [
        { text: '', content: [], toolCalls: [{ toolCallId: 'x', toolName: 'update_case', input: {} }], toolResults: [updateResult] },
        { text: 'ok', content: [{ type: 'text', text: 'ok' }], toolCalls: [], toolResults: [] },
      ],
    });
    expect(appendChatTurnSpy).toHaveBeenCalledOnce();
    expect(inngestSendSpy).toHaveBeenCalledOnce();
    expect(inngestSendSpy.mock.calls[0]![0].data.paths).toEqual(['employment.jobTitle']);
  });
});
