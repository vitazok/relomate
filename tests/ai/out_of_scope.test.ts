import { describe, it, expect, vi } from 'vitest';
import { makeOutOfScopeTool } from '@/lib/ai/tools/out_of_scope';

const defaults = {
  defaultCaseId: 'c0000000-0000-4000-8000-000000000000',
  defaultUserId: 'u0000000-0000-4000-8000-000000000000',
};

describe('out_of_scope tool', () => {
  it('exposes a tool with description, zod input, and ephemeral cache', () => {
    const tool = makeOutOfScopeTool({ appendActivity: vi.fn() }, defaults);
    expect((tool.description ?? '').length).toBeGreaterThan(40);
    expect(tool.inputSchema).toBeDefined();
    expect(tool.providerOptions?.anthropic).toEqual({ cacheControl: { type: 'ephemeral' } });
  });

  it('logs case.out_of_scope and returns the structured refusal', async () => {
    const appendActivity = vi.fn().mockResolvedValue(undefined);
    const tool = makeOutOfScopeTool({ appendActivity }, defaults);
    const out = await tool.execute!(
      { reason: 'Apartment search is outside this Blue Card assistant.', category: 'unsupported_request' },
      {} as never,
    );

    expect(appendActivity).toHaveBeenCalledOnce();
    expect(appendActivity.mock.calls[0]![0]).toEqual({
      caseId: defaults.defaultCaseId,
      userId: defaults.defaultUserId,
      kind: 'case.out_of_scope',
      payload: { reason: 'Apartment search is outside this Blue Card assistant.', category: 'unsupported_request' },
    });
    expect(out).toEqual({
      type: 'out_of_scope_result',
      version: 1,
      data: { reason: 'Apartment search is outside this Blue Card assistant.', category: 'unsupported_request' },
    });
  });

  it('defaults category to null when omitted', async () => {
    const appendActivity = vi.fn().mockResolvedValue(undefined);
    const tool = makeOutOfScopeTool({ appendActivity }, defaults);
    const out = await tool.execute!({ reason: 'Off topic.' }, {} as never);
    expect((out as { data: { category: unknown } }).data.category).toBeNull();
    expect((appendActivity.mock.calls[0]![0] as { payload: { category: unknown } }).payload.category).toBeNull();
  });
});
