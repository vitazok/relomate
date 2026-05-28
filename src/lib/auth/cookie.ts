import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

export type SessionPayload = {
  userId: string;
  iat: number;
  exp: number;
};

const ENCODER = new TextEncoder();

function b64urlEncode(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(input: string): Buffer {
  const padded = input
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64');
}

function sign(data: string): string {
  const mac = createHmac('sha256', env.AUTH_SECRET).update(data).digest();
  return b64urlEncode(mac);
}

export function encodeSession(payload: SessionPayload): string {
  const body = b64urlEncode(ENCODER.encode(JSON.stringify(payload)));
  const sig = sign(body);
  return `${body}.${sig}`;
}

export function decodeSession(token: string): SessionPayload | null {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(b64urlDecode(body).toString('utf8'));
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as SessionPayload).userId !== 'string' ||
    typeof (parsed as SessionPayload).exp !== 'number'
  ) {
    return null;
  }
  const p = parsed as SessionPayload;
  if (p.exp < Date.now()) return null;
  return p;
}
