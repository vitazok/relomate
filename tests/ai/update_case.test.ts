import { describe, it, expect, vi } from 'vitest';
import { makeUpdateCaseTool } from '@/lib/ai/tools/update_case';

describe('update_case tool adapter', () => {
  it('exposes a Vercel AI SDK tool with description and zod input', () => {
    const tool = makeUpdateCaseTool({ applyUpdate: vi.fn() });
    expect(typeof tool.description).toBe('string');
    expect((tool.description ?? '').length).toBeGreaterThan(40);
    expect(tool.inputSchema).toBeDefined();
  });

  it('calls repository.applyUpdate with the parsed input and wraps the result', async () => {
    const applyUpdate = vi.fn().mockResolvedValue({
      caseId: 'c0000000-0000-4000-8000-000000000000',
      updatedPaths: ['employment.annualGrossSalaryEur'],
      contradictions: [],
    });
    const tool = makeUpdateCaseTool({ applyUpdate });
    if (!tool.execute) throw new Error('expected execute on tool');

    const out = await tool.execute(
      {
        caseId: 'c0000000-0000-4000-8000-000000000000',
        source: 'user_stated',
        sourceTurnId: 't0000000-0000-4000-8000-000000000000',
        confidence: 0.9,
        updates: { 'employment.annualGrossSalaryEur': 48500 },
      },
      {} as never,
    );

    expect(applyUpdate).toHaveBeenCalledOnce();
    expect(out).toEqual({
      type: 'update_case_result',
      version: 1,
      data: {
        caseId: 'c0000000-0000-4000-8000-000000000000',
        updatedPaths: ['employment.annualGrossSalaryEur'],
        contradictions: [],
      },
    });
  });

  it('rejects invalid input via the Zod schema before calling the repository', () => {
    const applyUpdate = vi.fn();
    const tool = makeUpdateCaseTool({ applyUpdate });
    const inputSchema = tool.inputSchema as { safeParse: (v: unknown) => { success: boolean } };
    const result = inputSchema.safeParse({
      caseId: 'not-a-uuid',
      source: 'user_stated',
      sourceTurnId: null,
      confidence: 0.9,
      updates: {},
    });
    expect(result.success).toBe(false);
    expect(applyUpdate).not.toHaveBeenCalled();
  });
});
