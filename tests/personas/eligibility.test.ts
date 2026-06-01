import { describe, it, expect } from 'vitest';
import { evaluateEligibility } from '@/lib/rules/eligibility';
import { loadAllPersonas, toCaseFacts, toProfile, PERSONA_TODAY } from '../_personas/harness';

const TODAY = PERSONA_TODAY;
const personas = loadAllPersonas();

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
