import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PersonaSchema, type Persona } from '../../data/personas/schema';
import type { CaseFacts } from '@/lib/case/schema';
import type { Profile } from '@/lib/profile/schema';

export const PERSONAS_DIR = join(process.cwd(), 'data', 'personas');

/** Fixed clock for all persona tests so provenance/eligibility dates are deterministic. */
export const PERSONA_TODAY = new Date('2026-05-27T00:00:00.000Z');
export const PERSONA_ISO = PERSONA_TODAY.toISOString();

const PROV = { source: 'user_stated' as const, sourceTurnId: null, confidence: 1, updatedAt: PERSONA_ISO };

/** Wrap a raw value in the rule-9 provenance shape used across the case tree. */
export const wrap = <T>(value: T) => ({ value, ...PROV });

export const EMPTY_PROFILE: Profile = { schemaVersion: 1 };

export const DEGREE_MAP: Record<string, 'master_eqf7' | 'bachelor_eqf6' | 'phd_eqf8' | 'other'> = {
  'M.Tech': 'master_eqf7',
  'M.Sc': 'master_eqf7',
  'B.Tech': 'bachelor_eqf6',
  'B.Sc': 'bachelor_eqf6',
  PhD: 'phd_eqf8',
};

export function loadPersona(id: string): Persona {
  return PersonaSchema.parse(JSON.parse(readFileSync(join(PERSONAS_DIR, `${id}.json`), 'utf8')));
}

export function loadAllPersonas(): Persona[] {
  return readdirSync(PERSONAS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => PersonaSchema.parse(JSON.parse(readFileSync(join(PERSONAS_DIR, f), 'utf8'))));
}

export function toProfile(p: Persona): Profile {
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

export function toCaseFacts(p: Persona): CaseFacts {
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
    // reason: persona maritalStatus is a free string; CaseFacts expects an enum. Engine + journey
    // compute read only spousePresent/childrenCount, never maritalStatus, so the cast is safe.
    if (typeof fam.maritalStatus === 'string') {
      famOut.maritalStatus = wrap(fam.maritalStatus as 'married');
    }
    famOut.spousePresent = wrap(fam.spouse != null);
    famOut.childrenCount = wrap(Array.isArray(fam.children) ? fam.children.length : 0);
    cf.family = famOut;
  }

  const target = p.caseFacts.target;
  if (target) {
    const targetOut: NonNullable<CaseFacts['target']> = {};
    // reason: persona visaType is a free string; out-of-scope personas carry non-blue_card values.
    // The cast keeps toCaseFacts total; L1 derives the RAW value and lets applyUpdate reject it.
    if (target.visaType) targetOut.intendedVisa = wrap(target.visaType as 'blue_card');
    if (target.consulate) targetOut.targetConsulate = wrap(target.consulate as 'bengaluru');
    if (target.moveDate) targetOut.targetMoveDate = wrap(target.moveDate);
    if (Object.keys(targetOut).length > 0) cf.target = targetOut;
  }

  return cf;
}
