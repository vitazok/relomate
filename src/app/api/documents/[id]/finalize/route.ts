import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth/session';
import { makeDocumentRepository } from '@/lib/documents/repository';
import { makeR2StorageAdapter } from '@/lib/storage/r2';
import { inngest } from '@/lib/inngest/client';
import { db } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const userId = await getCurrentUserId();
  if (!userId) return new NextResponse('unauthorized', { status: 401 });

  const docs = makeDocumentRepository(db);
  const row = await docs.getById(id);
  if (!row) return new NextResponse('not found', { status: 404 });
  if (row.userId !== userId) return new NextResponse('forbidden', { status: 403 });
  if (row.status !== 'pending_upload') {
    // Idempotent: already finalized (or further along). Re-emitting would re-trigger the
    // extract workflow, so do nothing.
    return NextResponse.json({ ok: true });
  }

  const storage = makeR2StorageAdapter();
  const head = await storage.headObject(row.r2Key);
  if (!head) return new NextResponse('upload not found in storage', { status: 409 });

  await docs.setStatus(id, 'uploaded');
  // Best-effort emit, mirroring agent-turn's onFinish. setStatus MUST precede send — the
  // extract-document workflow's idempotency guard only proceeds on status 'uploaded', so
  // emitting first would race it. A failed send therefore leaves a stuck 'uploaded' row;
  // accepted for MVP (revisit with an outbox/sweeper if it bites).
  await inngest.send({
    name: 'document.uploaded',
    data: { documentId: id, caseId: row.caseId, userId },
  });
  return NextResponse.json({ ok: true });
}
