import { describe, it, expect } from 'vitest';
import { summarizeFigures } from '@/lib/rules/eligibility-figures';
import type { CaseFacts } from '@/lib/case/schema';

const TODAY = new Date('2026-05-27T00:00:00.000Z');
const ISO = TODAY.toISOString();
const PROV = { source: 'user_stated' as const, sourceTurnId: null, confidence: 1, updatedAt: ISO };
const f = <T>(value: T) => ({ value, ...PROV });

describe('summarizeFigures', () => {
  it('returns active 2026 thresholds with legal basis', () => {
    const fig = summarizeFigures({} as CaseFacts, TODAY);
    expect(fig.standard.annualGrossEur).toBe(50700);
    expect(fig.reduced.annualGrossEur).toBeCloseTo(45934.2, 1);
    expect(fig.standard.legalBasis).toMatch(/18g/);
    expect(fig.reduced.legalBasis).toMatch(/18g/);
  });

  it('meets is null when salary absent', () => {
    const fig = summarizeFigures({} as CaseFacts, TODAY);
    expect(fig.salaryOnFile).toBeNull();
    expect(fig.standard.meets).toBeNull();
    expect(fig.reduced.meets).toBeNull();
  });

  it('computes meets vs salary on file', () => {
    const facts: CaseFacts = { employment: { annualGrossSalaryEur: f(48500) } };
    const fig = summarizeFigures(facts, TODAY);
    expect(fig.salaryOnFile).toBe(48500);
    expect(fig.standard.meets).toBe(false); // 48500 < 50700
    expect(fig.reduced.meets).toBe(true); // 48500 >= 45934.20
  });
});
