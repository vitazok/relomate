import { notFound, redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/auth/session';
import { makeDocumentRepository } from '@/lib/documents/repository';
import { makeR2StorageAdapter } from '@/lib/storage/r2';
import { getExtractionSchema } from '@/lib/extraction/schema';
import { getConfidenceBands } from '@/lib/documents/review-config';
import { buildReviewRows } from '@/lib/documents/review-view-model';
import { ReviewForm } from './ReviewForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string; docId: string }>;
}) {
  const { id: caseId, docId } = await params;
  const userId = await getCurrentUserId();
  if (!userId) redirect('/signin');

  const docs = makeDocumentRepository();
  const doc = await docs.getById(docId);
  if (!doc || doc.caseId !== caseId) notFound();
  if (doc.userId !== userId) redirect('/');
  if (doc.status !== 'awaiting_confirmation') redirect(`/case/${caseId}`);

  const sourceUrl = await makeR2StorageAdapter().presignDownload(doc.r2Key);
  const schema = doc.spineItemId ? getExtractionSchema(doc.spineItemId) : null;
  const rows = buildReviewRows(doc.extracted?.fields ?? {}, schema, getConfidenceBands());

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <a href={`/case/${caseId}`} className="text-xs text-zinc-500 hover:underline">
        ← Back to case
      </a>
      <h1 className="mt-2 mb-4 text-lg font-medium text-zinc-900">Review extracted details</h1>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <section className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <div className="mb-2 text-xs font-medium text-zinc-500">Source document</div>
          {doc.contentType.startsWith('image/') ? (
            // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL, not a static asset
            <img src={sourceUrl} alt={doc.fileName} className="max-h-[70vh] w-full object-contain" />
          ) : (
            <object data={sourceUrl} type={doc.contentType} className="h-[70vh] w-full">
              <a href={sourceUrl} target="_blank" rel="noreferrer" className="text-sm text-blue-600 underline">
                Open original ↗
              </a>
            </object>
          )}
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block text-xs text-blue-600 underline"
          >
            Open original ↗
          </a>
        </section>
        <ReviewForm caseId={caseId} documentId={docId} rows={rows} />
      </div>
    </div>
  );
}
