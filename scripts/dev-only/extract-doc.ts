// Run: node --env-file=.env.local --import tsx scripts/dev-only/extract-doc.ts <path-to-file> <caseId>
// Exercises the REAL R2 + extraction provider path end-to-end against a fixture.
// Requires real R2_* env (+ optional REDUCTO_API_KEY) and an existing caseId owned by a real user.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { makeR2StorageAdapter, documentKey } from '@/lib/storage/r2';
import { makeDocumentRepository } from '@/lib/documents/repository';
import { makeRepository } from '@/lib/case/repository';
import { makeExtractionProvider } from '@/lib/extraction';
import { extractDocumentHandler } from '@/lib/inngest/functions/extract-document';

const step = { run: <T>(_id: string, fn: () => Promise<T>) => fn() };

async function main() {
  const [filePath, caseId] = process.argv.slice(2);
  if (!filePath || !caseId) {
    console.error('usage: extract-doc.ts <path-to-file> <caseId>');
    process.exit(1);
  }

  // The document row's user_id FK requires the case's real owner.
  const loaded = await makeRepository().loadCase(caseId);
  const userId = loaded.case.userId;

  const bytes = new Uint8Array(readFileSync(filePath));
  const fileName = basename(filePath);
  const contentType = filePath.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
  const documentId = randomUUID();
  const key = documentKey(caseId, documentId, fileName);

  const storage = makeR2StorageAdapter();
  const { url } = await storage.presignUpload(key, contentType);
  await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes });
  console.log('Uploaded to R2:', key);

  // Mirror the real upload flow: insert pending_upload, then flip to 'uploaded' so the
  // workflow's load-document idempotency guard (status === 'uploaded') lets it proceed.
  const docs = makeDocumentRepository();
  await docs.insertWithId(documentId, {
    caseId,
    userId,
    r2Key: key,
    fileName,
    contentType,
    byteSize: bytes.byteLength,
  });
  await docs.setStatus(documentId, 'uploaded');

  await extractDocumentHandler({
    event: { name: 'document.uploaded', data: { documentId, caseId, userId } },
    step,
    deps: { storage, provider: makeExtractionProvider() },
  });

  const row = await docs.getById(documentId);
  console.dir(row, { depth: 6 });
}

void main();
