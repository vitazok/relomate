import type { CaseFacts } from '@/lib/case/schema';

export interface ReadinessResult {
  ready: boolean;
  missing: string[];
}

export function assessReadiness(facts: CaseFacts): ReadinessResult {
  const missing: string[] = [];

  const salary = facts.employment?.annualGrossSalaryEur?.value;
  if (salary == null) missing.push('employment.annualGrossSalaryEur');

  const hasAnabin = facts.education?.anabinStatus?.value != null;
  const hasDegree = facts.education?.highestDegree?.value != null;
  const hasItShape =
    !hasDegree &&
    facts.employment?.iscoCode?.value != null &&
    facts.employment?.priorExperienceYears?.value != null;

  if (!hasAnabin && !hasItShape) {
    // Degree route needs a recognition signal; IT-no-degree route needs isco + experience.
    missing.push('education.anabinStatus');
  }

  return { ready: missing.length === 0, missing };
}
