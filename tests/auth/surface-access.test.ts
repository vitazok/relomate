import { describe, it, expect } from 'vitest';
import {
  caseSurface,
  canAccessConsole,
  isFirmRole,
  type CaseSurface,
} from '@/lib/auth/surface-access';
import type { CaseAuthorization, OrganizationRole } from '@/lib/auth/authorization';
import type { CaseParticipantRole } from '@/lib/case/participant-roles';

function auth(overrides: Partial<CaseAuthorization>): CaseAuthorization {
  return {
    caseId: 'case-1',
    organizationId: 'org-1',
    primaryApplicantUserId: 'user-1',
    legacyUserId: 'user-1',
    membershipRole: null,
    participantRoles: [],
    isPrimaryApplicant: false,
    canAccess: true,
    ...overrides,
  };
}

describe('isFirmRole / canAccessConsole', () => {
  const firm: OrganizationRole[] = ['firm_admin', 'ops_manager', 'consultant', 'reviewer'];
  const external: (OrganizationRole | null)[] = ['applicant', 'employer_contact', null];

  it.each(firm)('treats %s as a firm role', (role) => {
    expect(isFirmRole(role)).toBe(true);
    expect(canAccessConsole(role)).toBe(true);
  });

  it.each(external)('treats %s as a non-firm role', (role) => {
    expect(isFirmRole(role)).toBe(false);
    expect(canAccessConsole(role)).toBe(false);
  });
});

describe('caseSurface', () => {
  it('returns none when access is denied regardless of roles', () => {
    expect(caseSurface(auth({ canAccess: false, membershipRole: 'consultant' }))).toBe('none');
  });

  it('routes firm org roles to the firm surface', () => {
    const roles: OrganizationRole[] = ['firm_admin', 'ops_manager', 'consultant', 'reviewer'];
    for (const role of roles) {
      expect(caseSurface(auth({ membershipRole: role }))).toBe<CaseSurface>('firm');
    }
  });

  it('routes a per-case firm participant seat to the firm surface even without org membership', () => {
    const participantRoles: CaseParticipantRole[] = ['consultant'];
    expect(caseSurface(auth({ membershipRole: null, participantRoles }))).toBe('firm');
  });

  it('routes an applicant org role to the client portal', () => {
    expect(caseSurface(auth({ membershipRole: 'applicant', isPrimaryApplicant: true }))).toBe(
      'client',
    );
  });

  it('routes the primary applicant (no firm role) to the client portal', () => {
    expect(caseSurface(auth({ membershipRole: null, isPrimaryApplicant: true }))).toBe('client');
  });

  it('routes an employer contact participant to the client portal, never firm', () => {
    expect(caseSurface(auth({ participantRoles: ['employer_contact'] }))).toBe('client');
  });

  it('keeps an applicant who also happens to have access off the firm surface', () => {
    // An applicant must never resolve to 'firm' — the core access-boundary guarantee.
    const surface = caseSurface(
      auth({ membershipRole: 'applicant', participantRoles: ['applicant'], isPrimaryApplicant: true }),
    );
    expect(surface).not.toBe('firm');
    expect(surface).toBe('client');
  });
});
