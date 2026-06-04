import { describe, it, expect, vi } from 'vitest';
import { uploadDocument } from '@/components/workspace/DocumentUpload';

describe('uploadDocument', () => {
  it('runs upload-url → R2 PUT → finalize in order', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/upload-url')) {
        return { ok: true, json: async () => ({ documentId: 'doc1', uploadUrl: 'https://r2/put' }) } as Response;
      }
      if (url === 'https://r2/put') return { ok: true } as Response;
      if (url.endsWith('/finalize')) return { ok: true, json: async () => ({ ok: true }) } as Response;
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([new Uint8Array([1, 2, 3])], 'passport.pdf', { type: 'application/pdf' });
    const documentId = await uploadDocument('case1', file);

    expect(documentId).toBe('doc1');
    expect(calls[0]).toBe('POST /api/documents/upload-url');
    expect(calls[1]).toBe('PUT https://r2/put');
    expect(calls[2]).toBe('POST /api/documents/doc1/finalize');
  });

  it('throws if R2 PUT fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/upload-url')) return { ok: true, json: async () => ({ documentId: 'd', uploadUrl: 'https://r2/put' }) } as Response;
      return { ok: false, status: 500 } as Response;
    }));
    const file = new File([new Uint8Array([1])], 'p.pdf', { type: 'application/pdf' });
    await expect(uploadDocument('c', file)).rejects.toThrow();
  });
});
