import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth/session';
import { makeDocumentRepository } from '@/lib/documents/repository';
import { db } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await getCurrentUserId();
  if (!userId) return new NextResponse('unauthorized', { status: 401 });

  const row = await makeDocumentRepository(db).getById(id);
  if (!row) return new NextResponse('not found', { status: 404 });
  if (row.userId !== userId) return new NextResponse('forbidden', { status: 403 });

  // Render-safe projection: never leak r2_key or the raw provider blob.
  return NextResponse.json({
    id: row.id,
    status: row.status,
    spineItemId: row.spineItemId,
    detectedType: row.detectedType,
    classification: row.classification,
    extracted: row.extracted ? { fields: row.extracted.fields } : null,
    fileName: row.fileName,
    error: row.error,
  });
}
