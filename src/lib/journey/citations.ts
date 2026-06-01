import { getBlueCardRules, getConsulate } from '@/lib/rules/loader';
import type { RequirementCitation } from './types';

/**
 * Maps a manifest `cite` pointer to a RequirementCitation, resolving the
 * legalBasis / sourceUrl / lastVerified from the authoritative rules YAML.
 * Citation DATA lives in the rules files (rule 7 single-source-of-truth);
 * the manifest only carries the pointer. Unknown pointer throws.
 */
export function resolveCitation(cite: string | null): RequirementCitation | null {
  if (cite === null) return null;

  switch (cite) {
    case 'blue-card-threshold': {
      const bc = getBlueCardRules();
      const t = bc.thresholds[0]!;
      return {
        explainer: `Standard Blue Card salary threshold: €${t.standard.annualGrossEur.toLocaleString('en-US')}/yr.`,
        legalBasis: t.standard.legalBasis,
        sourceUrl: bc.sources[0]!,
        lastVerified: bc.lastVerified,
      };
    }
    case 'blue-card-general': {
      const bc = getBlueCardRules();
      return {
        explainer: `Employment contract must run at least ${bc.generalRequirements.minContractDurationMonths} months and match your qualification.`,
        legalBasis: null,
        sourceUrl: bc.sources[0]!,
        lastVerified: bc.lastVerified,
      };
    }
    case 'blue-card-degree': {
      const bc = getBlueCardRules();
      return {
        explainer: 'A recognized higher-education qualification is the standard Blue Card route.',
        legalBasis: bc.thresholds[0]!.standard.legalBasis,
        sourceUrl: bc.sources[0]!,
        lastVerified: bc.lastVerified,
      };
    }
    case 'shortage-occupations': {
      const bc = getBlueCardRules();
      return {
        explainer: 'Shortage occupations (e.g. ICT professionals, ISCO-08 25) qualify at the reduced salary threshold.',
        legalBasis: bc.thresholds[0]!.reduced.legalBasis,
        sourceUrl: bc.sources[0]!,
        lastVerified: bc.lastVerified,
      };
    }
    case 'it-no-degree': {
      const bc = getBlueCardRules();
      return {
        explainer: `IT specialists without a degree qualify with at least ${bc.itNoDegreeRule.minYearsExperience} years of relevant experience.`,
        legalBasis: bc.itNoDegreeRule.legalBasis,
        sourceUrl: bc.sources[0]!,
        lastVerified: bc.lastVerified,
      };
    }
    case 'anabin': {
      const bc = getBlueCardRules();
      return {
        explainer: 'Degree recognition is checked against the Anabin database; unrecognized degrees need a ZAB Statement of Comparability.',
        legalBasis: null,
        sourceUrl: 'https://anabin.kmk.org',
        lastVerified: bc.lastVerified,
      };
    }
    case 'consulate': {
      const c = getConsulate('bengaluru');
      return {
        explainer: `Applications for Karnataka/Kerala residents are filed at ${c.officialName}.`,
        legalBasis: null,
        sourceUrl: c.url,
        lastVerified: getBlueCardRules().lastVerified,
      };
    }
    default:
      throw new Error(`unknown citation pointer: ${cite}`);
  }
}
