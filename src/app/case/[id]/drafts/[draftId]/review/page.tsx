import { notFound, redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/auth/session';
import { canAccessCase } from '@/lib/auth/authorization';
import { makeDraftRepository } from '@/lib/drafting/repository';
import { db } from '@/lib/db/client';
import { DraftReviewForm } from './DraftReviewForm';
import { DRAFT_TYPE_LABELS } from '@/lib/drafting/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function DraftReviewPage({
  params,
}: {
  params: Promise<{ id: string; draftId: string }>;
}) {
  const { id: caseId, draftId } = await params;
  const userId = await getCurrentUserId();
  if (!userId) redirect('/signin');

  const draftRepo = makeDraftRepository();
  const draft = await draftRepo.getById(draftId);
  if (!draft || draft.caseId !== caseId) notFound();
  if (!(await canAccessCase(db, { userId, caseId, action: 'review_draft' }))) redirect('/');
  const versionHistory = (await draftRepo.listByCase(caseId))
    .filter((d) => d.type === draft.type)
    .sort((a, b) => b.version - a.version)
    .map((d) => ({
      id: d.id,
      version: d.version,
      status: d.status,
      isCurrent: d.id === draft.id,
      reviewHref:
        d.status === 'ready_for_review' ? `/case/${caseId}/drafts/${d.id}/review` : null,
    }));
  const latest = versionHistory[0];
  if (latest && latest.id !== draft.id) {
    redirect(latest.reviewHref ?? `/case/${caseId}`);
  }
  if (draft.status !== 'ready_for_review') redirect(`/case/${caseId}`);
  if (!draft.content || draft.content.type !== draft.type) notFound();

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <a href={`/case/${caseId}`} className="text-xs text-zinc-500 hover:underline">
        Back to case
      </a>
      <h1 className="mt-2 mb-4 text-lg font-medium text-zinc-900">
        Review {DRAFT_TYPE_LABELS[draft.type].toLowerCase()}
      </h1>
      <DraftReviewForm
        caseId={caseId}
        draftId={draftId}
        initial={draft.content}
        version={draft.version}
        versionHistory={versionHistory}
      />
    </div>
  );
}
