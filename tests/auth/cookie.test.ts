import { describe, it, expect, beforeAll } from 'vitest';
import { encodeSession, decodeSession, type SessionPayload } from '@/lib/auth/cookie';

describe('cookie', () => {
  beforeAll(() => {
    // env validation runs at import time; AUTH_SECRET must be set.
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? 'a'.repeat(32);
  });

  it('round-trips a valid payload', () => {
    const payload: SessionPayload = {
      userId: '11111111-1111-1111-1111-111111111111',
      iat: Date.now() - 1000,
      exp: Date.now() + 60_000,
    };
    const token = encodeSession(payload);
    const decoded = decodeSession(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.userId).toBe(payload.userId);
    expect(decoded?.iat).toBe(payload.iat);
    expect(decoded?.exp).toBe(payload.exp);
  });

  it('rejects a tampered body', () => {
    const payload: SessionPayload = {
      userId: '11111111-1111-1111-1111-111111111111',
      iat: Date.now(),
      exp: Date.now() + 60_000,
    };
    const token = encodeSession(payload);
    const [, sig] = token.split('.');
    const tampered = `aGVsbG8.${sig}`;
    expect(decodeSession(tampered)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const payload: SessionPayload = {
      userId: '11111111-1111-1111-1111-111111111111',
      iat: Date.now(),
      exp: Date.now() + 60_000,
    };
    const token = encodeSession(payload);
    const [body] = token.split('.');
    const tampered = `${body}.aGVsbG93b3JsZA`;
    expect(decodeSession(tampered)).toBeNull();
  });

  it('rejects an expired payload', () => {
    const expired: SessionPayload = {
      userId: '11111111-1111-1111-1111-111111111111',
      iat: Date.now() - 60_000,
      exp: Date.now() - 1,
    };
    const token = encodeSession(expired);
    expect(decodeSession(token)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(decodeSession('no-dot')).toBeNull();
    expect(decodeSession('aaaa.bbb!!!')).toBeNull();
    expect(decodeSession('')).toBeNull();
  });

  it('rejects payload without userId', async () => {
    // Re-encode without userId to verify the runtime shape check
    const { encodeSession: enc } = await import('@/lib/auth/cookie');
    const cryptoMod = await import('node:crypto');
    const body = Buffer.from(JSON.stringify({ iat: Date.now(), exp: Date.now() + 60_000 }))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const sig = cryptoMod
      .createHmac('sha256', process.env.AUTH_SECRET!)
      .update(body)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const handcrafted = `${body}.${sig}`;
    expect(decodeSession(handcrafted)).toBeNull();
    expect(typeof enc).toBe('function');
  });

  it('returns null for signature length mismatch (no throw)', () => {
    const payload: SessionPayload = {
      userId: '11111111-1111-1111-1111-111111111111',
      iat: Date.now(),
      exp: Date.now() + 60_000,
    };
    const token = encodeSession(payload);
    const [body] = token.split('.');
    expect(decodeSession(`${body}.short`)).toBeNull();
  });
});
