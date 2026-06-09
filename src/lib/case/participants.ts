import { and, eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import { db as defaultDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { isVisibility, type Visibility } from '@/lib/case/visibility';
import { CASE_PARTICIPANT_ROLES, type CaseParticipantRole } from '@/lib/case/participant-roles';

type Db = ReturnType<typeof drizzle<typeof schema>>;

export const PARTICIPANT_INVITATION_STATUSES = [
  'active',
  'invited',
  'declined',
  'revoked',
] as const;

export type ParticipantInvitationStatus = (typeof PARTICIPANT_INVITATION_STATUSES)[number];

export interface CaseParticipant {
  id: string;
  caseId: string;
  organizationId: string;
  userId: string | null;
  invitedEmail: string | null;
  role: CaseParticipantRole;
  invitationStatus: ParticipantInvitationStatus;
  visibility: Visibility;
  relation: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertCaseParticipantInput {
  caseId: string;
  organizationId: string;
  role: CaseParticipantRole;
  userId?: string | null;
  invitedEmail?: string | null;
  invitationStatus?: ParticipantInvitationStatus;
  visibility?: Visibility;
  relation?: Record<string, unknown> | null;
}

export interface CaseParticipantRepository {
  listByCase(caseId: string): Promise<CaseParticipant[]>;
  getForUser(input: { caseId: string; userId: string }): Promise<CaseParticipant[]>;
  upsert(input: UpsertCaseParticipantInput): Promise<CaseParticipant>;
}

function parseRole(role: string): CaseParticipantRole {
  if (CASE_PARTICIPANT_ROLES.includes(role as CaseParticipantRole)) {
    return role as CaseParticipantRole;
  }
  throw new Error(`unknown case participant role: ${role}`);
}

function parseStatus(status: string): ParticipantInvitationStatus {
  if (PARTICIPANT_INVITATION_STATUSES.includes(status as ParticipantInvitationStatus)) {
    return status as ParticipantInvitationStatus;
  }
  throw new Error(`unknown participant invitation status: ${status}`);
}

function toParticipant(row: typeof schema.caseParticipants.$inferSelect): CaseParticipant {
  if (!isVisibility(row.visibility)) throw new Error(`unknown participant visibility: ${row.visibility}`);
  return {
    id: row.id,
    caseId: row.caseId,
    organizationId: row.organizationId,
    userId: row.userId,
    invitedEmail: row.invitedEmail,
    role: parseRole(row.role),
    invitationStatus: parseStatus(row.invitationStatus),
    visibility: row.visibility,
    relation: row.relation,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function makeCaseParticipantRepository(
  db?: Db,
  _schemaName: string | null = null,
): CaseParticipantRepository {
  const dbInstance = db ?? defaultDb;
  return {
    async listByCase(caseId) {
      const rows = await dbInstance
        .select()
        .from(schema.caseParticipants)
        .where(eq(schema.caseParticipants.caseId, caseId));
      return rows.map(toParticipant);
    },

    async getForUser(input) {
      const rows = await dbInstance
        .select()
        .from(schema.caseParticipants)
        .where(
          and(
            eq(schema.caseParticipants.caseId, input.caseId),
            eq(schema.caseParticipants.userId, input.userId),
          ),
        );
      return rows.map(toParticipant);
    },

    async upsert(input) {
      if (!input.userId && !input.invitedEmail) {
        throw new Error('case participant requires userId or invitedEmail');
      }

      const values = {
        caseId: input.caseId,
        organizationId: input.organizationId,
        userId: input.userId ?? null,
        invitedEmail: input.invitedEmail?.trim().toLowerCase() ?? null,
        role: input.role,
        invitationStatus: input.invitationStatus ?? 'active',
        visibility: input.visibility ?? 'shared',
        relation: input.relation ?? null,
        updatedAt: new Date(),
      };

      return await dbInstance.transaction(async (tx) => {
        if (values.userId) {
          const [existing] = await tx
            .select({ id: schema.caseParticipants.id })
            .from(schema.caseParticipants)
            .where(
              and(
                eq(schema.caseParticipants.caseId, values.caseId),
                eq(schema.caseParticipants.userId, values.userId),
                eq(schema.caseParticipants.role, values.role),
              ),
            );
          if (existing) {
            const [updated] = await tx
              .update(schema.caseParticipants)
              .set({
                invitedEmail: values.invitedEmail,
                invitationStatus: values.invitationStatus,
                visibility: values.visibility,
                relation: values.relation,
                updatedAt: values.updatedAt,
              })
              .where(eq(schema.caseParticipants.id, existing.id))
              .returning();
            if (!updated) throw new Error('update case participant returned no row');
            return toParticipant(updated);
          }
        }

        const [created] = await tx.insert(schema.caseParticipants).values(values).returning();
        if (!created) throw new Error('insert case participant returned no row');
        return toParticipant(created);
      });
    },
  };
}
