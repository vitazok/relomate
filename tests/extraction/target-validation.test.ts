import { describe, it, expect } from 'vitest';
import { assertValidTargets } from '@/lib/extraction/schema';
import type { ExtractionSchema } from '@/lib/extraction/types';

describe('assertValidTargets', () => {
  it('passes when every target resolves to a real leaf path', () => {
    const schemas = new Map<string, ExtractionSchema>([
      ['passport', {
        spineItemId: 'passport',
        fields: {
          passportNumber: { type: 'string', sensitive: true, target: 'passportNumber' },
          dateOfBirth: { type: 'date', sensitive: false, target: 'dateOfBirth' },
        },
      }],
    ]);
    expect(() => assertValidTargets(schemas)).not.toThrow();
  });

  it('throws when a target is not a valid leaf path', () => {
    const schemas = new Map<string, ExtractionSchema>([
      ['passport', {
        spineItemId: 'passport',
        fields: { surname: { type: 'string', sensitive: false, target: 'profile.fullName' } },
      }],
    ]);
    // 'profile.fullName' is NOT a valid path (profile leaves resolve at the root, e.g. 'fullName').
    expect(() => assertValidTargets(schemas)).toThrow(/profile\.fullName/);
  });
});
