import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PersonaSchema, type Persona } from '../../../data/personas/schema';
import { validateLeafPath, validateLeafValue } from '@/lib/case/paths';
import type { Repository } from '@/lib/case/repository';

export const PERSONAS_DIR = join(process.cwd(), 'data', 'personas');

/** Map persona free-string degree labels to the CaseFacts DegreeLevel enum. */
export const DEGREE_MAP: Record<string, 'master_eqf7' | 'bachelor_eqf6' | 'phd_eqf8' | 'other'> = {
  'M.Tech': 'master_eqf7',
  'M.Sc': 'master_eqf7',
  'B.Tech': 'bachelor_eqf6',
  'B.Sc': 'bachelor_eqf6',
  PhD: 'phd_eqf8',
};

export function personaPath(id: string): string {
  return join(PERSONAS_DIR, `${id}.json`);
}

export function loadPersona(id: string): Persona {
  return PersonaSchema.parse(JSON.parse(readFileSync(personaPath(id), 'utf8')));
}

export function listPersonaIds(): string[] {
  return readdirSync(PERSONAS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

export function getPersonaCaseDefaults(personaId: string): { targetConsulate?: string } {
  try {
    const persona = loadPersona(personaId);
    return { targetConsulate: persona.caseFacts.target?.consulate };
  } catch {
    return {};
  }
}

export interface PersonaLeafUpdates {
  /** Dotted CaseFacts leaf path → raw value. */
  caseUpdates: Record<string, unknown>;
  /** Dotted Profile leaf path → raw value. */
  profileUpdates: Record<string, unknown>;
}

/**
 * Convert a persona fixture to the raw leaf-path → value maps that reproduce its case file.
 * Single source of truth for persona → facts mapping, shared by the test harness and the
 * production `?persona=` seeder. Values are RAW (no provenance wrapper) — applyUpdate stamps
 * provenance (source/confidence/updatedAt/sourceTurnId) at write time.
 */
export function personaToLeafUpdates(p: Persona): PersonaLeafUpdates {
  const caseUpdates: Record<string, unknown> = {};
  const profileUpdates: Record<string, unknown> = {};

  // ---- Profile ----
  const addr = p.profile.currentAddress;
  profileUpdates['fullName'] = p.profile.fullName;
  profileUpdates['dateOfBirth'] = p.profile.dateOfBirth;
  profileUpdates['placeOfBirth'] = addr?.city ?? 'unknown';
  profileUpdates['nationality'] = p.profile.nationality;
  profileUpdates['passportNumber'] = p.profile.passportNumber;
  profileUpdates['passportExpiry'] = p.profile.passportExpiry;
  profileUpdates['currentAddress'] = {
    line1: addr?.line1 ?? null,
    city: addr?.city ?? null,
    stateOrProvince: addr?.state ?? null,
    country: addr?.country ?? null,
    postalCode: addr?.postalCode ?? null,
  };

  // ---- CaseFacts: education ----
  const edu = p.caseFacts.education;
  if (edu) {
    if (edu.highestDegree) caseUpdates['education.highestDegree'] = DEGREE_MAP[edu.highestDegree] ?? 'other';
    if (edu.fieldOfStudy) caseUpdates['education.fieldOfStudy'] = edu.fieldOfStudy;
    if (edu.institution) caseUpdates['education.institution'] = edu.institution;
    if (edu.completionYear != null) caseUpdates['education.completionYear'] = edu.completionYear;
    if (edu.anabinStatus) caseUpdates['education.anabinStatus'] = edu.anabinStatus;
    if (edu.modeOfStudy) {
      caseUpdates['education.modeOfStudy'] = edu.modeOfStudy === 'full_time' ? 'regular' : edu.modeOfStudy;
    }
  }

  // ---- CaseFacts: employment ----
  const emp = p.caseFacts.employment;
  if (emp) {
    if (emp.employerName) caseUpdates['employment.employerName'] = emp.employerName;
    if (emp.employerCity) caseUpdates['employment.employerCity'] = emp.employerCity;
    if (emp.jobTitle) caseUpdates['employment.jobTitle'] = emp.jobTitle;
    if (emp.iscoCode) caseUpdates['employment.iscoCode'] = emp.iscoCode;
    if (emp.annualGrossSalaryEur) caseUpdates['employment.annualGrossSalaryEur'] = emp.annualGrossSalaryEur;
    if (emp.contractType) caseUpdates['employment.contractType'] = emp.contractType;
    if (emp.contractStartDate && emp.contractStartDate !== '1970-01-01') {
      caseUpdates['employment.contractStartDate'] = emp.contractStartDate;
    }
    if (emp.priorExperienceYears != null) caseUpdates['employment.priorExperienceYears'] = emp.priorExperienceYears;
  }

  // ---- CaseFacts: family ----
  const fam = p.caseFacts.family;
  if (fam) {
    if (typeof fam.maritalStatus === 'string') caseUpdates['family.maritalStatus'] = fam.maritalStatus;
    caseUpdates['family.spousePresent'] = fam.spouse != null;
    caseUpdates['family.childrenCount'] = Array.isArray(fam.children) ? fam.children.length : 0;
  }

  // ---- CaseFacts: target ----
  const target = p.caseFacts.target;
  if (target) {
    if (target.visaType) caseUpdates['target.intendedVisa'] = target.visaType;
    if (target.consulate) caseUpdates['target.targetConsulate'] = target.consulate;
    if (target.moveDate) caseUpdates['target.targetMoveDate'] = target.moveDate;
  }

  return { caseUpdates, profileUpdates };
}

function isLeafValueValid(path: string, value: unknown): boolean {
  try {
    const { inner } = validateLeafPath(path);
    validateLeafValue(inner, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Seed a freshly-created case from a persona fixture, applied through the normal `update_case`
 * write path (rule 5: the repository is the only writer). Unknown persona ids are a no-op (the
 * case stays empty). Leaves whose raw value doesn't match the schema are skipped rather than
 * sinking the whole bundle. Returns the number of leaves written.
 */
export async function seedCaseFromPersona(
  repo: Pick<Repository, 'applyUpdate'>,
  caseId: string,
  personaId: string,
): Promise<number> {
  let persona: Persona;
  try {
    persona = loadPersona(personaId);
  } catch {
    return 0; // unknown / unparseable persona id — leave the case empty
  }

  const { caseUpdates, profileUpdates } = personaToLeafUpdates(persona);
  const all = { ...caseUpdates, ...profileUpdates };
  const valid: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(all)) {
    if (isLeafValueValid(path, value)) valid[path] = value;
  }
  if (Object.keys(valid).length === 0) return 0;

  await repo.applyUpdate({
    caseId,
    source: 'user_stated',
    sourceTurnId: null,
    confidence: 1,
    updates: valid,
  });
  return Object.keys(valid).length;
}
