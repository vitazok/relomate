import type { drizzle } from 'drizzle-orm/node-postgres';
import type { CaseAuthorization } from '@/lib/auth/authorization';
import { getCaseAuthorization } from '@/lib/auth/authorization';
import type { ApprovalRow } from '@/lib/approvals/repository';
import { db as defaultDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';

type Db = ReturnType<typeof drizzle<typeof schema>>;

type ApprovalAuthorizationSubject = Pick<
  ApprovalRow,
  'caseId' | 'requiredRole' | 'assigneeUserId'
>;

export interface ApprovalAuthorizer {
  canResolve(userId: string, approval: ApprovalAuthorizationSubject): Promise<boolean>;
}

function canResolveWithAuth(auth: CaseAuthorization | null, approval: ApprovalAuthorizationSubject): boolean {
  if (!auth?.canAccess) return false;

  switch (approval.requiredRole) {
    case 'applicant':
      return (
        auth.isPrimaryApplicant ||
        auth.membershipRole === 'applicant' ||
        auth.participantRoles.includes('applicant')
      );
    case 'employer_contact':
      return (
        auth.membershipRole === 'employer_contact' ||
        auth.participantRoles.includes('employer_contact')
      );
    case 'consultant':
      return (
        auth.membershipRole === 'firm_admin' ||
        auth.membershipRole === 'ops_manager' ||
        auth.membershipRole === 'consultant' ||
        auth.membershipRole === 'reviewer' ||
        auth.participantRoles.includes('consultant') ||
        auth.participantRoles.includes('reviewer') ||
        auth.participantRoles.includes('ops_manager')
      );
    case 'reviewer':
      return (
        auth.membershipRole === 'firm_admin' ||
        auth.membershipRole === 'ops_manager' ||
        auth.membershipRole === 'reviewer' ||
        auth.participantRoles.includes('reviewer') ||
        auth.participantRoles.includes('ops_manager')
      );
  }
  return false;
}

export function makeApprovalAuthorizer(db?: Db): ApprovalAuthorizer {
  const dbInstance = db ?? defaultDb;
  return {
    async canResolve(userId, approval) {
      const action =
        approval.requiredRole === 'applicant' || approval.requiredRole === 'employer_contact'
          ? 'read'
          : 'review_draft';
      const auth = await getCaseAuthorization(dbInstance, {
        userId,
        caseId: approval.caseId,
        action,
      });
      return canResolveWithAuth(auth, approval);
    },
  };
}
