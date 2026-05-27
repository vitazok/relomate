import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PersonaSchema, type Persona } from '../../data/personas/schema';
import { evaluateEligibility } from '@/lib/rules/eligibility';
import type { CaseFacts } from '@/lib/case/schema';
import type { Profile } from '@/lib/profile/schema';

const PERSONAS_DIR = join(process.cwd(), 'data', 'personas');
const TODAY = new Date('2026-05-27T00:00:00.000Z');
const ISO_NOW = TODAY.toISOString();
const PROV = { source: 'user_stated' as const, sourceTurnId: null, confidence: 1, updatedAt: ISO_NOW };
const wrap = <T>(value: T) => ({ value, ...PROV });

function loadPersonas(): Persona[] {
  return readdirSync(PERSONAS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => PersonaSchema.parse(JSON.parse(readFileSync(join(PERSONAS_DIR, f), 'utf8'))));
}

const DEGREE_MAP: Record<string, 'master_eqf7' | 'bachelor_eqf6' | 'phd_eqf8' | 'other'> = {
  'M.Tech': 'master_eqf7',
  'M.Sc': 'master_eqf7',
  'B.Tech': 'bachelor_eqf6',
  'B.Sc': 'bachelor_eqf6',
  PhD: 'phd_eqf8',
};

function toProfile(p: Persona): Profile {
  const addr = p.profile.currentAddress;
  return {
    schemaVersion: 1,
    fullName: wrap(p.profile.fullName),
    dateOfBirth: wrap(p.profile.dateOfBirth),
    placeOfBirth: wrap(addr?.city ?? 'unknown'),
    gender: wrap('male' as const),
    nationality: wrap(p.profile.nationality),
    passportNumber: wrap(p.profile.passportNumber),
    passportExpiry: wrap(p.profile.passportExpiry),
    currentAddress: wrap({
      line1: addr?.line1 ?? null,
      city: addr?.city ?? null,
      stateOrProvince: addr?.state ?? null,
      country: addr?.country ?? null,
      postalCode: addr?.postalCode ?? null,
    }),
  };
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

  const target = p.caseFacts.target;
  if (target) {
    const targetOut: NonNullable<CaseFacts['target']> = {};
    if (target.visaType) {
      // Engine's IntendedVisa enum is just ['blue_card']; cast non-blue_card values for engine's out-of-scope check
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

const personas = loadPersonas();

describe.each(personas.map((p) => [p.id, p] as const))('persona %s', (_id, persona) => {
  it('matches expected verdict', () => {
    const verdict = evaluateEligibility(toCaseFacts(persona), toProfile(persona), TODAY);

    if (persona.expected.outOfScope !== undefined) {
      expect(verdict.outOfScope).toBe(persona.expected.outOfScope);
    }
    // Only assert eligibility when not out-of-scope (engine returns qualifies=null for out-of-scope)
    if (persona.expected.eligible !== undefined && !verdict.outOfScope) {
      expect(verdict.qualifies).toBe(persona.expected.eligible);
    }
    if (persona.expected.route) {
      expect(verdict.routes).toContain(persona.expected.route);
    }
    if (persona.expected.blockers) {
      for (const code of persona.expected.blockers) {
        expect(verdict.blockers).toContain(code);
      }
    }
    if (persona.expected.warnings) {
      for (const code of persona.expected.warnings) {
        expect(verdict.warnings).toContain(code);
      }
    }
  });
});
