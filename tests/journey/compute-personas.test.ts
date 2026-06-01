import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PersonaSchema, type Persona } from '../../data/personas/schema';
import { computeJourneyProgress } from '@/lib/journey/compute';
import { getDocumentRules } from '@/lib/rules/loader';
import { evaluateEligibility } from '@/lib/rules/eligibility';
import type { CaseFacts } from '@/lib/case/schema';
import type { Profile } from '@/lib/profile/schema';

const DIR = join(process.cwd(), 'data', 'personas');
const TODAY = new Date('2026-05-27T00:00:00.000Z');
const ISO = TODAY.toISOString();
const PROV = { source: 'user_stated' as const, sourceTurnId: null, confidence: 1, updatedAt: ISO };
const wrap = <T>(value: T) => ({ value, ...PROV });
const EMPTY_PROFILE: Profile = { schemaVersion: 1 };

const DEGREE_MAP: Record<string, 'master_eqf7' | 'bachelor_eqf6' | 'phd_eqf8' | 'other'> = {
  'M.Tech': 'master_eqf7',
  'M.Sc': 'master_eqf7',
  'B.Tech': 'bachelor_eqf6',
  'B.Sc': 'bachelor_eqf6',
  PhD: 'phd_eqf8',
};

function load(id: string): Persona {
  return PersonaSchema.parse(JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8')));
}

function toCaseFacts(p: Persona): CaseFacts {
  const cf: CaseFacts = {};

  const edu = p.caseFacts.education;
  if (edu) {
    const educationOut: NonNullable<CaseFacts['education']> = {};
    if (edu.highestDegree) {
      educationOut.highestDegree = wrap(DEGREE_MAP[edu.highestDegree] ?? 'other');
    }
    if (edu.fieldOfStudy) educationOut.fieldOfStudy = wrap(edu.fieldOfStudy);
    if (edu.institution) educationOut.institution = wrap(edu.institution);
    if (edu.completionYear != null) educationOut.completionYear = wrap(edu.completionYear);
    if (edu.anabinStatus) educationOut.anabinStatus = wrap(edu.anabinStatus);
    if (edu.modeOfStudy) {
      const mode = edu.modeOfStudy === 'full_time' ? 'regular' : edu.modeOfStudy;
      educationOut.modeOfStudy = wrap(mode);
    }
    if (Object.keys(educationOut).length > 0) cf.education = educationOut;
  }

  const emp = p.caseFacts.employment;
  if (emp) {
    const empOut: NonNullable<CaseFacts['employment']> = {};
    if (emp.employerName) empOut.employerName = wrap(emp.employerName);
    if (emp.employerCity) empOut.employerCity = wrap(emp.employerCity);
    if (emp.jobTitle) empOut.jobTitle = wrap(emp.jobTitle);
    if (emp.iscoCode) empOut.iscoCode = wrap(emp.iscoCode);
    if (emp.annualGrossSalaryEur) empOut.annualGrossSalaryEur = wrap(emp.annualGrossSalaryEur);
    if (emp.contractType) empOut.contractType = wrap(emp.contractType);
    if (emp.contractStartDate && emp.contractStartDate !== '1970-01-01') {
      empOut.contractStartDate = wrap(emp.contractStartDate);
    }
    if (emp.priorExperienceYears != null) empOut.priorExperienceYears = wrap(emp.priorExperienceYears);
    if (Object.keys(empOut).length > 0) cf.employment = empOut;
  }

  const fam = p.caseFacts.family;
  if (fam) {
    const famOut: NonNullable<CaseFacts['family']> = {};
    // maritalStatus: persona maritalStatus is a free string but CaseFacts expects a specific enum
    // reason: journey compute only reads spousePresent/childrenCount, not maritalStatus, so cast is safe
    if (typeof fam.maritalStatus === 'string') {
      famOut.maritalStatus = wrap(fam.maritalStatus as 'married');
    }
    // Family composition fields for journey tracker
    famOut.spousePresent = wrap(fam.spouse != null);
    famOut.childrenCount = wrap(Array.isArray(fam.children) ? fam.children.length : 0);
    cf.family = famOut;
  }

  const target = p.caseFacts.target;
  if (target) {
    const targetOut: NonNullable<CaseFacts['target']> = {};
    if (target.visaType) {
      targetOut.intendedVisa = wrap(target.visaType as 'blue_card');
    }
    if (target.consulate) {
      targetOut.targetConsulate = wrap(target.consulate as 'bengaluru');
    }
    if (target.moveDate) targetOut.targetMoveDate = wrap(target.moveDate);
    if (Object.keys(targetOut).length > 0) cf.target = targetOut;
  }

  return cf;
}

function progressFor(p: Persona) {
  const cf = toCaseFacts(p);
  const verdict = evaluateEligibility(cf, EMPTY_PROFILE, TODAY);
  return computeJourneyProgress(cf, EMPTY_PROFILE, getDocumentRules(), verdict, TODAY);
}

describe('journey progress per persona', () => {
  it('priya-strong: eligibility 8/8; spouse + 1 child doc sets; no ZAB (Anabin H+)', () => {
    const docs = progressFor(load('priya-strong'));
    const elig = docs.phases.find((p) => p.id === 'eligibility')!;
    const documents = docs.phases.find((p) => p.id === 'documents')!;
    expect(elig.completed).toBe(8);
    expect(elig.status).toBe('done');
    expect(documents.steps.some((s) => s.id === 'zab_statement')).toBe(false);
    expect(documents.steps.some((s) => s.group === 'Spouse')).toBe(true);
    expect(documents.steps.some((s) => s.group === 'Child 1')).toBe(true);
    expect(documents.steps.some((s) => s.group === 'Child 2')).toBe(false);
  });

  it('vikram-edge-anabin: ZAB present (Anabin unknown); single -> no family sets', () => {
    const docs = progressFor(load('vikram-edge-anabin'));
    const documents = docs.phases.find((p) => p.id === 'documents')!;
    expect(documents.steps.some((s) => s.id === 'zab_statement')).toBe(true);
    expect(documents.steps.some((s) => s.group === 'Spouse')).toBe(false);
  });

  it('arjun-it-no-degree: IT experience pack present; degree step incomplete', () => {
    const docs = progressFor(load('arjun-it-no-degree'));
    const elig = docs.phases.find((p) => p.id === 'eligibility')!;
    const documents = docs.phases.find((p) => p.id === 'documents')!;
    expect(documents.steps.some((s) => s.id === 'it_specialist_experience_pack')).toBe(true);
    const degreeStep = elig.steps.find((s) => s.id === 'degree')!;
    expect(degreeStep.state).toBe('incomplete');
  });

  it('out-of-scope-asylum: eligibility phase still computes (headline reflects out-of-scope)', () => {
    const docs = progressFor(load('out-of-scope-asylum'));
    const elig = docs.phases.find((p) => p.id === 'eligibility')!;
    expect(elig).toBeTruthy();
  });
});
