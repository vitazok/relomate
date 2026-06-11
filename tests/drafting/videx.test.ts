import { describe, expect, it } from 'vitest';
import {
  VIDEX_FIELDS,
  assessVidexCompleteness,
  formatVidexDate,
  mapIso2CountryName,
} from '@/lib/drafting/videx';
import { validateLeafPath } from '@/lib/case/paths';
import { loadPersona, toCaseFacts, toProfile } from '../_personas/harness';

describe('VIDEX field map', () => {
  it('defines the 37 official fields and validates every mapped leaf path', () => {
    expect(VIDEX_FIELDS).toHaveLength(37);
    expect(new Set(VIDEX_FIELDS.map((f) => f.fieldNumber)).size).toBe(37);

    for (const field of VIDEX_FIELDS) {
      expect(field.sourcePaths.length).toBeGreaterThan(0);
      for (const path of field.sourcePaths) {
        expect(() => validateLeafPath(path)).not.toThrow();
      }
    }
  });

  it('uses current AcroForm ids from the immigration reference where available', () => {
    expect(VIDEX_FIELDS.find((f) => f.fieldNumber === 1)?.acroFormFieldIds).toEqual([
      'applicantSurname',
    ]);
    expect(VIDEX_FIELDS.find((f) => f.fieldNumber === 13)?.acroFormFieldIds).toEqual([
      'travelDocNumber',
    ]);
    expect(VIDEX_FIELDS.find((f) => f.fieldNumber === 36)?.acroFormFieldIds).toEqual([
      'townAndDateTime',
    ]);
  });

  it('formats common VIDEX values deterministically', () => {
    expect(formatVidexDate('1992-03-14')).toBe('14/03/1992');
    expect(mapIso2CountryName('IN')).toBe('India');
    expect(mapIso2CountryName('DE')).toBe('Germany');
    expect(mapIso2CountryName('ZZ')).toBe('ZZ');
  });
});

describe('assessVidexCompleteness', () => {
  it('fills supported Priya fields and reports honest gaps', () => {
    const persona = loadPersona('priya-strong');
    const report = assessVidexCompleteness({
      profile: toProfile(persona),
      caseFacts: toCaseFacts(persona),
      today: new Date('2026-06-11T00:00:00.000Z'),
    });

    expect(report.total).toBe(37);
    expect(report.filled).toBeGreaterThan(20);
    expect(report.filled).toBeLessThan(37);
    expect(report.values.applicantSurname).toBe('SHARMA');
    expect(report.values.applicantFirstname).toBe('PRIYA');
    expect(report.values.travelDocNumber).toBe('M1234567');
    expect(report.values.travelDocValidUntil).toBe('22/08/2031');
    expect(report.values.applicantDestinations).toBe('Germany');
    expect(report.values.dateOfArrival).toBe('01/10/2026');
    expect(report.values.townAndDateTime).toBe('Bengaluru, 11/06/2026');
    expect(report.missing.map((m) => m.fieldNumber)).toContain(14);
    expect(report.missing.map((m) => m.fieldNumber)).toContain(37);
  });

  it('marks mapped fields missing when their source fact is absent', () => {
    const persona = loadPersona('priya-strong');
    const profile = toProfile(persona);
    const report = assessVidexCompleteness({
      profile: { ...profile, passportNumber: undefined },
      caseFacts: toCaseFacts(persona),
      today: new Date('2026-06-11T00:00:00.000Z'),
    });

    expect(report.values.travelDocNumber).toBeUndefined();
    expect(report.missing).toContainEqual(
      expect.objectContaining({
        fieldNumber: 13,
        label: 'Number of travel document',
        sourcePaths: ['passportNumber'],
      }),
    );
  });
});
