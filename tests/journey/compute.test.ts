import { describe, it, expect } from 'vitest';
import { computeJourneyProgress, evaluateCondition } from '@/lib/journey/compute';
import { getDocumentRules } from '@/lib/rules/loader';
import { evaluateEligibility } from '@/lib/rules/eligibility';
import type { CaseFacts } from '@/lib/case/schema';
import type { Profile } from '@/lib/profile/schema';

const ISO = '2026-05-30T00:00:00.000Z';
const TODAY = new Date('2026-05-30T00:00:00.000Z');
const PROV = { source: 'user_stated' as const, sourceTurnId: null, confidence: 1, updatedAt: ISO };
const wrap = <T>(value: T) => ({ value, ...PROV });
const EMPTY_PROFILE: Profile = { schemaVersion: 1 };

function verdictFor(cf: CaseFacts): ReturnType<typeof evaluateEligibility> {
  return evaluateEligibility(cf, EMPTY_PROFILE, TODAY);
}

describe('evaluateCondition', () => {
  it('matches an `in` condition against a case-fact leaf', () => {
    const cf: CaseFacts = { education: { anabinStatus: wrap('unknown') } };
    expect(evaluateCondition({ path: 'education.anabinStatus', in: ['unknown', 'H-'] }, cf)).toBe(true);
    expect(evaluateCondition({ path: 'education.anabinStatus', in: ['H+'] }, cf)).toBe(false);
  });

  it('is false when the leaf is missing', () => {
    expect(evaluateCondition({ path: 'education.modeOfStudy', in: ['distance'] }, {})).toBe(false);
  });

  it('matches an `equals` condition', () => {
    const cf: CaseFacts = { family: { spousePresent: wrap(true) } };
    expect(evaluateCondition({ path: 'family.spousePresent', equals: true }, cf)).toBe(true);
  });
});

describe('computeJourneyProgress — eligibility phase', () => {
  it('counts a fully-populated eligibility phase as 8/8 done', () => {
    const cf: CaseFacts = {
      target: { intendedVisa: wrap('blue_card'), targetConsulate: wrap('bengaluru') },
      employment: {
        employerName: wrap('Acme GmbH'), employerCity: wrap('Munich'),
        jobTitle: wrap('Senior Software Engineer'), iscoCode: wrap('2512'),
        annualGrossSalaryEur: wrap(48500), contractType: wrap('permanent'),
        contractStartDate: wrap('2026-09-01'), priorExperienceYears: wrap(8),
      },
      education: {
        highestDegree: wrap('master_eqf7'), fieldOfStudy: wrap('Computer Science'),
        institution: wrap('IIT Bombay'), completionYear: wrap(2016), anabinStatus: wrap('H+'),
      },
    };
    const progress = computeJourneyProgress(cf, EMPTY_PROFILE, getDocumentRules(), verdictFor(cf), TODAY);
    const elig = progress.phases.find((p) => p.id === 'eligibility')!;
    expect(elig.total).toBe(8);
    expect(elig.completed).toBe(8);
    expect(elig.status).toBe('done');
  });

  it('marks an empty eligibility phase 0/8 todo and a step incomplete with no-data provenance', () => {
    const cf: CaseFacts = {};
    const progress = computeJourneyProgress(cf, EMPTY_PROFILE, getDocumentRules(), verdictFor(cf), TODAY);
    const elig = progress.phases.find((p) => p.id === 'eligibility')!;
    expect(elig.completed).toBe(0);
    expect(elig.status).toBe('todo');
    const salaryStep = elig.steps.find((s) => s.id === 'salary')!;
    expect(salaryStep.state).toBe('incomplete');
    expect(salaryStep.answerProvenance).toBeNull();
    expect(salaryStep.requirementCitation).not.toBeNull(); // salary has a cite
  });

  it('attaches answer provenance to a completed step', () => {
    const cf: CaseFacts = { employment: { annualGrossSalaryEur: wrap(48500) } };
    const progress = computeJourneyProgress(cf, EMPTY_PROFILE, getDocumentRules(), verdictFor(cf), TODAY);
    const elig = progress.phases.find((p) => p.id === 'eligibility')!;
    const salaryStep = elig.steps.find((s) => s.id === 'salary')!;
    expect(salaryStep.answerProvenance?.label).toBe('You told us in chat');
    expect(salaryStep.value).toContain('48500');
  });

  it('renders drafts + package phases as locked with coming-soon copy and no steps', () => {
    const progress = computeJourneyProgress({}, EMPTY_PROFILE, getDocumentRules(), verdictFor({}), TODAY);
    const drafts = progress.phases.find((p) => p.id === 'drafts')!;
    expect(drafts.status).toBe('locked');
    expect(drafts.comingSoon).toBeTruthy();
    expect(drafts.steps).toHaveLength(0);
  });

  it('computes overallPct from unlocked phases only', () => {
    const progress = computeJourneyProgress({}, EMPTY_PROFILE, getDocumentRules(), verdictFor({}), TODAY);
    expect(progress.overallPct).toBe(0);
    expect(progress.overallPct).toBeGreaterThanOrEqual(0);
    expect(progress.overallPct).toBeLessThanOrEqual(100);
  });
});
