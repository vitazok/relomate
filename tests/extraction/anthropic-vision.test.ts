import { describe, it, expect, vi } from 'vitest';

const generateObject = vi.fn();
vi.mock('ai', () => ({ generateObject: (...a: unknown[]) => generateObject(...a) }));
vi.mock('@/lib/ai/provider', () => ({
  anthropic: (id: string) => ({ id }),
  MODEL_ID: 'claude-sonnet-4-6',
  VISION_MODEL_ID: 'claude-haiku-4-5',
}));

import { makeAnthropicVisionProvider } from '@/lib/extraction/anthropic-vision';

const doc = { body: new Uint8Array([1, 2]), contentType: 'image/png' };
const schema = {
  spineItemId: 'passport',
  fields: {
    surname: { type: 'string' as const, sensitive: false },
    dateOfBirth: { type: 'date' as const, sensitive: false },
  },
};

describe('AnthropicVisionProvider.extract', () => {
  it('maps generateObject output to ExtractionResult fields', async () => {
    generateObject.mockResolvedValueOnce({
      object: {
        fields: {
          surname: { value: 'Sharma', confidence: 0.95 },
          dateOfBirth: { value: '1990-01-02', confidence: 0.9 },
        },
      },
    });
    const p = makeAnthropicVisionProvider();
    const r = await p.extract(doc, schema);
    expect(r.provider).toBe('anthropic_vision');
    expect(r.fields.surname!.value).toBe('Sharma');
    expect(r.fields.dateOfBirth!.confidence).toBe(0.9);
    expect(r.modelVersion).toBe('claude-sonnet-4-6');
  });

  it('defaults a requested field the model skipped to null/0, and drops extra keys', async () => {
    generateObject.mockResolvedValueOnce({
      object: {
        fields: {
          surname: { value: 'Sharma', confidence: 0.95 },
          // dateOfBirth omitted by the model
          hallucinated: { value: 'nope', confidence: 0.99 },
        },
      },
    });
    const p = makeAnthropicVisionProvider();
    const r = await p.extract(doc, schema);
    expect(r.fields.surname!.value).toBe('Sharma');
    expect(r.fields.dateOfBirth).toEqual({ value: null, confidence: 0 });
    expect(r.fields.hallucinated).toBeUndefined();
    expect(Object.keys(r.fields).sort()).toEqual(['dateOfBirth', 'surname']);
  });
});

describe('AnthropicVisionProvider.classify', () => {
  it('returns the matched spine id', async () => {
    generateObject.mockResolvedValueOnce({
      object: { spineItemId: 'passport', confidence: 0.88 },
    });
    const p = makeAnthropicVisionProvider();
    const r = await p.classify(doc, [{ id: 'passport', label: 'Valid passport', section: 'identity' }]);
    expect(r.spineItemId).toBe('passport');
    expect(r.confidence).toBe(0.88);
  });
});
