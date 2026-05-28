import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { decodeSession, encodeSession } from './cookie';
import { env } from '@/lib/env';

export const VISA_SESSION_COOKIE = 'visa_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function buildCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

/** RSC-safe. Returns null on missing/invalid/expired cookie. Never sets the cookie. */
export async function getCurrentUserId(): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(VISA_SESSION_COOKIE)?.value;
  if (!raw) return null;
  return decodeSession(raw)?.userId ?? null;
}

/** Route-handler / server-action only. Throws if no valid session. */
export async function requireAuthedUserId(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('not authenticated');
  const [row] = await db
    .select({ isAnonymous: schema.users.isAnonymous })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!row || row.isAnonymous) throw new Error('not authenticated');
  return userId;
}

/** Route-handler / server-action only. Mints anon row if no valid cookie. */
export async function ensureAnonymousSession(): Promise<{ userId: string; isNew: boolean }> {
  const existing = await getCurrentUserId();
  if (existing) {
    const [row] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, existing));
    if (row) return { userId: existing, isNew: false };
  }

  const [org] = await db
    .insert(schema.organizations)
    .values({ name: 'Anonymous', kind: 'individual_anon' })
    .returning({ id: schema.organizations.id });
  if (!org) throw new Error('failed to insert organization');
  const [user] = await db
    .insert(schema.users)
    .values({ organizationId: org.id, isAnonymous: true, lastSeenAt: new Date() })
    .returning({ id: schema.users.id });
  if (!user) throw new Error('failed to insert user');

  await writeAuthedSession(user.id);
  return { userId: user.id, isNew: true };
}

/** Route-handler / server-action only. Writes a fresh signed cookie. */
export async function writeAuthedSession(userId: string): Promise<void> {
  const jar = await cookies();
  const now = Date.now();
  jar.set(
    VISA_SESSION_COOKIE,
    encodeSession({ userId, iat: now, exp: now + SESSION_TTL_MS }),
    buildCookieOptions(),
  );
}

/** Route-handler / server-action only. */
export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(VISA_SESSION_COOKIE);
}
