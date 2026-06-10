import { NextResponse } from 'next/server';
import { ensureAnonymousSession } from '@/lib/auth/session';
import { makeRepository } from '@/lib/case/repository';
import { getPersonaCaseDefaults, seedCaseFromPersona } from '@/lib/personas/seed';
import { db } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { userId } = await ensureAnonymousSession();
  const repo = makeRepository(db);
  const personaId = new URL(req.url).searchParams.get('persona');
  const personaDefaults = personaId ? getPersonaCaseDefaults(personaId) : {};
  const { caseId } = await repo.createCase({
    userId,
    visaType: 'eu_blue_card_germany',
    targetCountry: 'DE',
    targetConsulate: personaDefaults.targetConsulate ?? 'bengaluru',
  });

  // Optional persona seeding for multi-persona testing: /api/case/new?persona=<id>.
  // Unknown ids are a no-op (the case stays empty). See data/personas/*.json.
  if (personaId) {
    await seedCaseFromPersona(repo, caseId, personaId);
  }

  return NextResponse.redirect(new URL(`/case/${caseId}`, req.url), { status: 303 });
}
