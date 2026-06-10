import type { CaseAuthorization, OrganizationRole } from '@/lib/auth/authorization';
import type { CaseParticipantRole } from '@/lib/case/participant-roles';

// Which workspace surface a viewer belongs on for a case:
//  - 'firm'   → the internal consultant workspace (/case/[id]): chat, tracker, internal notes.
//  - 'client' → the applicant portal (/portal/[id]): only applicant-safe tasks/uploads/messages.
//  - 'none'   → no access; the caller redirects away.
export type CaseSurface = 'firm' | 'client' | 'none';

// Organization roles that operate cases from the inside. `applicant` and `employer_contact`
// are deliberately excluded — they are external participants, never firm operators.
export const FIRM_ORG_ROLES: ReadonlySet<OrganizationRole> = new Set<OrganizationRole>([
  'firm_admin',
  'ops_manager',
  'consultant',
  'reviewer',
]);

// Case-participant roles that grant a firm (internal) seat even when org membership doesn't —
// e.g. a consultant added per-case rather than via org membership.
const FIRM_PARTICIPANT_ROLES: ReadonlySet<CaseParticipantRole> = new Set<CaseParticipantRole>([
  'consultant',
  'reviewer',
  'ops_manager',
]);

/** Pure: does this organization role operate the firm console / internal workspace? */
export function isFirmRole(role: OrganizationRole | null): boolean {
  return role != null && FIRM_ORG_ROLES.has(role);
}

/** Pure: may a viewer with this organization role open the firm console at all? */
export function canAccessConsole(role: OrganizationRole | null): boolean {
  return isFirmRole(role);
}

function hasFirmParticipantSeat(roles: CaseParticipantRole[]): boolean {
  return roles.some((role) => FIRM_PARTICIPANT_ROLES.has(role));
}

/**
 * Pure: decide which surface a viewer belongs on for a case, given the already-resolved
 * `CaseAuthorization`. A firm operator (by org role or per-case firm participant seat) lands on
 * the internal workspace; anyone else with access (applicant / employer / primary applicant)
 * lands on the client portal; no access → 'none'. Internal-surface routes redirect 'client'
 * viewers to the portal so applicants can never reach internal views by URL.
 */
export function caseSurface(auth: CaseAuthorization): CaseSurface {
  if (!auth.canAccess) return 'none';
  if (isFirmRole(auth.membershipRole) || hasFirmParticipantSeat(auth.participantRoles)) {
    return 'firm';
  }
  return 'client';
}
