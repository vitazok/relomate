import { describe, it, expect } from 'vitest';
import { makeFakeStorageAdapter, documentKey, sanitizeFileName } from '@/lib/storage/r2';

describe('FakeStorageAdapter', () => {
  it('round-trips put → head → get → delete', async () => {
    const s = makeFakeStorageAdapter();
    const key = 'cases/c1/documents/d1/passport.pdf';
    const presigned = await s.presignUpload(key, 'application/pdf');
    expect(presigned.key).toBe(key);

    await s.__putForTest(key, new Uint8Array([1, 2, 3]), 'application/pdf');

    const head = await s.headObject(key);
    expect(head).toEqual({ size: 3, contentType: 'application/pdf' });

    const got = await s.getObject(key);
    expect(Array.from(got.body)).toEqual([1, 2, 3]);

    await s.deleteObject(key);
    expect(await s.headObject(key)).toBeNull();
  });

  it('headObject returns null for a missing key', async () => {
    const s = makeFakeStorageAdapter();
    expect(await s.headObject('nope')).toBeNull();
  });
});

describe('key helpers', () => {
  it('builds the document key', () => {
    expect(documentKey('c1', 'd1', 'My Passport.pdf')).toBe(
      'cases/c1/documents/d1/My_Passport.pdf',
    );
  });

  it('sanitizes unsafe filename characters', () => {
    expect(sanitizeFileName('a b/c\\d?.pdf')).toBe('a_b_c_d_.pdf');
  });
});
