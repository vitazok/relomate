import { notFound, redirect } from 'next/navigation';
import { eq, asc } from 'drizzle-orm';
import { Layout } from '@/components/workspace/Layout';
import { makeRepository } from '@/lib/case/repository';
import { getCurrentUserId } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { hydrateMessages } from '@/components/workspace/hydrate-messages';
import { evaluateEligibility } from '@/lib/rules/eligibility';
import { computeJourneyProgress } from '@/lib/journey/compute';
import { getDocumentRules } from '@/lib/rules/loader';
import { makeDocumentRepository } from '@/lib/documents/repository';
import type { Profile } from '@/lib/profile/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getCurrentUserId();
  if (!userId) redirect('/');

  const repo = makeRepository();
  let loaded;
  try {
    loaded = await repo.loadCase(id);
  } catch {
    notFound();
  }

  if (loaded.case.userId !== userId) redirect('/');

  const recent = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.threadId, loaded.threadId))
    .orderBy(asc(schema.messages.createdAt))
    .limit(50);

  const initialMessages = hydrateMessages(recent);

  const profile: Profile = { schemaVersion: 1 };
  const today = new Date();
  const verdict = evaluateEligibility(loaded.caseFacts, profile, today);
  const uploadedDocuments = await makeDocumentRepository(db).listByCase(loaded.case.id);
  const progress = computeJourneyProgress(
    loaded.caseFacts,
    profile,
    getDocumentRules(),
    verdict,
    today,
    uploadedDocuments,
    loaded.case.id,
  );

  return (
    <Layout
      caseId={loaded.case.id}
      progress={progress}
      eligibilityVerdict={verdict}
      initialMessages={initialMessages}
    />
  );
}
