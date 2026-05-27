import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validateLeafPath, validateLeafValue, setAtPath, getAtPath } from '@/lib/case/paths';

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
