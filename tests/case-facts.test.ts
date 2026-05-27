import { describe, it, expect } from 'vitest';
import { CaseFactsSchema } from '@/lib/case/schema';

const isoNow = '2026-05-27T12:00:00.000Z';
const prov = { source: 'user_stated' as const, sourceTurnId: null, confidence: 0.9, updatedAt: isoNow };

describe('CaseFactsSchema', () => {
  it('accepts a minimal but complete shape', () => {
    const ok = CaseFactsSchema.safeParse({
      employment: {
        employerName: { value: 'Acme GmbH', ...prov },
        annualGrossSalaryEur: { value: 48500, ...prov },
        iscoCode: { value: '2512', ...prov },
        contractType: { value: 'permanent', ...prov },
        contractStartDate: { value: '2026-09-01', ...prov },
        priorExperienceYears: { value: 8, ...prov },
        jobTitle: { value: 'Senior SWE', ...prov },
        employerCity: { value: 'Munich', ...prov },
      },
      education: {
        highestDegree: { value: 'master_eqf7', ...prov },
        fieldOfStudy: { value: 'Computer Science', ...prov },
        institution: { value: 'IIT Bombay', ...prov },
        completionYear: { value: 2016, ...prov },
        anabinStatus: { value: 'H+', ...prov },
        modeOfStudy: { value: 'regular', ...prov },
      },
      family: {
        maritalStatus: { value: 'married', ...prov },
      },
      target: {
        intendedVisa: { value: 'blue_card', ...prov },
        targetConsulate: { value: 'bengaluru', ...prov },
        targetMoveDate: { value: '2026-09-01', ...prov },
      },
    });
    if (!ok.success) console.error(ok.error.issues);
    expect(ok.success).toBe(true);
  });

  it('rejects an annualGrossSalaryEur that is not a Field-wrapped number', () => {
    const bad = CaseFactsSchema.safeParse({
      employment: { annualGrossSalaryEur: 48500 },
    });
    expect(bad.success).toBe(false);
  });
});
