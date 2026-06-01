import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validateLeafPath, validateLeafValue, setAtPath, getAtPath, listLeafPaths } from '@/lib/case/paths';

describe('listLeafPaths', () => {
  it('enumerates the canonical case-fact leaf paths', () => {
    const paths = listLeafPaths().map((p) => p.path);
    expect(paths).toContain('employment.annualGrossSalaryEur');
    expect(paths).toContain('education.highestDegree');
    expect(paths).toContain('education.fieldOfStudy');
    expect(paths).toContain('education.institution');
    expect(paths).toContain('employment.employerCity');
    expect(paths).toContain('target.intendedVisa');
  });

  it('includes profile leaf paths', () => {
    const paths = listLeafPaths().map((p) => p.path);
    expect(paths).toContain('nationality');
    expect(paths).toContain('passportNumber');
  });

  it('includes the family composition leaves (and only those, not identity)', () => {
    const paths = listLeafPaths().map((p) => p.path);
    expect(paths).toContain('family.maritalStatus');
    expect(paths).toContain('family.spousePresent');
    expect(paths).toContain('family.childrenCount');
    // composition-only slice: no per-member identity leaves yet
    expect(paths).not.toContain('family.spouse.fullName');
    expect(paths).not.toContain('family.spouse.passportNumber');
  });

  it('does NOT include invented/guessed paths', () => {
    const paths = listLeafPaths().map((p) => p.path);
    expect(paths).not.toContain('education.level');
    expect(paths).not.toContain('education.subject');
    expect(paths).not.toContain('employment.jobCity');
    expect(paths).not.toContain('education.institutionName');
  });

  it('surfaces enum options for enum leaves', () => {
    const degree = listLeafPaths().find((p) => p.path === 'education.highestDegree');
    expect(degree?.enumValues).toContain('master_eqf7');
    expect(degree?.enumValues).toContain('bachelor_eqf6');
  });

  it('every enumerated path resolves via validateLeafPath (no drift)', () => {
    for (const { path } of listLeafPaths()) {
      expect(() => validateLeafPath(path)).not.toThrow();
    }
  });
});

describe('validateLeafPath', () => {
  it('resolves a valid case-facts path to a Zod inner schema', () => {
    const r = validateLeafPath('employment.annualGrossSalaryEur');
    expect(r.kind).toBe('case');
    expect(r.inner).toBeInstanceOf(z.ZodNumber);
  });

  it('resolves a valid profile path to a Zod inner schema', () => {
    const r = validateLeafPath('nationality');
    expect(r.kind).toBe('profile');
    expect(r.inner).toBeDefined();
  });

  it('rejects an unknown top-level segment', () => {
    expect(() => validateLeafPath('nonsense.field')).toThrow(/unknown path/i);
  });

  it('rejects a path that resolves to a non-leaf object', () => {
    expect(() => validateLeafPath('employment')).toThrow(/not a leaf/i);
  });

  it('rejects an unknown nested segment', () => {
    expect(() => validateLeafPath('employment.notAField')).toThrow(/unknown path/i);
  });

  it('rejects paths with empty segments', () => {
    expect(() => validateLeafPath('employment.')).toThrow(/invalid path/i);
    expect(() => validateLeafPath('.employment')).toThrow(/invalid path/i);
    expect(() => validateLeafPath('employment..salary')).toThrow(/invalid path/i);
  });
});

describe('validateLeafValue', () => {
  it('accepts a value matching the inner schema', () => {
    const { inner } = validateLeafPath('employment.annualGrossSalaryEur');
    expect(() => validateLeafValue(inner, 48500)).not.toThrow();
  });

  it('rejects a value of wrong type', () => {
    const { inner } = validateLeafPath('employment.annualGrossSalaryEur');
    expect(() => validateLeafValue(inner, 'forty thousand')).toThrow();
  });

  it('rejects an unknown enum value', () => {
    const { inner } = validateLeafPath('employment.contractType');
    expect(() => validateLeafValue(inner, 'casual')).toThrow();
  });

  it('accepts null as a value (clearing a field)', () => {
    const { inner } = validateLeafPath('employment.annualGrossSalaryEur');
    expect(() => validateLeafValue(inner, null)).not.toThrow();
  });
});

describe('setAtPath / getAtPath', () => {
  it('immutably sets a leaf in case facts', () => {
    const before = {};
    const after = setAtPath(before, 'employment.annualGrossSalaryEur', { value: 48500 });
    expect(before).toEqual({});
    expect(getAtPath(after, 'employment.annualGrossSalaryEur')).toEqual({ value: 48500 });
  });

  it('preserves sibling values', () => {
    const before: Record<string, unknown> = {
      employment: { employerName: { value: 'Acme' } },
    };
    const after = setAtPath(before, 'employment.annualGrossSalaryEur', { value: 48500 });
    expect((after.employment as Record<string, unknown>).employerName).toEqual({ value: 'Acme' });
    expect((after.employment as Record<string, unknown>).annualGrossSalaryEur).toEqual({ value: 48500 });
  });

  it('returns undefined for a missing leaf', () => {
    expect(getAtPath({}, 'employment.annualGrossSalaryEur')).toBeUndefined();
  });

  it('synthesises missing intermediate objects on set', () => {
    const after = setAtPath({}, 'education.anabinStatus', { value: 'H+' });
    expect(after).toEqual({ education: { anabinStatus: { value: 'H+' } } });
  });
});
