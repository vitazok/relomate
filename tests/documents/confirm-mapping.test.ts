import { describe, it, expect } from 'vitest';
import { buildConfirmUpdates } from '@/lib/documents/confirm-mapping';

// Uses the REAL passport extraction schema from config/rules/documents.yaml.
describe('buildConfirmUpdates (passport)', () => {
  const base = [
    { key: 'surname', value: 'Sharma', edited: false },
    { key: 'givenNames', value: 'Priya', edited: false },
    { key: 'passportNumber', value: 'X1234567', edited: false },
    { key: 'dateOfBirth', value: '1990-04-12', edited: false },
    { key: 'nationality', value: 'India', edited: false },
    { key: 'dateOfExpiry', value: '2030-09-01', edited: false },
  ];

  it('maps fields to bare leaf paths with transforms applied', () => {
    const { updates, perPathSource, unmapped } = buildConfirmUpdates('passport', base);
    expect(updates).toMatchObject({
      fullName: 'Priya Sharma',
      passportNumber: 'X1234567',
      dateOfBirth: '1990-04-12',
      nationality: 'IN',
      passportExpiry: '2030-09-01',
    });
    expect(unmapped).toEqual([]);
    expect(perPathSource.passportNumber).toBe('document');
  });

  it('marks a path user_corrected when any contributing field was edited', () => {
    const fields = base.map((f) => (f.key === 'givenNames' ? { ...f, value: 'Priyanka', edited: true } : f));
    const { updates, perPathSource } = buildConfirmUpdates('passport', fields);
    expect(updates.fullName).toBe('Priyanka Sharma');
    expect(perPathSource.fullName).toBe('user_corrected');
    expect(perPathSource.passportNumber).toBe('document');
  });

  it('leaves a field unmapped when its transform cannot resolve', () => {
    const fields = base.map((f) => (f.key === 'nationality' ? { ...f, value: 'Atlantis', edited: true } : f));
    const { updates, unmapped } = buildConfirmUpdates('passport', fields);
    expect(updates.nationality).toBeUndefined();
    expect(unmapped).toContain('nationality');
  });

  it('ignores fields with no target', () => {
    const fields = [...base, { key: 'mystery', value: 'z', edited: false }];
    const { updates } = buildConfirmUpdates('passport', fields);
    expect(Object.keys(updates)).not.toContain('mystery');
  });

  it('normalizes a non-ISO date via the field transform', () => {
    const fields = base.map((f) => (f.key === 'dateOfBirth' ? { ...f, value: '15 JAN 1990', edited: true } : f));
    const { updates, perPathSource } = buildConfirmUpdates('passport', fields);
    expect(updates.dateOfBirth).toBe('1990-01-15');
    expect(perPathSource.dateOfBirth).toBe('user_corrected');
  });

  it('leaves an unparseable date unmapped', () => {
    const fields = base.map((f) => (f.key === 'dateOfBirth' ? { ...f, value: 'whenever', edited: true } : f));
    const { updates, unmapped } = buildConfirmUpdates('passport', fields);
    expect(updates.dateOfBirth).toBeUndefined();
    expect(unmapped).toContain('dateOfBirth');
  });
});
