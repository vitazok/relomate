import { describe, it, expect } from 'vitest';
import { ProvenanceSourceEnum, FieldSchema } from '@/lib/case/schema';
import { z } from 'zod';

describe('FieldSchema', () => {
  const StringField = FieldSchema(z.string());

  it('accepts a fully-populated leaf', () => {
    const ok = StringField.safeParse({
      value: 'Priya Sharma',
      source: 'user_stated',
      sourceTurnId: '00000000-0000-4000-8000-000000000000',
      confidence: 0.9,
      updatedAt: '2026-05-27T12:00:00.000Z',
    });
    expect(ok.success).toBe(true);
  });

  it('accepts null value', () => {
    const ok = StringField.safeParse({
      value: null,
      source: 'inferred',
      sourceTurnId: null,
      confidence: 0.5,
      updatedAt: '2026-05-27T12:00:00.000Z',
    });
    expect(ok.success).toBe(true);
  });

  it('rejects confidence > 1', () => {
    const bad = StringField.safeParse({
      value: 'x',
      source: 'user_stated',
      sourceTurnId: null,
      confidence: 1.5,
      updatedAt: '2026-05-27T12:00:00.000Z',
    });
    expect(bad.success).toBe(false);
  });

  it('rejects unknown source', () => {
    const bad = StringField.safeParse({
      value: 'x',
      source: 'made_up',
      sourceTurnId: null,
      confidence: 0.5,
      updatedAt: '2026-05-27T12:00:00.000Z',
    });
    expect(bad.success).toBe(false);
  });

  it('exposes the canonical source enum', () => {
    expect(ProvenanceSourceEnum.options).toEqual([
      'user_stated',
      'inferred',
      'document',
      'user_corrected',
      'system',
    ]);
  });
});
