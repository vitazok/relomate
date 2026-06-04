import { inngest, type DocumentUploadedEvent } from '@/lib/inngest/client';
import { makeDocumentRepository } from '@/lib/documents/repository';
import { makeR2StorageAdapter, type StorageAdapter } from '@/lib/storage/r2';
import { makeExtractionProvider } from '@/lib/extraction';
import type { ExtractionProvider } from '@/lib/extraction/types';
import { getExtractionSchema, getDocumentSpine, sensitiveKeys } from '@/lib/extraction/schema';
import { db } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';

interface StepLike {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
}

export interface ExtractDocumentDeps {
  storage: StorageAdapter;
  provider: ExtractionProvider;
}

export async function extractDocumentHandler({
  event,
  step,
  deps,
}: {
  event: DocumentUploadedEvent;
  step: StepLike;
  deps?: ExtractDocumentDeps;
}): Promise<void> {
  const { documentId, caseId, userId } = event.data;
  const docs = makeDocumentRepository();
  const storage = deps?.storage ?? makeR2StorageAdapter();
  const provider = deps?.provider ?? makeExtractionProvider();

  // Step 1 — load + idempotency guard.
  const proceed = await step.run('load-document', async () => {
    const row = await docs.getById(documentId);
    if (!row) return false;
    if (row.status !== 'uploaded') return false; // re-delivery / already processed
    await docs.setStatus(documentId, 'classifying');
    return true;
  });
  if (!proceed) return;

  try {
    // Step 2 — classify.
    const classification = await step.run('classify', async () => {
      const row = await docs.getById(documentId);
      if (!row) throw new Error('document vanished');
      const obj = await storage.getObject(row.r2Key);
      const result = await provider.classify(
        { body: obj.body, contentType: obj.contentType },
        getDocumentSpine(),
      );
      await docs.setStatus(documentId, 'extracting');
      return result;
    });

    // Step 3 — extract (skip when the spine item has no extraction schema).
    const extracted = await step.run('extract', async () => {
      const row = await docs.getById(documentId);
      if (!row) throw new Error('document vanished');
      const spineItemId = classification.spineItemId;
      const exSchema = spineItemId ? getExtractionSchema(spineItemId) : null;
      if (!exSchema) {
        return {
          spineItemId,
          fields: {} as Record<string, { value: unknown; confidence: number }>,
          provider: 'anthropic_vision' as const,
          modelVersion: 'none',
        };
      }
      const obj = await storage.getObject(row.r2Key);
      const r = await provider.extract({ body: obj.body, contentType: obj.contentType }, exSchema);
      return { spineItemId, fields: r.fields, provider: r.provider, modelVersion: r.modelVersion };
    });

    // Step 4 — store (NO case-state write — rule 5; confirmation is 3B).
    await step.run('store', async () => {
      await docs.setExtraction(documentId, {
        spineItemId: extracted.spineItemId,
        detectedType: classification.spineItemId,
        classification: { type: classification.spineItemId, confidence: classification.confidence },
        extracted: {
          fields: extracted.fields,
          provider: extracted.provider,
          modelVersion: extracted.modelVersion,
        },
      });
    });

    // Step 5 — audit log (field KEYS + confidences only; NEVER values — PII rule).
    await step.run('log-extracted', async () => {
      const fieldKeys = Object.keys(extracted.fields);
      const exSchema = extracted.spineItemId ? getExtractionSchema(extracted.spineItemId) : null;
      await db.insert(schema.activityLog).values({
        caseId,
        userId,
        kind: 'case.document.extracted',
        payload: {
          documentId,
          spineItemId: extracted.spineItemId,
          fieldKeys,
          sensitiveKeys: exSchema ? sensitiveKeys(exSchema) : [],
        },
      });
    });
  } catch (err) {
    // Terminal failure for this delivery: mark the row failed + audit. Inngest's own retries
    // wrap each step.run; reaching here means a step ultimately threw.
    await step.run('mark-failed', async () => {
      const message = err instanceof Error ? err.message : 'extraction failed';
      await docs.setFailed(documentId, message.slice(0, 500));
      await db.insert(schema.activityLog).values({
        caseId,
        userId,
        kind: 'case.document.extraction_failed',
        payload: { documentId },
      });
    });
  }
}

export const extractDocument = inngest.createFunction(
  { id: 'extract-document', triggers: [{ event: 'document.uploaded' }] },
  extractDocumentHandler,
);
