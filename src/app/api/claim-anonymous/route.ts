import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { auth, signOut } from '@/lib/auth/config';
import { db } from '@/lib/db/client';
import {
  VISA_SESSION_COOKIE,
  writeAuthedSession,
} from '@/lib/auth/session';
import { decodeSession } from '@/lib/auth/cookie';
import { promoteToAuthed } from '@/lib/auth/merge';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await auth();
  const verifiedEmail = session?.user?.email?.toLowerCase().trim();
  if (!verifiedEmail) {
    return NextResponse.redirect(new URL('/signin?error=verification', req.url));
  }

  const jar = await cookies();
  const raw = jar.get(VISA_SESSION_COOKIE)?.value;
  const anonymousUserId = raw ? decodeSession(raw)?.userId ?? null : null;

  const { targetUserId } = await promoteToAuthed(db, {
    anonymousUserId,
    email: verifiedEmail,
  });

  await writeAuthedSession(targetUserId);
  await signOut({ redirect: false });

  return NextResponse.redirect(new URL('/', req.url));
}
