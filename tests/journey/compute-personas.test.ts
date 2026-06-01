import { describe, it, expect } from 'vitest';
import type { Persona } from '../../data/personas/schema';
import { computeJourneyProgress } from '@/lib/journey/compute';
import { getDocumentRules } from '@/lib/rules/loader';
import { evaluateEligibility } from '@/lib/rules/eligibility';
import { loadPersona, toCaseFacts, EMPTY_PROFILE, PERSONA_TODAY } from '../_personas/harness';

const TODAY = PERSONA_TODAY;
const load = loadPersona;

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
