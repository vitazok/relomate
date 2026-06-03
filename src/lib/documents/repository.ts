import { eq, desc } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import { db as defaultDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import type { DocumentStatus, ExtractedData, Classification } from '@/lib/documents/types';

type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface InsertDocumentInput {
  caseId: string;
  userId: string;
  r2Key: string;
  fileName: string;
  contentType: string;
  byteSize: number;
}

export interface SetExtractionInput {
  spineItemId: string | null;
  detectedType: string | null;
  classification: Classification | null;
  extracted: ExtractedData;
}

export interface DocumentRow {
  id: string;
  caseId: string;
  userId: string;
  spineItemId: string | null;
  detectedType: string | null;
  status: DocumentStatus;
  r2Key: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  extracted: ExtractedData | null;
  classification: Classification | null;
  error: string | null;
}

export interface DocumentRepository {
  insert(input: InsertDocumentInput): Promise<string>;
  insertWithId(id: string, input: InsertDocumentInput): Promise<string>;
  getById(id: string): Promise<DocumentRow | null>;
  listByCase(caseId: string): Promise<DocumentRow[]>;
  setStatus(id: string, status: DocumentStatus): Promise<void>;
  setExtraction(id: string, input: SetExtractionInput): Promise<void>;
  setFailed(id: string, error: string): Promise<void>;
}

function toRow(r: typeof schema.documents.$inferSelect): DocumentRow {
  return {
    id: r.id,
    caseId: r.caseId,
    userId: r.userId,
    spineItemId: r.spineItemId,
    detectedType: r.detectedType,
    status: r.status as DocumentStatus,
    r2Key: r.r2Key,
    fileName: r.fileName,
    contentType: r.contentType,
    byteSize: r.byteSize,
    extracted: r.extracted ?? null,
    classification: r.classification ?? null,
    error: r.error,
  };
}

function insertValues(input: InsertDocumentInput, id?: string) {
  return {
    ...(id ? { id } : {}),
    caseId: input.caseId,
    userId: input.userId,
    r2Key: input.r2Key,
    fileName: input.fileName,
    contentType: input.contentType,
    byteSize: input.byteSize,
    status: 'pending_upload' as const,
  };
}

export function makeDocumentRepository(db?: Db): DocumentRepository {
  const dbInstance = db ?? defaultDb;
  return {
    async insert(input) {
      const [row] = await dbInstance
        .insert(schema.documents)
        .values(insertValues(input))
        .returning({ id: schema.documents.id });
      if (!row) throw new Error('insert document: no row returned');
      return row.id;
    },
    async insertWithId(id, input) {
      await dbInstance.insert(schema.documents).values(insertValues(input, id));
      return id;
    },
    async getById(id) {
      const rows = await dbInstance.select().from(schema.documents).where(eq(schema.documents.id, id));
      return rows[0] ? toRow(rows[0]) : null;
    },
    async listByCase(caseId) {
      const rows = await dbInstance
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.caseId, caseId))
        .orderBy(desc(schema.documents.createdAt));
      return rows.map(toRow);
    },
    async setStatus(id, status) {
      await dbInstance
        .update(schema.documents)
        .set({ status, updatedAt: new Date() })
        .where(eq(schema.documents.id, id));
    },
    async setExtraction(id, input) {
      const updated = await dbInstance
        .update(schema.documents)
        .set({
          spineItemId: input.spineItemId,
          detectedType: input.detectedType,
          classification: input.classification,
          extracted: input.extracted,
          status: 'awaiting_confirmation',
          updatedAt: new Date(),
        })
        .where(eq(schema.documents.id, id))
        .returning({ id: schema.documents.id });
      if (!updated[0]) throw new Error(`setExtraction: document not found: ${id}`);
    },
    async setFailed(id, error) {
      const updated = await dbInstance
        .update(schema.documents)
        .set({ status: 'failed', error, updatedAt: new Date() })
        .where(eq(schema.documents.id, id))
        .returning({ id: schema.documents.id });
      if (!updated[0]) throw new Error(`setFailed: document not found: ${id}`);
    },
  };
}
