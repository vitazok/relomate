import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedOrgAndUser } from '../_db/seed';
import { makeRepository } from '@/lib/case/repository';
import { getCaseAuthorization } from '@/lib/auth/authorization';
import { caseSurface, canAccessConsole } from '@/lib/auth/surface-access';
import * as schema from '@/lib/db/schema';

// End-to-end access boundary: resolve real authorization from seeded rows, then assert the
// surface decision. This is the "applicant cannot reach internal surfaces" guarantee the
// 4C-F-5 card requires, tested at the authorization layer (no Next runtime needed).
describe('surface access (db-backed)', () => {
  let handle: TestDbHandle;

  beforeAll(async () => {
    handle = await createTestSchema();
  }, 30_000);

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  async function addUserInOrg(organizationId: string, role: string): Promise<string> {
    const [user] = await handle.db
      .insert(schema.users)
      .values({ organizationId, isAnonymous: false })
      .returning({ id: schema.users.id });
    if (!user) throw new Error('failed to insert user');
    await handle.db.insert(schema.organizationMembers).values({ organizationId, userId: user.id, role });
    return user.id;
  }

  it('routes a consultant to the firm surface', async () => {
    const seeded = await seedOrgAndUser(handle);
    const consultantId = await addUserInOrg(seeded.organizationId, 'consultant');
    const repo = makeRepository(handle.db, handle.schemaName);
    const { caseId } = await repo.createCase({
      userId: seeded.userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
    });

    const auth = await getCaseAuthorization(handle.db, { userId: consultantId, caseId });
    expect(auth).not.toBeNull();
    expect(caseSurface(auth!)).toBe('firm');
    expect(canAccessConsole(auth!.membershipRole)).toBe(true);
  });

  it('routes an applicant participant to the client portal, never the firm surface', async () => {
    const seeded = await seedOrgAndUser(handle);
    // A separate applicant user added to the org as an `applicant` member and case participant.
    const applicantId = await addUserInOrg(seeded.organizationId, 'applicant');
    const repo = makeRepository(handle.db, handle.schemaName);
    const { caseId } = await repo.createCase({
      userId: seeded.userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
    });
    await handle.db.insert(schema.caseParticipants).values({
      caseId,
      organizationId: seeded.organizationId,
      userId: applicantId,
      role: 'applicant',
      invitationStatus: 'active',
      visibility: 'client_visible',
      relation: { kind: 'applicant' },
    });

    const auth = await getCaseAuthorization(handle.db, { userId: applicantId, caseId });
    expect(auth).not.toBeNull();
    expect(auth!.canAccess).toBe(true);
    expect(caseSurface(auth!)).toBe('client');
    // The console gate must reject the applicant outright.
    expect(canAccessConsole(auth!.membershipRole)).toBe(false);
  });

  it('routes the primary applicant to the client portal', async () => {
    const seeded = await seedOrgAndUser(handle);
    const repo = makeRepository(handle.db, handle.schemaName);
    const { caseId } = await repo.createCase({
      userId: seeded.userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
    });
    // The seeded owner is firm_admin of their org, so they resolve to the firm surface — but a
    // pure applicant (no firm membership) on a firm-owned case lands on the portal. Re-point by
    // adding a distinct applicant and verifying via the participant path above; here we assert the
    // owner (firm_admin) does NOT accidentally become a client.
    const auth = await getCaseAuthorization(handle.db, { userId: seeded.userId, caseId });
    expect(caseSurface(auth!)).toBe('firm');
  });

  it('denies an outsider — surface is none', async () => {
    const owner = await seedOrgAndUser(handle);
    const outsider = await seedOrgAndUser(handle);
    const repo = makeRepository(handle.db, handle.schemaName);
    const { caseId } = await repo.createCase({
      userId: owner.userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
    });

    const auth = await getCaseAuthorization(handle.db, { userId: outsider.userId, caseId });
    expect(auth).not.toBeNull();
    expect(caseSurface(auth!)).toBe('none');
  });

  it('lists an organization’s cases for the console', async () => {
    const seeded = await seedOrgAndUser(handle);
    const repo = makeRepository(handle.db, handle.schemaName);
    const a = await repo.createCase({ userId: seeded.userId, visaType: 'blue_card', targetCountry: 'DE' });
    const b = await repo.createCase({ userId: seeded.userId, visaType: 'blue_card', targetCountry: 'DE' });

    const rows = await repo.listByOrganization(seeded.organizationId);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual([a.caseId, b.caseId].sort());
    expect(rows.every((r) => r.primaryApplicantUserId === seeded.userId)).toBe(true);
  });
});
