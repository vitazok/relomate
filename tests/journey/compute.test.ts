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

  it('renders the draft steps and keeps package locked', () => {
    const progress = computeJourneyProgress({}, EMPTY_PROFILE, getDocumentRules(), verdictFor({}), TODAY);
    const drafts = progress.phases.find((p) => p.id === 'drafts')!;
    expect(drafts.status).toBe('todo');
    expect(drafts.comingSoon).toBeNull();
    expect(drafts.steps.map((s) => s.id)).toEqual(['cover_letter', 'employer_letter', 'cv']);
    expect(drafts.steps.every((s) => s.value === 'not started yet')).toBe(true);
    const pkg = progress.phases.find((p) => p.id === 'package')!;
    expect(pkg.status).toBe('locked');
  });

  it('counts approved drafts as complete and links ready drafts to review', () => {
    const ready = computeJourneyProgress(
      {},
      EMPTY_PROFILE,
      getDocumentRules(),
      verdictFor({}),
      TODAY,
      [],
      'case-1',
      [{ id: 'draft-ready', type: 'cover_letter', status: 'ready_for_review' }],
    ).phases.find((p) => p.id === 'drafts')!;
    expect(ready.completed).toBe(0);
    expect(ready.steps[0]?.value).toBe('ready for review');
    expect(ready.steps[0]?.draft?.reviewHref).toBe('/case/case-1/drafts/draft-ready/review');

    const approved = computeJourneyProgress(
      {},
      EMPTY_PROFILE,
      getDocumentRules(),
      verdictFor({}),
      TODAY,
      [],
      'case-1',
      [
        { id: 'cover-approved', type: 'cover_letter', status: 'approved' },
        { id: 'employer-approved', type: 'employer_letter', status: 'approved' },
        { id: 'cv-approved', type: 'cv', status: 'approved' },
      ],
    ).phases.find((p) => p.id === 'drafts')!;
    expect(approved.completed).toBe(3);
    expect(approved.status).toBe('done');
  });

  it('computes overallPct from unlocked phases only', () => {
    const progress = computeJourneyProgress({}, EMPTY_PROFILE, getDocumentRules(), verdictFor({}), TODAY);
    expect(progress.overallPct).toBe(0);
    expect(progress.overallPct).toBeGreaterThanOrEqual(0);
    expect(progress.overallPct).toBeLessThanOrEqual(100);
  });
});

describe('computeJourneyProgress — documents phase', () => {
  it('includes ZAB only when anabin condition matches', () => {
    const withUnknown: CaseFacts = { education: { anabinStatus: wrap('unknown') } };
    const withHPlus: CaseFacts = { education: { anabinStatus: wrap('H+') } };

    const docsUnknown = computeJourneyProgress(withUnknown, EMPTY_PROFILE, getDocumentRules(), verdictFor(withUnknown), TODAY)
      .phases.find((p) => p.id === 'documents')!;
    const docsHPlus = computeJourneyProgress(withHPlus, EMPTY_PROFILE, getDocumentRules(), verdictFor(withHPlus), TODAY)
      .phases.find((p) => p.id === 'documents')!;

    expect(docsUnknown.steps.some((s) => s.id === 'zab_statement')).toBe(true);
    expect(docsHPlus.steps.some((s) => s.id === 'zab_statement')).toBe(false);
  });

  it('excludes route-specific docs when the route does not apply', () => {
    // it_specialist_experience_pack is routes: [it_no_degree]
    const standard: CaseFacts = {
      education: { highestDegree: wrap('master_eqf7'), anabinStatus: wrap('H+') },
      employment: { annualGrossSalaryEur: wrap(60000), iscoCode: wrap('2512') },
    };
    const docs = computeJourneyProgress(standard, EMPTY_PROFILE, getDocumentRules(), verdictFor(standard), TODAY)
      .phases.find((p) => p.id === 'documents')!;
    expect(docs.steps.some((s) => s.id === 'it_specialist_experience_pack')).toBe(false);
  });

  it('expands per-member family document sets from composition', () => {
    const withFamily: CaseFacts = {
      education: { anabinStatus: wrap('H+') },
      family: { spousePresent: wrap(true), childrenCount: wrap(2) },
    };
    const docs = computeJourneyProgress(withFamily, EMPTY_PROFILE, getDocumentRules(), verdictFor(withFamily), TODAY)
      .phases.find((p) => p.id === 'documents')!;

    expect(docs.steps.some((s) => s.id === 'spouse_passport')).toBe(true);
    expect(docs.steps.some((s) => s.group === 'Spouse')).toBe(true);
    expect(docs.steps.filter((s) => s.id.startsWith('child_passport')).length).toBe(2);
    expect(docs.steps.some((s) => s.group === 'Child 1')).toBe(true);
    expect(docs.steps.some((s) => s.group === 'Child 2')).toBe(true);
  });

  it('omits family sets when no spouse/children present', () => {
    const single: CaseFacts = { education: { anabinStatus: wrap('H+') }, family: { spousePresent: wrap(false), childrenCount: wrap(0) } };
    const docs = computeJourneyProgress(single, EMPTY_PROFILE, getDocumentRules(), verdictFor(single), TODAY)
      .phases.find((p) => p.id === 'documents')!;
    expect(docs.steps.some((s) => s.group === 'Spouse')).toBe(false);
    expect(docs.steps.some((s) => s.group?.startsWith('Child'))).toBe(false);
  });

  it('marks missing document steps incomplete with an enabled upload action', () => {
    const cf: CaseFacts = { education: { anabinStatus: wrap('H+') } };
    const docs = computeJourneyProgress(cf, EMPTY_PROFILE, getDocumentRules(), verdictFor(cf), TODAY)
      .phases.find((p) => p.id === 'documents')!;
    expect(docs.steps.length).toBeGreaterThan(0);
    for (const s of docs.steps) {
      expect(s.state).toBe('incomplete');
      expect(s.document).toBeNull();
      expect(s.action).toEqual({ kind: 'upload', enabled: true, spineItemId: s.id });
    }
  });

  it('reflects uploaded document statuses and counts only confirmed documents complete', () => {
    const cf: CaseFacts = { education: { anabinStatus: wrap('unknown') } };
    const docs = computeJourneyProgress(
      cf,
      EMPTY_PROFILE,
      getDocumentRules(),
      verdictFor(cf),
      TODAY,
      [
        { id: 'd-passport', spineItemId: 'passport', fileName: 'passport.pdf', status: 'confirmed' },
        {
          id: 'd-photo',
          spineItemId: 'biometric_photos',
          fileName: 'photo.jpg',
          status: 'awaiting_confirmation',
        },
        {
          id: 'd-contract',
          spineItemId: 'signed_employment_contract',
          fileName: 'contract.pdf',
          status: 'failed',
        },
        { id: 'd-zab', spineItemId: 'zab_statement', fileName: 'zab.pdf', status: 'uploaded' },
        { id: 'd-cv', spineItemId: 'cv_resume', fileName: 'cv.pdf', status: 'rejected' },
      ],
      'case-1',
    ).phases.find((p) => p.id === 'documents')!;

    const passport = docs.steps.find((s) => s.id === 'passport')!;
    const photo = docs.steps.find((s) => s.id === 'biometric_photos')!;
    const contract = docs.steps.find((s) => s.id === 'signed_employment_contract')!;
    const zab = docs.steps.find((s) => s.id === 'zab_statement')!;
    const cv = docs.steps.find((s) => s.id === 'cv_resume')!;

    expect(passport.state).toBe('complete');
    expect(passport.value).toBe('confirmed');
    expect(passport.action).toBeNull();

    expect(photo.state).toBe('incomplete');
    expect(photo.value).toBe('ready for review');
    expect(photo.document?.reviewHref).toBe('/case/case-1/documents/d-photo/review');
    expect(photo.action).toBeNull();

    expect(contract.state).toBe('incomplete');
    expect(contract.value).toBe('could not read');
    expect(contract.action).toEqual({
      kind: 'upload',
      enabled: true,
      spineItemId: 'signed_employment_contract',
    });

    expect(zab.value).toBe('processing');
    expect(zab.action).toBeNull();

    expect(cv.value).toBe('dismissed');
    expect(cv.action).toEqual({ kind: 'upload', enabled: true, spineItemId: 'cv_resume' });

    expect(docs.completed).toBe(1);
  });

  it('threads the documents-file lastVerified date into document citations', () => {
    const cf: CaseFacts = { education: { anabinStatus: wrap('H+') } };
    const docsRules = getDocumentRules();
    const docs = computeJourneyProgress(cf, EMPTY_PROFILE, docsRules, verdictFor(cf), TODAY)
      .phases.find((p) => p.id === 'documents')!;
    const firstStep = docs.steps[0]!;
    expect(firstStep.requirementCitation?.lastVerified).toBe(docsRules.lastVerified);
    expect(firstStep.requirementCitation?.lastVerified).not.toBe('');
  });
});
