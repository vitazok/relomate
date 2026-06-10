import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getCurrentUserId } from '@/lib/auth/session';
import { canAccessCase } from '@/lib/auth/authorization';
import { makeRepository } from '@/lib/case/repository';
import { makeDocumentRepository } from '@/lib/documents/repository';
import { makeR2StorageAdapter, documentKey } from '@/lib/storage/r2';
import { ALLOWED_UPLOAD_TYPES } from '@/lib/documents/types';
import { db } from '@/lib/db/client';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 4 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set<string>(ALLOWED_UPLOAD_TYPES);

const BodySchema = z.object({
  caseId: z.string().uuid(),
  spineItemId: z.string().min(1).max(100).nullable().optional(),
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1),
  byteSize: z.number().int().positive(),
});

export async function POST(req: Request) {
  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return new NextResponse('payload too large', { status: 413 });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return new NextResponse('invalid json', { status: 400 });
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return new NextResponse('invalid request', { status: 400 });
  const body = parsed.data;

  if (!ALLOWED_TYPES.has(body.contentType)) {
    return new NextResponse('unsupported content type', { status: 400 });
  }
  if (body.byteSize > MAX_FILE_BYTES) {
    return new NextResponse('file too large', { status: 400 });
  }

  const userId = await getCurrentUserId();
  if (!userId) return new NextResponse('unauthorized', { status: 401 });

  const repo = makeRepository(db);
  let loaded;
  try {
    loaded = await repo.loadCase(body.caseId);
  } catch (err) {
    // loadCase throws on missing case, missing thread (a server invariant), or corrupt
    // case_facts/profile parse — only the first is a client-facing 404; let the rest 500.
    if (err instanceof Error && err.message.startsWith('case not found:')) {
      return new NextResponse('not found', { status: 404 });
    }
    throw err;
  }
  if (!(await canAccessCase(db, { userId, caseId: loaded.case.id, action: 'upload_document' }))) {
    return new NextResponse('forbidden', { status: 403 });
  }

  const documentId = randomUUID();
  const key = documentKey(body.caseId, documentId, body.fileName);

  const docs = makeDocumentRepository(db);
  await docs.insertWithId(documentId, {
    caseId: body.caseId,
    userId,
    spineItemId: body.spineItemId ?? null,
    r2Key: key,
    fileName: body.fileName,
    contentType: body.contentType,
    byteSize: body.byteSize,
  });

  const storage = makeR2StorageAdapter();
  const { url } = await storage.presignUpload(key, body.contentType);
  return NextResponse.json({ documentId, uploadUrl: url });
}
