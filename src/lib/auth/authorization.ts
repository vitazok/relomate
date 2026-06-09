import { and, eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@/lib/db/schema';
import { CASE_PARTICIPANT_ROLES, type CaseParticipantRole } from '@/lib/case/participant-roles';

type Db = ReturnType<typeof drizzle<typeof schema>>;

export const ORGANIZATION_ROLES = [
  'firm_admin',
  'ops_manager',
  'consultant',
  'reviewer',
  'applicant',
  'employer_contact',
] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const CASE_ACTIONS = [
  'read',
  'chat',
  'upload_document',
  'review_document',
  'review_draft',
] as const;

export type CaseAction = (typeof CASE_ACTIONS)[number];

export interface CaseAuthorization {
  caseId: string;
  organizationId: string;
  primaryApplicantUserId: string;
  legacyUserId: string;
  membershipRole: OrganizationRole | null;
  participantRoles: CaseParticipantRole[];
  isPrimaryApplicant: boolean;
  canAccess: boolean;
}

const firmReviewRoles = new Set<OrganizationRole>([
  'firm_admin',
  'ops_manager',
  'consultant',
  'reviewer',
]);

const firmCaseRoles = new Set<OrganizationRole>([
  'firm_admin',
  'ops_manager',
  'consultant',
  'reviewer',
]);

function parseRole(role: string | null): OrganizationRole | null {
  return ORGANIZATION_ROLES.includes(role as OrganizationRole) ? (role as OrganizationRole) : null;
}

function participantCan(action: CaseAction, roles: CaseParticipantRole[]): boolean {
  if (
    roles.some((role) => role === 'consultant' || role === 'reviewer' || role === 'ops_manager')
  ) {
    return true;
  }
  if (
    roles.some((role) => role === 'applicant') &&
    (action === 'read' || action === 'chat' || action === 'upload_document')
  ) {
    return true;
  }
  if (
    roles.some((role) => role === 'employer_contact') &&
    (action === 'read' || action === 'upload_document')
  ) {
    return true;
  }
  return false;
}

function roleCan(
  action: CaseAction,
  role: OrganizationRole | null,
  participantRoles: CaseParticipantRole[],
  isPrimaryApplicant: boolean,
): boolean {
  if (role && firmCaseRoles.has(role)) return true;
  if (participantCan(action, participantRoles)) return true;
  if (isPrimaryApplicant && (action === 'read' || action === 'chat' || action === 'upload_document')) {
    return true;
  }
  if (role === 'applicant' && (action === 'read' || action === 'chat' || action === 'upload_document')) {
    return true;
  }
  if ((action === 'review_document' || action === 'review_draft') && role && firmReviewRoles.has(role)) {
    return true;
  }
  return false;
}

export async function getCaseAuthorization(
  db: Db,
  input: { userId: string; caseId: string; action?: CaseAction },
): Promise<CaseAuthorization | null> {
  const action = input.action ?? 'read';
  const [row] = await db
    .select({
      caseId: schema.cases.id,
      organizationId: schema.cases.organizationId,
      primaryApplicantUserId: schema.cases.primaryApplicantUserId,
      legacyUserId: schema.cases.userId,
      memberRole: schema.organizationMembers.role,
      memberStatus: schema.organizationMembers.status,
    })
    .from(schema.cases)
    .leftJoin(
      schema.organizationMembers,
      and(
        eq(schema.organizationMembers.organizationId, schema.cases.organizationId),
        eq(schema.organizationMembers.userId, input.userId),
      ),
    )
    .where(eq(schema.cases.id, input.caseId))
    .limit(1);

  if (!row) return null;
  const participantRows = await db
    .select({ role: schema.caseParticipants.role })
    .from(schema.caseParticipants)
    .where(
      and(
        eq(schema.caseParticipants.caseId, input.caseId),
        eq(schema.caseParticipants.userId, input.userId),
        eq(schema.caseParticipants.invitationStatus, 'active'),
      ),
    );
  const participantRoles = participantRows
    .map((participant) => participant.role)
    .filter((role): role is CaseParticipantRole =>
      CASE_PARTICIPANT_ROLES.includes(role as CaseParticipantRole),
    );
  const activeRole = row.memberStatus === 'active' ? parseRole(row.memberRole) : null;
  const isPrimaryApplicant =
    row.primaryApplicantUserId === input.userId || row.legacyUserId === input.userId;

  return {
    caseId: row.caseId,
    organizationId: row.organizationId,
    primaryApplicantUserId: row.primaryApplicantUserId,
    legacyUserId: row.legacyUserId,
    membershipRole: activeRole,
    participantRoles,
    isPrimaryApplicant,
    canAccess: roleCan(action, activeRole, participantRoles, isPrimaryApplicant),
  };
}

export async function canAccessCase(
  db: Db,
  input: { userId: string; caseId: string; action?: CaseAction },
): Promise<boolean> {
  return (await getCaseAuthorization(db, input))?.canAccess ?? false;
}
