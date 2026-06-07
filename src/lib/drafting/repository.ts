import { and, desc, eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import { db as defaultDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import type { DraftContent, DraftStatus, DraftType } from '@/lib/drafting/types';

type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface InsertDraftInput {
  caseId: string;
  userId: string;
  type: DraftType;
}

export interface SetDraftReadyInput {
  content: DraftContent;
  modelVersion: string;
  promptVersion: string;
}

export interface DraftRow {
  id: string;
  caseId: string;
  userId: string;
  type: DraftType;
  version: number;
  status: DraftStatus;
  content: DraftContent | null;
  modelVersion: string | null;
  promptVersion: string | null;
  error: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
}

export interface DraftRepository {
  insert(input: InsertDraftInput): Promise<string>;
  insertWithId(id: string, input: InsertDraftInput): Promise<string>;
  getById(id: string): Promise<DraftRow | null>;
  listByCase(caseId: string): Promise<DraftRow[]>;
  setReady(id: string, input: SetDraftReadyInput): Promise<void>;
  setFailed(id: string, error: string): Promise<void>;
  approve(id: string, input: { content: DraftContent; approvedBy: string }): Promise<void>;
  reject(id: string): Promise<void>;
}

function toRow(r: typeof schema.drafts.$inferSelect): DraftRow {
  return {
    id: r.id,
    caseId: r.caseId,
    userId: r.userId,
    type: r.type as DraftType,
    version: r.version,
    status: r.status as DraftStatus,
    content: r.content ?? null,
    modelVersion: r.modelVersion,
    promptVersion: r.promptVersion,
    error: r.error,
    approvedBy: r.approvedBy,
    approvedAt: r.approvedAt,
  };
}

function insertValues(input: InsertDraftInput, version: number, id?: string) {
  return {
    ...(id ? { id } : {}),
    caseId: input.caseId,
    userId: input.userId,
    type: input.type,
    version,
    status: 'drafting' as const,
  };
}

async function nextVersion(dbInstance: Db, input: InsertDraftInput): Promise<number> {
  const rows = await dbInstance
    .select({ version: schema.drafts.version })
    .from(schema.drafts)
    .where(and(eq(schema.drafts.caseId, input.caseId), eq(schema.drafts.type, input.type)))
    .orderBy(desc(schema.drafts.version))
    .limit(1);
  return (rows[0]?.version ?? 0) + 1;
}

export function makeDraftRepository(db?: Db): DraftRepository {
  const dbInstance = db ?? defaultDb;
  return {
    async insert(input) {
      const version = await nextVersion(dbInstance, input);
      const [row] = await dbInstance
        .insert(schema.drafts)
        .values(insertValues(input, version))
        .returning({ id: schema.drafts.id });
      if (!row) throw new Error('insert draft: no row returned');
      return row.id;
    },
    async insertWithId(id, input) {
      const version = await nextVersion(dbInstance, input);
      await dbInstance.insert(schema.drafts).values(insertValues(input, version, id));
      return id;
    },
    async getById(id) {
      const rows = await dbInstance.select().from(schema.drafts).where(eq(schema.drafts.id, id));
      return rows[0] ? toRow(rows[0]) : null;
    },
    async listByCase(caseId) {
      const rows = await dbInstance
        .select()
        .from(schema.drafts)
        .where(eq(schema.drafts.caseId, caseId))
        .orderBy(desc(schema.drafts.createdAt));
      return rows.map(toRow);
    },
    async setReady(id, input) {
      const updated = await dbInstance
        .update(schema.drafts)
        .set({
          content: input.content,
          modelVersion: input.modelVersion,
          promptVersion: input.promptVersion,
          status: 'ready_for_review',
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.drafts.id, id))
        .returning({ id: schema.drafts.id });
      if (!updated[0]) throw new Error(`setReady: draft not found: ${id}`);
    },
    async setFailed(id, error) {
      const updated = await dbInstance
        .update(schema.drafts)
        .set({ status: 'failed', error, updatedAt: new Date() })
        .where(eq(schema.drafts.id, id))
        .returning({ id: schema.drafts.id });
      if (!updated[0]) throw new Error(`setFailed: draft not found: ${id}`);
    },
    async approve(id, input) {
      const updated = await dbInstance
        .update(schema.drafts)
        .set({
          content: input.content,
          status: 'approved',
          approvedBy: input.approvedBy,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.drafts.id, id))
        .returning({ id: schema.drafts.id });
      if (!updated[0]) throw new Error(`approve: draft not found: ${id}`);
    },
    async reject(id) {
      const updated = await dbInstance
        .update(schema.drafts)
        .set({ status: 'rejected', updatedAt: new Date() })
        .where(eq(schema.drafts.id, id))
        .returning({ id: schema.drafts.id });
      if (!updated[0]) throw new Error(`reject: draft not found: ${id}`);
    },
  };
}
