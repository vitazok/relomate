import { describe, it, expect, beforeEach } from 'vitest';
import {
  getExtractionSchema,
  listExtractableItems,
  getDocumentSpine,
  sensitiveKeys,
  __resetExtractionSchemaCacheForTests,
} from '@/lib/extraction/schema';

describe('extraction schema loader', () => {
  beforeEach(() => __resetExtractionSchemaCacheForTests());

  it('returns a schema for passport with a sensitive field flagged', () => {
    const s = getExtractionSchema('passport');
    expect(s).not.toBeNull();
    if (!s) throw new Error('unreachable');
    expect(s.fields['surname']).toEqual({
      type: 'string',
      sensitive: false,
      target: 'fullName',
      transform: 'composeFullName',
      part: 'surname',
    });
    expect(s.fields['passportNumber']?.sensitive).toBe(true);
  });

  it('returns null for an item with no extraction block', () => {
    expect(getExtractionSchema('biometric_photos')).toBeNull();
  });

  it('returns null for an unknown id', () => {
    expect(getExtractionSchema('does_not_exist')).toBeNull();
  });

  it('lists only items that have an extraction block', () => {
    const ids = listExtractableItems();
    expect(ids).toContain('passport');
    expect(ids).not.toContain('biometric_photos');
  });

  it('sensitiveKeys returns only the fields flagged sensitive', () => {
    const s = getExtractionSchema('passport');
    if (!s) throw new Error('unreachable');
    const sensitive = sensitiveKeys(s);
    expect(sensitive).toEqual(['passportNumber']);
    expect(sensitive).not.toContain('surname');
  });

  it('getDocumentSpine includes extractable and non-extractable items', () => {
    const spine = getDocumentSpine();
    expect(spine.length).toBeGreaterThan(0);
    expect(spine.some((item) => item.id === 'passport' && item.section === 'identity')).toBe(true);
    expect(spine.some((item) => item.id === 'biometric_photos')).toBe(true);
  });
});
