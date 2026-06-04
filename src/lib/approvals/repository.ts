import { and, eq, desc } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import { db as defaultDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import type { ApprovalStatus, SubjectType, ApprovalDecision } from '@/lib/approvals/types';

type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface CreatePendingInput {
  caseId: string;
  userId: string;
  subjectType: SubjectType;
  subjectId: string;
}

export interface ResolveInput {
  status: Exclude<ApprovalStatus, 'pending'>;
  decision: ApprovalDecision;
  resolvedBy: string;
}

export interface ApprovalRow {
  id: string;
  caseId: string;
  userId: string;
  subjectType: SubjectType;
  subjectId: string;
  status: ApprovalStatus;
  decision: ApprovalDecision | null;
  resolvedBy: string | null;
}

export interface ApprovalRepository {
  createPending(input: CreatePendingInput): Promise<string>;
  getById(id: string): Promise<ApprovalRow | null>;
  getBySubject(subjectType: SubjectType, subjectId: string): Promise<ApprovalRow | null>;
  listPending(caseId: string): Promise<ApprovalRow[]>;
  resolve(id: string, input: ResolveInput): Promise<void>;
}

function toRow(r: typeof schema.approvals.$inferSelect): ApprovalRow {
  return {
    id: r.id,
    caseId: r.caseId,
    userId: r.userId,
    subjectType: r.subjectType as SubjectType,
    subjectId: r.subjectId,
    status: r.status as ApprovalStatus,
    decision: r.decision ?? null,
    resolvedBy: r.resolvedBy ?? null,
  };
}

export function makeApprovalRepository(db?: Db): ApprovalRepository {
  const dbInstance = db ?? defaultDb;
  return {
    async createPending(input) {
      // Sequential re-delivery safety: return the existing open approval if one exists.
      // The partial unique index is the DB-level backstop for a true concurrent race.
      const existing = await this.getBySubject(input.subjectType, input.subjectId);
      if (existing && existing.status === 'pending') return existing.id;
      const [row] = await dbInstance
        .insert(schema.approvals)
        .values({
          caseId: input.caseId,
          userId: input.userId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          status: 'pending',
        })
        .returning({ id: schema.approvals.id });
      if (!row) throw new Error('createPending: no row returned');
      return row.id;
    },
    async getById(id) {
      const rows = await dbInstance.select().from(schema.approvals).where(eq(schema.approvals.id, id));
      return rows[0] ? toRow(rows[0]) : null;
    },
    async getBySubject(subjectType, subjectId) {
      const rows = await dbInstance
        .select()
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.subjectType, subjectType),
            eq(schema.approvals.subjectId, subjectId),
            eq(schema.approvals.status, 'pending'),
          ),
        );
      return rows[0] ? toRow(rows[0]) : null;
    },
    async listPending(caseId) {
      const rows = await dbInstance
        .select()
        .from(schema.approvals)
        .where(and(eq(schema.approvals.caseId, caseId), eq(schema.approvals.status, 'pending')))
        .orderBy(desc(schema.approvals.createdAt));
      return rows.map(toRow);
    },
    async resolve(id, input) {
      const updated = await dbInstance
        .update(schema.approvals)
        .set({
          status: input.status,
          decision: input.decision,
          resolvedBy: input.resolvedBy,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.approvals.id, id))
        .returning({ id: schema.approvals.id });
      if (!updated[0]) throw new Error(`resolve: approval not found: ${id}`);
    },
  };
}
