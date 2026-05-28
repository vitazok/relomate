import { NextResponse } from 'next/server';
import { ensureAnonymousSession } from '@/lib/auth/session';
import { makeRepository } from '@/lib/case/repository';
import { db } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { userId } = await ensureAnonymousSession();
  const repo = makeRepository(db);
  const { caseId } = await repo.createCase({
    userId,
    visaType: 'eu_blue_card_germany',
    targetCountry: 'DE',
    targetConsulate: 'bengaluru',
  });
  return NextResponse.redirect(new URL(`/case/${caseId}`, req.url), { status: 303 });
}
