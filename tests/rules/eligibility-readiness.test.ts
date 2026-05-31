import { describe, it, expect } from 'vitest';
import { assessReadiness } from '@/lib/rules/eligibility-readiness';
import type { CaseFacts } from '@/lib/case/schema';

const ISO = '2026-05-27T00:00:00.000Z';
const PROV = { source: 'user_stated' as const, sourceTurnId: null, confidence: 1, updatedAt: ISO };
const f = <T>(value: T) => ({ value, ...PROV });

describe('assessReadiness', () => {
  it('not ready when empty — lists salary as missing', () => {
    const r = assessReadiness({} as CaseFacts);
    expect(r.ready).toBe(false);
    expect(r.missing).toContain('employment.annualGrossSalaryEur');
  });

  it('ready with salary + anabinStatus (degree route shape)', () => {
    const facts: CaseFacts = {
      employment: { annualGrossSalaryEur: f(48500) },
      education: { anabinStatus: f('H+') },
    };
    expect(assessReadiness(facts)).toEqual({ ready: true, missing: [] });
  });

  it('ready with salary + IT-no-degree shape (isco + experience, no degree)', () => {
    const facts: CaseFacts = {
      employment: {
        annualGrossSalaryEur: f(52000),
        iscoCode: f('2522'),
        priorExperienceYears: f(5),
      },
    };
    expect(assessReadiness(facts)).toEqual({ ready: true, missing: [] });
  });

  it('not ready with salary but no degree signal and no IT shape — lists education', () => {
    const facts: CaseFacts = { employment: { annualGrossSalaryEur: f(52000) } };
    const r = assessReadiness(facts);
    expect(r.ready).toBe(false);
    expect(r.missing).toContain('education.anabinStatus');
  });

  it('not ready with IT fields but also a degree — degree blocks the IT path', () => {
    const facts: CaseFacts = {
      employment: {
        annualGrossSalaryEur: f(52000),
        iscoCode: f('2522'),
        priorExperienceYears: f(5),
      },
      education: { highestDegree: f('bachelor_eqf6') },
    };
    const r = assessReadiness(facts);
    expect(r.ready).toBe(false);
    expect(r.missing).toContain('education.anabinStatus');
  });
});
