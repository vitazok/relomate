import { describe, it, expect } from 'vitest';
import { withFallback, makeFakeExtractionProvider } from '@/lib/extraction';
import type { ExtractionProvider } from '@/lib/extraction/types';

const schema = {
  spineItemId: 'passport',
  fields: { surname: { type: 'string' as const, sensitive: false } },
};
const doc = { body: new Uint8Array([1]), contentType: 'application/pdf' };

describe('withFallback', () => {
  it('uses primary when it succeeds', async () => {
    const primary = makeFakeExtractionProvider({
      classifyResult: { spineItemId: 'passport', confidence: 0.9 },
      extractResult: { fields: { surname: { value: 'A', confidence: 0.9 } }, provider: 'reducto', modelVersion: 'r' },
    });
    const fallback = makeFakeExtractionProvider({ throwOnExtract: true });
    const p = withFallback(primary, fallback);
    const r = await p.extract(doc, schema);
    expect(r.provider).toBe('reducto');
  });

  it('falls back when primary throws', async () => {
    const primary: ExtractionProvider = makeFakeExtractionProvider({ throwOnExtract: true });
    const fallback = makeFakeExtractionProvider({
      extractResult: { fields: { surname: { value: 'B', confidence: 0.8 } }, provider: 'anthropic_vision', modelVersion: 'h' },
    });
    const p = withFallback(primary, fallback);
    const r = await p.extract(doc, schema);
    expect(r.provider).toBe('anthropic_vision');
    expect(r.fields.surname!.value).toBe('B');
  });

  it('falls back on classify too', async () => {
    const primary = makeFakeExtractionProvider({ throwOnClassify: true });
    const fallback = makeFakeExtractionProvider({ classifyResult: { spineItemId: 'passport', confidence: 0.7 } });
    const p = withFallback(primary, fallback);
    const r = await p.classify(doc, []);
    expect(r.spineItemId).toBe('passport');
    expect(r.confidence).toBe(0.7);
  });
});
