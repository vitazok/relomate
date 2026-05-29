import { describe, it, expect } from 'vitest';
import { buildAgentContext } from '@/lib/ai/chat/context-builder';
import type { CaseFacts } from '@/lib/case/schema';

const facts: CaseFacts = {
  employment: {
    annualGrossSalaryEur: {
      value: 55000, source: 'user_stated', sourceTurnId: null,
      confidence: 0.9, updatedAt: '2026-05-29T00:00:00.000Z',
    },
  },
};

describe('buildAgentContext', () => {
  it('returns a systemContext string containing the full case facts JSON', async () => {
    const ctx = await buildAgentContext({ caseId: 'case-1', caseFacts: facts });
    expect(typeof ctx.systemContext).toBe('string');
    expect(ctx.systemContext).toContain('55000');
    expect(ctx.systemContext).toContain('employment');
  });

  it('includes a section-presence summary line', async () => {
    const ctx = await buildAgentContext({ caseId: 'case-1', caseFacts: facts });
    // employment has data; education/family/target do not.
    expect(ctx.systemContext).toMatch(/employment: known/i);
    expect(ctx.systemContext).toMatch(/education: not yet/i);
  });

  it('handles empty facts without throwing', async () => {
    const ctx = await buildAgentContext({ caseId: 'case-1', caseFacts: {} });
    expect(ctx.systemContext).toMatch(/education: not yet/i);
  });
});
