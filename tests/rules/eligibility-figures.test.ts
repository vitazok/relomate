import { describe, it, expect } from 'vitest';
import { summarizeFigures } from '@/lib/rules/eligibility-figures';
import type { CaseFacts } from '@/lib/case/schema';

const TODAY = new Date('2026-05-27T00:00:00.000Z');
const ISO = TODAY.toISOString();
const PROV = { source: 'user_stated' as const, sourceTurnId: null, confidence: 1, updatedAt: ISO };
const f = <T>(value: T) => ({ value, ...PROV });

function figs(facts: CaseFacts, today: Date) {
  const fig = summarizeFigures(facts, today);
  if (fig == null) throw new Error('expected non-null figures');
  return fig;
}

describe('summarizeFigures', () => {
  it('returns active 2026 thresholds with legal basis', () => {
    const fig = figs({} as CaseFacts, TODAY);
    expect(fig.standard.annualGrossEur).toBe(50700);
    expect(fig.reduced.annualGrossEur).toBeCloseTo(45934.2, 2);
    expect(fig.standard.legalBasis).toMatch(/18g/);
    expect(fig.reduced.legalBasis).toMatch(/18g/);
  });

  it('meets is null when salary absent', () => {
    const fig = figs({} as CaseFacts, TODAY);
    expect(fig.salaryOnFile).toBeNull();
    expect(fig.standard.meets).toBeNull();
    expect(fig.reduced.meets).toBeNull();
  });

  it('computes meets vs salary on file', () => {
    const facts: CaseFacts = { employment: { annualGrossSalaryEur: f(48500) } };
    const fig = figs(facts, TODAY);
    expect(fig.salaryOnFile).toBe(48500);
    expect(fig.standard.meets).toBe(false); // 48500 < 50700
    expect(fig.reduced.meets).toBe(true); // 48500 >= 45934.20
  });

  it('meets true for both thresholds when salary clears the standard threshold', () => {
    const facts: CaseFacts = { employment: { annualGrossSalaryEur: f(60000) } };
    const fig = figs(facts, TODAY);
    expect(fig.salaryOnFile).toBe(60000);
    expect(fig.standard.meets).toBe(true); // 60000 >= 50700
    expect(fig.reduced.meets).toBe(true); // 60000 >= 45934.20
  });

  it('returns null when no threshold period covers today', () => {
    expect(summarizeFigures({} as CaseFacts, new Date('2099-06-01T00:00:00.000Z'))).toBeNull();
  });
});
