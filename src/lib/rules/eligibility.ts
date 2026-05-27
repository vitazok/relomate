import { type CaseFacts, type EligibilityVerdict } from '@/lib/case/schema';
import { type Profile } from '@/lib/profile/schema';
import { getBlueCardRules } from '@/lib/rules/loader';
import type { BlueCardRules } from './types';

const RULES_VERSION = '1';

function iscoMatchesAny(code: string | undefined, groups: string[]): boolean {
  if (!code) return false;
  return groups.some((g) => code.startsWith(g));
}

function activeThreshold(blueCard: BlueCardRules, today: Date) {
  const iso = today.toISOString().slice(0, 10);
  const match = blueCard.thresholds.find(
    (t) => t.effectiveFrom <= iso && iso <= t.effectiveUntil,
  );
  return match ?? blueCard.thresholds[0];
}

export function evaluateEligibility(
  caseFacts: CaseFacts,
  profile: Profile,
  today: Date,
): EligibilityVerdict {
  const rules = getBlueCardRules();
  const computedAt = today.toISOString();

  // Out of scope check
  const intended = caseFacts.target?.intendedVisa?.value;
  if (intended && intended !== 'blue_card') {
    return {
      outOfScope: true,
      qualifies: null,
      blockers: [],
      warnings: [],
      routes: [],
      computedAt,
      rulesVersion: RULES_VERSION,
    };
  }

  const blockers: string[] = [];
  const warnings: string[] = [];
  const routes: EligibilityVerdict['routes'] = [];

  const anabin = caseFacts.education?.anabinStatus?.value;
  const hasEducation = Boolean(caseFacts.education?.highestDegree?.value);

  // Anabin gates
  if (anabin === 'unknown') {
    blockers.push('anabin_status_unknown');
    warnings.push('zab_statement_required');
    warnings.push('consulate_clarification_recommended');
    return {
      outOfScope: false,
      qualifies: false,
      blockers,
      warnings,
      routes: [],
      computedAt,
      rulesVersion: RULES_VERSION,
    };
  }
  if (anabin === 'H-') {
    blockers.push('degree_not_recognized');
    return {
      outOfScope: false,
      qualifies: false,
      blockers,
      warnings,
      routes: [],
      computedAt,
      rulesVersion: RULES_VERSION,
    };
  }

  const recognized = anabin === 'H+' || anabin === 'H+/-';

  // Extract case facts
  const threshold = activeThreshold(rules, today);
  if (!threshold) {
    // reason: no active threshold found; should never happen with valid YAML
    blockers.push('no_active_threshold');
    return {
      outOfScope: false,
      qualifies: false,
      blockers,
      warnings,
      routes: [],
      computedAt,
      rulesVersion: RULES_VERSION,
    };
  }
  const standard = threshold.standard.annualGrossEur;
  const reduced = threshold.reduced.annualGrossEur;
  const salary = caseFacts.employment?.annualGrossSalaryEur?.value;
  const isco = caseFacts.employment?.iscoCode?.value ?? undefined;
  const completionYear = caseFacts.education?.completionYear?.value;
  const priorExperienceYears = caseFacts.employment?.priorExperienceYears?.value;

  // Standard route
  if (salary != null && salary >= standard && recognized) {
    routes.push('standard');
  }

  // Shortage occupation
  const shortageGroups = rules.shortageOccupationsIscoGroups.map((g) => g.code);
  if (
    salary != null &&
    salary >= reduced &&
    iscoMatchesAny(isco, shortageGroups) &&
    recognized
  ) {
    routes.push('shortage_occupation');
  }

  // Recent graduate
  const recentGraduateYears = rules.recentGraduateRule.maxYearsSinceDegree;
  if (
    salary != null &&
    salary >= reduced &&
    recognized &&
    completionYear != null &&
    today.getFullYear() - completionYear <= recentGraduateYears
  ) {
    routes.push('recent_graduate');
  }

  // IT no-degree (§18g(2))
  const itGroups = rules.itNoDegreeRule.iscoGroups;
  const minExp = rules.itNoDegreeRule.minYearsExperience;
  if (
    !hasEducation &&
    salary != null &&
    salary >= standard &&
    iscoMatchesAny(isco, itGroups) &&
    priorExperienceYears != null &&
    priorExperienceYears >= minExp
  ) {
    routes.push('it_no_degree');
    warnings.push('proof_of_experience_required');
  }

  const qualifies = routes.length > 0;
  if (!qualifies) blockers.push('no_route_qualifies');

  return {
    outOfScope: false,
    qualifies,
    blockers,
    warnings,
    routes,
    computedAt,
    rulesVersion: RULES_VERSION,
  };
}
