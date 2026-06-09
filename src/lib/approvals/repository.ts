import { and, eq, desc } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import { db as defaultDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import type {
  ApprovalDecision,
  ApprovalEscalationStatus,
  ApprovalRequiredRole,
  ApprovalStatus,
  SubjectType,
} from '@/lib/approvals/types';
import type { Visibility } from '@/lib/case/visibility';

type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface CreatePendingInput {
  caseId: string;
  userId: string;
  assigneeUserId?: string | null;
  requiredRole?: ApprovalRequiredRole;
  dueAt?: Date | null;
  escalationStatus?: ApprovalEscalationStatus;
  visibility?: Visibility;
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
  assigneeUserId: string | null;
  requiredRole: ApprovalRequiredRole;
  dueAt: Date | null;
  escalationStatus: ApprovalEscalationStatus;
  visibility: Visibility;
  subjectType: SubjectType;
  subjectId: string;
  status: ApprovalStatus;
  decision: ApprovalDecision | null;
  resolvedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReviewInboxInput {
  organizationId: string;
  assigneeUserId?: string;
  requiredRole?: ApprovalRequiredRole;
}

export interface ApprovalRepository {
  createPending(input: CreatePendingInput): Promise<string>;
  getById(id: string): Promise<ApprovalRow | null>;
  getBySubject(subjectType: SubjectType, subjectId: string): Promise<ApprovalRow | null>;
  listPending(caseId: string): Promise<ApprovalRow[]>;
  listReviewInbox(input: ReviewInboxInput): Promise<ApprovalRow[]>;
  resolve(id: string, input: ResolveInput): Promise<void>;
}

function toRow(r: typeof schema.approvals.$inferSelect): ApprovalRow {
  return {
    id: r.id,
    caseId: r.caseId,
    userId: r.userId,
    assigneeUserId: r.assigneeUserId ?? null,
    requiredRole: r.requiredRole as ApprovalRequiredRole,
    dueAt: r.dueAt ?? null,
    escalationStatus: r.escalationStatus as ApprovalEscalationStatus,
    visibility: r.visibility as Visibility,
    subjectType: r.subjectType as SubjectType,
    subjectId: r.subjectId,
    status: r.status as ApprovalStatus,
    decision: r.decision ?? null,
    resolvedBy: r.resolvedBy ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function defaultRequiredRole(subjectType: SubjectType): ApprovalRequiredRole {
  return subjectType === 'draft' ? 'consultant' : 'applicant';
}

function defaultVisibility(subjectType: SubjectType): Visibility {
  return subjectType === 'draft' ? 'internal' : 'client_visible';
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
          assigneeUserId: input.assigneeUserId === undefined ? input.userId : input.assigneeUserId,
          requiredRole: input.requiredRole ?? defaultRequiredRole(input.subjectType),
          dueAt: input.dueAt ?? null,
          escalationStatus: input.escalationStatus ?? 'none',
          visibility: input.visibility ?? defaultVisibility(input.subjectType),
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
    async listReviewInbox(input) {
      const filters = [
        eq(schema.cases.organizationId, input.organizationId),
        eq(schema.approvals.status, 'pending'),
      ];
      if (input.assigneeUserId) {
        filters.push(eq(schema.approvals.assigneeUserId, input.assigneeUserId));
      }
      if (input.requiredRole) {
        filters.push(eq(schema.approvals.requiredRole, input.requiredRole));
      }
      const rows = await dbInstance
        .select({ approval: schema.approvals })
        .from(schema.approvals)
        .innerJoin(schema.cases, eq(schema.approvals.caseId, schema.cases.id))
        .where(and(...filters))
        .orderBy(desc(schema.approvals.createdAt));
      return rows.map((row) => toRow(row.approval));
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
