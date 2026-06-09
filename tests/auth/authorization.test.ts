import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedOrgAndUser } from '../_db/seed';
import { makeRepository } from '@/lib/case/repository';
import { canAccessCase, getCaseAuthorization } from '@/lib/auth/authorization';
import * as schema from '@/lib/db/schema';

describe('case authorization', () => {
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
    await handle.db.insert(schema.organizationMembers).values({
      organizationId,
      userId: user.id,
      role,
    });
    return user.id;
  }

  it('allows a firm member in the owning organization to read a case', async () => {
    const seeded = await seedOrgAndUser(handle);
    const consultantId = await addUserInOrg(seeded.organizationId, 'consultant');
    const repo = makeRepository(handle.db, handle.schemaName);
    const { caseId } = await repo.createCase({
      userId: seeded.userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
    });

    const auth = await getCaseAuthorization(handle.db, {
      userId: consultantId,
      caseId,
      action: 'read',
    });

    expect(auth?.membershipRole).toBe('consultant');
    expect(auth?.isPrimaryApplicant).toBe(false);
    expect(auth?.canAccess).toBe(true);
  });

  it('denies users outside the owning organization', async () => {
    const owner = await seedOrgAndUser(handle);
    const outsider = await seedOrgAndUser(handle);
    const repo = makeRepository(handle.db, handle.schemaName);
    const { caseId } = await repo.createCase({
      userId: owner.userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
    });

    await expect(
      canAccessCase(handle.db, { userId: outsider.userId, caseId, action: 'read' }),
    ).resolves.toBe(false);
  });

  it('allows the primary applicant to use applicant-safe case actions', async () => {
    const seeded = await seedOrgAndUser(handle);
    const repo = makeRepository(handle.db, handle.schemaName);
    const { caseId } = await repo.createCase({
      userId: seeded.userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
    });

    await expect(
      canAccessCase(handle.db, { userId: seeded.userId, caseId, action: 'upload_document' }),
    ).resolves.toBe(true);
  });

  it('allows an active reviewer participant outside the organization to review the case', async () => {
    const owner = await seedOrgAndUser(handle);
    const external = await seedOrgAndUser(handle);
    const repo = makeRepository(handle.db, handle.schemaName);
    const { caseId } = await repo.createCase({
      userId: owner.userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
    });
    await handle.db.insert(schema.caseParticipants).values({
      caseId,
      organizationId: owner.organizationId,
      userId: external.userId,
      role: 'reviewer',
      invitationStatus: 'active',
      visibility: 'internal',
    });

    const auth = await getCaseAuthorization(handle.db, {
      userId: external.userId,
      caseId,
      action: 'review_draft',
    });

    expect(auth?.membershipRole).toBeNull();
    expect(auth?.participantRoles).toEqual(['reviewer']);
    expect(auth?.canAccess).toBe(true);
  });

  it('denies revoked participants', async () => {
    const owner = await seedOrgAndUser(handle);
    const external = await seedOrgAndUser(handle);
    const repo = makeRepository(handle.db, handle.schemaName);
    const { caseId } = await repo.createCase({
      userId: owner.userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
    });
    await handle.db.insert(schema.caseParticipants).values({
      caseId,
      organizationId: owner.organizationId,
      userId: external.userId,
      role: 'reviewer',
      invitationStatus: 'revoked',
      visibility: 'internal',
    });

    await expect(
      canAccessCase(handle.db, { userId: external.userId, caseId, action: 'review_document' }),
    ).resolves.toBe(false);
  });

  it('scopes employer contacts to read and upload, not chat or review', async () => {
    const owner = await seedOrgAndUser(handle);
    const employer = await seedOrgAndUser(handle);
    const repo = makeRepository(handle.db, handle.schemaName);
    const { caseId } = await repo.createCase({
      userId: owner.userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
    });
    await handle.db.insert(schema.caseParticipants).values({
      caseId,
      organizationId: owner.organizationId,
      userId: employer.userId,
      role: 'employer_contact',
      invitationStatus: 'active',
      visibility: 'client_visible',
    });

    await expect(canAccessCase(handle.db, { userId: employer.userId, caseId, action: 'read' })).resolves.toBe(true);
    await expect(
      canAccessCase(handle.db, { userId: employer.userId, caseId, action: 'upload_document' }),
    ).resolves.toBe(true);
    await expect(canAccessCase(handle.db, { userId: employer.userId, caseId, action: 'chat' })).resolves.toBe(false);
    await expect(
      canAccessCase(handle.db, { userId: employer.userId, caseId, action: 'review_draft' }),
    ).resolves.toBe(false);
  });
});
