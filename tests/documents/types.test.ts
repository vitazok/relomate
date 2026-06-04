import { describe, it, expect } from 'vitest';
import {
  DocumentStatusEnum,
  ExtractedDataSchema,
  ClassificationSchema,
} from '@/lib/documents/types';

describe('document types', () => {
  it('enumerates the status lifecycle', () => {
    expect(DocumentStatusEnum.options).toEqual([
      'pending_upload',
      'uploaded',
      'classifying',
      'extracting',
      'awaiting_confirmation',
      'failed',
    ]);
  });

  it('validates extracted data with per-field confidence', () => {
    const r = ExtractedDataSchema.safeParse({
      fields: { surname: { value: 'Sharma', confidence: 0.97 } },
      provider: 'anthropic_vision',
      modelVersion: 'claude-haiku-4-5',
    });
    expect(r.success).toBe(true);
  });

  it('rejects confidence outside 0..1', () => {
    const r = ExtractedDataSchema.safeParse({
      fields: { x: { value: 1, confidence: 2 } },
      provider: 'reducto',
      modelVersion: 'v1',
    });
    expect(r.success).toBe(false);
  });

  it('validates classification', () => {
    expect(
      ClassificationSchema.safeParse({ type: 'passport', confidence: 0.9 }).success,
    ).toBe(true);
  });
});
