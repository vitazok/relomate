import { notFound, redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/auth/session';
import { makeDraftRepository } from '@/lib/drafting/repository';
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

  const draft = await makeDraftRepository().getById(draftId);
  if (!draft || draft.caseId !== caseId) notFound();
  if (draft.userId !== userId) redirect('/');
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
      <DraftReviewForm caseId={caseId} draftId={draftId} initial={draft.content} />
    </div>
  );
}
