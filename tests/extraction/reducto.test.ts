import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/env', () => ({ env: { REDUCTO_API_KEY: 'test-key' } }));

import { makeReductoProvider } from '@/lib/extraction/reducto';

const doc = { body: new Uint8Array([1, 2, 3]), contentType: 'application/pdf' };
const schema = {
  spineItemId: 'passport',
  fields: { surname: { type: 'string' as const, sensitive: false } },
};

describe('ReductoProvider.extract', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('POSTs to the extract endpoint with auth and maps fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { surname: 'Sharma' }, confidence: { surname: 0.99 } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const p = makeReductoProvider();
    const r = await p.extract(doc, schema);

    expect(fetchMock).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    expect(r.provider).toBe('reducto');
    expect(r.fields.surname!.value).toBe('Sharma');
    expect(r.fields.surname!.confidence).toBe(0.99);
  });

  it('throws on a non-ok response so withFallback can catch it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'err' }));
    const p = makeReductoProvider();
    await expect(p.extract(doc, schema)).rejects.toThrow();
  });

  it('defaults a field the provider omitted to confidence 0 (matches vision provider)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: {}, confidence: {} }) }),
    );
    const p = makeReductoProvider();
    const r = await p.extract(doc, schema);
    expect(r.fields.surname).toEqual({ value: null, confidence: 0 });
  });
});

describe('ReductoProvider without an API key', () => {
  it('throws a clear error when REDUCTO_API_KEY is missing', async () => {
    vi.resetModules();
    vi.doMock('@/lib/env', () => ({ env: { REDUCTO_API_KEY: undefined } }));
    const { makeReductoProvider: makeNoKey } = await import('@/lib/extraction/reducto');
    vi.stubGlobal('fetch', vi.fn());
    const p = makeNoKey();
    await expect(p.extract(doc, schema)).rejects.toThrow(/REDUCTO_API_KEY/);
    vi.doUnmock('@/lib/env');
    vi.resetModules();
  });
});
