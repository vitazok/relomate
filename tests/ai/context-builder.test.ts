import { describe, it, expect } from 'vitest';
import { buildAgentContext } from '@/lib/ai/chat/context-builder';
import type { CaseFacts } from '@/lib/case/schema';

describe('buildAgentContext (stub)', () => {
  it('returns caseFactsJson as JSON.stringify of the input', async () => {
    const caseFacts: CaseFacts = {} as CaseFacts;
    const ctx = await buildAgentContext({ caseId: 'c1', caseFacts });
    expect(ctx.caseFactsJson).toBe(JSON.stringify(caseFacts));
  });

  it('preserves nested values verbatim', async () => {
    const caseFacts = { employment: { employerName: { value: 'Acme', source: 'user_stated', confidence: 0.9, sourceTurnId: 't1', updatedAt: '2026-05-28' } } } as unknown as CaseFacts;
    const ctx = await buildAgentContext({ caseId: 'c1', caseFacts });
    expect(JSON.parse(ctx.caseFactsJson)).toEqual(caseFacts);
  });
});
