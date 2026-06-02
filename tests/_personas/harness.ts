import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PersonaSchema, type Persona } from '../../data/personas/schema';
import type { CaseFacts } from '@/lib/case/schema';
import type { Profile } from '@/lib/profile/schema';
import { validateLeafPath, validateLeafValue } from '@/lib/case/paths';
import type { UpdateCaseInputForLLM } from '@/lib/case/types';

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

/** Walk a wrapped case-tree object, returning each leaf's dotted path + raw value (drops provenance). */
export function flattenLeafValues(
  obj: Record<string, unknown>,
  prefix = '',
): Array<{ path: string; value: unknown }> {
  const out: Array<{ path: string; value: unknown }> = [];
  for (const [key, node] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    // Leaf detection: FieldSchema/ArrayFieldSchema wrappers always carry a 'value' key;
    // intermediate objects on the CaseFacts/Profile tree do not.
    if (node && typeof node === 'object' && 'value' in (node as object)) {
      out.push({ path, value: (node as { value: unknown }).value });
    } else if (node && typeof node === 'object') {
      out.push(...flattenLeafValues(node as Record<string, unknown>, path));
    }
  }
  return out;
}

/** True iff `value` is a legal value for the leaf at `path` (mirrors applyUpdate's eager check). */
export function isLeafValueValid(path: string, value: unknown): boolean {
  try {
    const resolved = validateLeafPath(path);
    validateLeafValue(resolved.inner, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Derive the update_case calls that reproduce a persona's facts. Valid leaves are bundled into
 * one call (index 0). Each leaf whose raw value is invalid for its schema is isolated into its
 * own single-path call (appended after the bundle) — because applyUpdate validates eagerly and
 * rejects the WHOLE call on one bad value, so bundling an invalid leaf would sink the valid ones.
 */
export function deriveUpdateCalls(persona: Persona): UpdateCaseInputForLLM[] {
  const leaves = flattenLeafValues(toCaseFacts(persona));
  const valid: Record<string, unknown> = {};
  const isolated: UpdateCaseInputForLLM[] = [];
  for (const { path, value } of leaves) {
    if (isLeafValueValid(path, value)) {
      valid[path] = value;
    } else {
      isolated.push({ source: 'user_stated', confidence: 1, updates: { [path]: value } });
    }
  }
  const calls: UpdateCaseInputForLLM[] = [];
  if (Object.keys(valid).length > 0) {
    calls.push({ source: 'user_stated', confidence: 1, updates: valid });
  }
  calls.push(...isolated);
  return calls;
}

export interface SynthToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}
export interface SynthToolResult {
  toolCallId: string;
  toolName: string;
  output: unknown;
}
export interface SynthStep {
  text: string;
  content: Array<{ type: 'text'; text: string }>;
  toolCalls: SynthToolCall[];
  toolResults: SynthToolResult[];
}
export interface SynthTurnEvent {
  text: string;
  content: Array<{ type: 'text'; text: string }>;
  toolCalls: SynthToolCall[];
  toolResults: SynthToolResult[];
  steps: SynthStep[];
}

/**
 * Build a well-formed onFinish event for a persona. In-scope personas emit the derived
 * update_case bundle (call index 0); out-of-scope personas emit an out_of_scope call instead,
 * so the Inngest `case.facts.updated` emit (which fires only for update_case) does not fire.
 */
export function synthesizeTurnEvent(persona: Persona): SynthTurnEvent {
  if (persona.expected.outOfScope) {
    const text = 'That request is outside what I can help with here.';
    return {
      text,
      content: [{ type: 'text', text }],
      toolCalls: [
        {
          toolCallId: 'call-oos',
          toolName: 'out_of_scope',
          input: { reason: persona.expected.reason ?? 'out of scope' },
        },
      ],
      toolResults: [
        {
          toolCallId: 'call-oos',
          toolName: 'out_of_scope',
          output: { type: 'out_of_scope_result', version: 1, data: {} },
        },
      ],
      steps: [
        {
          text: '',
          content: [],
          toolCalls: [
            { toolCallId: 'call-oos', toolName: 'out_of_scope', input: { reason: persona.expected.reason ?? 'out of scope' } },
          ],
          toolResults: [
            { toolCallId: 'call-oos', toolName: 'out_of_scope', output: { type: 'out_of_scope_result', version: 1, data: {} } },
          ],
        },
        { text, content: [{ type: 'text', text }], toolCalls: [], toolResults: [] },
      ],
    };
  }

  const bundle = deriveUpdateCalls(persona)[0]!; // in-scope personas have only the valid bundle
  const updatedPaths = Object.keys(bundle.updates);
  const text = 'Recorded.';
  return {
    text,
    content: [{ type: 'text', text }],
    toolCalls: [{ toolCallId: 'call-1', toolName: 'update_case', input: bundle }],
    toolResults: [
      {
        toolCallId: 'call-1',
        toolName: 'update_case',
        output: {
          type: 'update_case_result',
          version: 1,
          // caseId here is a placeholder; onFinish's inngest mapping reads caseId from the
          // buildAgentTurn param, not from this result payload.
          data: { caseId: 'case-synthetic', updatedPaths, contradictions: [] },
        },
      },
    ],
    steps: [
      {
        text: '',
        content: [],
        toolCalls: [{ toolCallId: 'call-1', toolName: 'update_case', input: bundle }],
        toolResults: [
          {
            toolCallId: 'call-1',
            toolName: 'update_case',
            output: {
              type: 'update_case_result',
              version: 1,
              data: { caseId: 'case-synthetic', updatedPaths, contradictions: [] },
            },
          },
        ],
      },
      { text, content: [{ type: 'text', text }], toolCalls: [], toolResults: [] },
    ],
  };
}
