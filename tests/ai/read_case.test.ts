import { describe, it, expect, vi } from 'vitest';
import { makeReadCaseTool } from '@/lib/ai/tools/read_case';
import type { CaseFacts } from '@/lib/case/schema';

const defaults = { defaultCaseId: 'c0000000-0000-4000-8000-000000000000' };

const facts: CaseFacts = {
  employment: {
    annualGrossSalaryEur: {
      value: 55000, source: 'user_stated', sourceTurnId: null,
      confidence: 0.9, updatedAt: '2026-05-29T00:00:00.000Z',
    },
  },
};

function repoReturning(caseFacts: CaseFacts) {
  return { loadCase: vi.fn().mockResolvedValue({ caseFacts }) };
}

describe('read_case tool', () => {
  it('exposes a tool with description, zod input, and ephemeral cache', () => {
    const tool = makeReadCaseTool(repoReturning(facts), defaults);
    expect((tool.description ?? '').length).toBeGreaterThan(40);
    expect(tool.inputSchema).toBeDefined();
    expect(tool.providerOptions?.anthropic).toEqual({ cacheControl: { type: 'ephemeral' } });
  });

  it('returns the full facts when no selector is given', async () => {
    const tool = makeReadCaseTool(repoReturning(facts), defaults);
    const out = await tool.execute!({}, {} as never);
    expect(out).toEqual({
      type: 'read_case_result',
      version: 1,
      data: { kind: 'full', facts },
    });
  });

  it('returns a single section subtree when section is given', async () => {
    const tool = makeReadCaseTool(repoReturning(facts), defaults);
    const out = await tool.execute!({ section: 'employment' }, {} as never);
    expect(out).toEqual({
      type: 'read_case_result',
      version: 1,
      data: { kind: 'section', section: 'employment', value: facts.employment },
    });
  });

  it('returns path values (null for missing) when paths are given', async () => {
    const tool = makeReadCaseTool(repoReturning(facts), defaults);
    const out = await tool.execute!(
      { paths: ['employment.annualGrossSalaryEur', 'education.highestDegree'] },
      {} as never,
    );
    expect(out).toEqual({
      type: 'read_case_result',
      version: 1,
      data: {
        kind: 'paths',
        values: {
          'employment.annualGrossSalaryEur': facts.employment!.annualGrossSalaryEur,
          'education.highestDegree': null,
        },
      },
    });
  });
});
