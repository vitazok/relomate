import type { CaseFacts } from '@/lib/case/schema';
import { getBlueCardRules } from '@/lib/rules/loader';
import { activeThreshold } from '@/lib/rules/eligibility';

export interface ThresholdFigure {
  annualGrossEur: number;
  legalBasis: string;
  meets: boolean | null;
}

export interface Figures {
  salaryOnFile: number | null;
  standard: ThresholdFigure;
  reduced: ThresholdFigure;
}

export function summarizeFigures(facts: CaseFacts, today: Date): Figures {
  const rules = getBlueCardRules();
  const threshold = activeThreshold(rules, today);
  if (!threshold) {
    // reason: BlueCardRules.thresholds is .min(1), so activeThreshold's `?? thresholds[0]`
    // is always defined at runtime; this guard satisfies noUncheckedIndexedAccess.
    throw new Error('no active Blue Card threshold configured');
  }
  const salary = facts.employment?.annualGrossSalaryEur?.value ?? null;

  const meets = (amount: number): boolean | null =>
    salary == null ? null : salary >= amount;

  return {
    salaryOnFile: salary,
    standard: {
      annualGrossEur: threshold.standard.annualGrossEur,
      legalBasis: threshold.standard.legalBasis,
      meets: meets(threshold.standard.annualGrossEur),
    },
    reduced: {
      annualGrossEur: threshold.reduced.annualGrossEur,
      legalBasis: threshold.reduced.legalBasis,
      meets: meets(threshold.reduced.annualGrossEur),
    },
  };
}
