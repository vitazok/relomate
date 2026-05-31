import { describe, it, expect, vi } from 'vitest';
import { makeUpdateCaseTool } from '@/lib/ai/tools/update_case';

const defaults = {
  defaultCaseId: 'c0000000-0000-4000-8000-000000000000',
  defaultSourceTurnId: 't0000000-0000-4000-8000-000000000000',
};

describe('update_case tool adapter', () => {
  it('exposes a Vercel AI SDK tool with description and zod input', () => {
    const tool = makeUpdateCaseTool({ applyUpdate: vi.fn() }, defaults);
    expect(typeof tool.description).toBe('string');
    expect((tool.description ?? '').length).toBeGreaterThan(40);
    expect(tool.inputSchema).toBeDefined();
  });

  it('calls repository.applyUpdate with the route-injected caseId + sourceTurnId', async () => {
    const applyUpdate = vi.fn().mockResolvedValue({
      caseId: defaults.defaultCaseId,
      updatedPaths: ['employment.annualGrossSalaryEur'],
      contradictions: [],
    });
    const tool = makeUpdateCaseTool({ applyUpdate }, defaults);
    if (!tool.execute) throw new Error('expected execute on tool');

    const out = await tool.execute(
      {
        source: 'user_stated',
        confidence: 0.9,
        updates: { 'employment.annualGrossSalaryEur': 48500 },
      },
      {} as never,
    );

    expect(applyUpdate).toHaveBeenCalledOnce();
    const call = applyUpdate.mock.calls[0]![0];
    expect(call.caseId).toBe(defaults.defaultCaseId);
    expect(call.sourceTurnId).toBe(defaults.defaultSourceTurnId);
    expect(out).toEqual({
      type: 'update_case_result',
      version: 1,
      data: {
        caseId: defaults.defaultCaseId,
        updatedPaths: ['employment.annualGrossSalaryEur'],
        contradictions: [],
      },
    });
  });

  it('LLM-facing schema does not accept caseId or sourceTurnId', () => {
    const applyUpdate = vi.fn();
    const tool = makeUpdateCaseTool({ applyUpdate }, defaults);
    const schema = tool.inputSchema as { safeParse: (v: unknown) => { success: boolean; data?: unknown } };
    const result = schema.safeParse({
      caseId: 'c0000000-0000-4000-8000-000000000000',
      source: 'user_stated',
      confidence: 0.9,
      updates: { 'employment.annualGrossSalaryEur': 48500 },
    });
    // Zod's `.omit()` produces a schema that strips unknown keys by default;
    // assert that the parsed result doesn't carry caseId through.
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).caseId).toBeUndefined();
  });
});
