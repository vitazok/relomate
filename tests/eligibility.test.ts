import { describe, it, expect } from 'vitest';
import { evaluateEligibility } from '@/lib/rules/eligibility';
import type { CaseFacts } from '@/lib/case/schema';
import type { Profile } from '@/lib/profile/schema';

const TODAY = new Date('2026-05-27T00:00:00.000Z');
const ISO_NOW = TODAY.toISOString();
const PROV = { source: 'user_stated' as const, sourceTurnId: null, confidence: 1, updatedAt: ISO_NOW };

function field<T>(value: T) {
  return { value, ...PROV };
}

const profile: Profile = {
  schemaVersion: 1,
  fullName: field('Test User'),
  dateOfBirth: field('1990-01-01'),
  placeOfBirth: field('Bengaluru'),
  gender: field('male' as const),
  nationality: field('IN'),
  passportNumber: field('X123456'),
  passportExpiry: field('2030-01-01'),
  currentAddress: field({
    line1: 'Some St',
    city: 'Bengaluru',
    stateOrProvince: 'KA',
    country: 'IN',
    postalCode: '560001',
  }),
};

function makeCaseFacts(overrides: {
  intendedVisa?: 'blue_card' | string;
  anabinStatus?: 'H+' | 'H+/-' | 'H-' | 'unknown';
  highestDegree?: 'master_eqf7' | 'bachelor_eqf6' | 'phd_eqf8' | null;
  completionYear?: number;
  salary?: number;
  isco?: string;
  priorExperienceYears?: number;
}): CaseFacts {
  const cf: CaseFacts = {};
  if (overrides.intendedVisa !== undefined) {
    cf.target = { intendedVisa: field(overrides.intendedVisa as 'blue_card') };
  }
  if (overrides.anabinStatus !== undefined || overrides.highestDegree !== undefined || overrides.completionYear !== undefined) {
    cf.education = {};
    if (overrides.anabinStatus !== undefined) cf.education.anabinStatus = field(overrides.anabinStatus);
    if (overrides.highestDegree !== undefined && overrides.highestDegree !== null) cf.education.highestDegree = field(overrides.highestDegree);
    if (overrides.completionYear !== undefined) cf.education.completionYear = field(overrides.completionYear);
  }
  if (overrides.salary !== undefined || overrides.isco !== undefined || overrides.priorExperienceYears !== undefined) {
    cf.employment = {};
    if (overrides.salary !== undefined) cf.employment.annualGrossSalaryEur = field(overrides.salary);
    if (overrides.isco !== undefined) cf.employment.iscoCode = field(overrides.isco);
    if (overrides.priorExperienceYears !== undefined) cf.employment.priorExperienceYears = field(overrides.priorExperienceYears);
  }
  return cf;
}

describe('evaluateEligibility', () => {
  it('flags out-of-scope when intendedVisa is not blue_card', () => {
    const verdict = evaluateEligibility(makeCaseFacts({ intendedVisa: 'asylum' }), profile, TODAY);
    expect(verdict.outOfScope).toBe(true);
    expect(verdict.qualifies).toBeNull();
    expect(verdict.routes).toEqual([]);
  });

  it('blocks on anabin unknown with ZAB + consulate warnings', () => {
    const verdict = evaluateEligibility(
      makeCaseFacts({
        intendedVisa: 'blue_card',
        anabinStatus: 'unknown',
        highestDegree: 'bachelor_eqf6',
        salary: 50000,
        isco: '2512',
      }),
      profile,
      TODAY,
    );
    expect(verdict.outOfScope).toBe(false);
    expect(verdict.qualifies).toBe(false);
    expect(verdict.blockers).toContain('anabin_status_unknown');
    expect(verdict.warnings).toContain('zab_statement_required');
    expect(verdict.warnings).toContain('consulate_clarification_recommended');
    expect(verdict.routes).toEqual([]);
  });

  it('blocks on anabin H- (degree not recognized)', () => {
    const verdict = evaluateEligibility(
      makeCaseFacts({
        anabinStatus: 'H-',
        highestDegree: 'bachelor_eqf6',
        salary: 60000,
      }),
      profile,
      TODAY,
    );
    expect(verdict.qualifies).toBe(false);
    expect(verdict.blockers).toContain('degree_not_recognized');
    expect(verdict.routes).toEqual([]);
  });

  it('qualifies on standard route with H+ and salary above standard', () => {
    const verdict = evaluateEligibility(
      makeCaseFacts({
        anabinStatus: 'H+',
        highestDegree: 'master_eqf7',
        completionYear: 2010, // not recent
        salary: 60000, // > 50700
        isco: '4120', // not shortage, not IT
      }),
      profile,
      TODAY,
    );
    expect(verdict.qualifies).toBe(true);
    expect(verdict.routes).toContain('standard');
    expect(verdict.routes).not.toContain('shortage_occupation');
  });

  it('qualifies on shortage occupation route at reduced salary with shortage ISCO', () => {
    const verdict = evaluateEligibility(
      makeCaseFacts({
        anabinStatus: 'H+',
        highestDegree: 'master_eqf7',
        completionYear: 2010,
        salary: 46000, // ≥ reduced 45934.20, < standard 50700
        isco: '2512', // under shortage prefix '21'
      }),
      profile,
      TODAY,
    );
    expect(verdict.qualifies).toBe(true);
    expect(verdict.routes).toContain('shortage_occupation');
    expect(verdict.routes).not.toContain('standard');
  });

  it('qualifies on recent graduate route', () => {
    const verdict = evaluateEligibility(
      makeCaseFacts({
        anabinStatus: 'H+',
        highestDegree: 'master_eqf7',
        completionYear: 2024, // within 3 yrs of 2026
        salary: 46000,
        isco: '4120', // not shortage, not IT
      }),
      profile,
      TODAY,
    );
    expect(verdict.qualifies).toBe(true);
    expect(verdict.routes).toContain('recent_graduate');
  });

  it('qualifies on IT no-degree route', () => {
    const verdict = evaluateEligibility(
      makeCaseFacts({
        // no education provided at all
        salary: 52000, // ≥ standard 50700
        isco: '2512', // under '25' (IT)
        priorExperienceYears: 5, // ≥ 3
      }),
      profile,
      TODAY,
    );
    expect(verdict.qualifies).toBe(true);
    expect(verdict.routes).toContain('it_no_degree');
    expect(verdict.warnings).toContain('proof_of_experience_required');
  });

  it('flags no_route_qualifies when salary is below reduced and no other branch fires', () => {
    const verdict = evaluateEligibility(
      makeCaseFacts({
        anabinStatus: 'H+',
        highestDegree: 'master_eqf7',
        completionYear: 2010,
        salary: 30000,
        isco: '2512',
      }),
      profile,
      TODAY,
    );
    expect(verdict.qualifies).toBe(false);
    expect(verdict.blockers).toContain('no_route_qualifies');
    expect(verdict.routes).toEqual([]);
  });
});
