import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedOrgAndUser } from '../_db/seed';
import { makeRepository } from '@/lib/case/repository';
import { makeCaseParticipantRepository } from '@/lib/case/participants';
import * as schema from '@/lib/db/schema';

describe('case participants repository', () => {
  let handle: TestDbHandle;

  beforeAll(async () => {
    handle = await createTestSchema();
  }, 30_000);

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  async function createCase() {
    const seeded = await seedOrgAndUser(handle);
    const repo = makeRepository(handle.db, handle.schemaName);
    const { caseId } = await repo.createCase({
      userId: seeded.userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
    });
    return { ...seeded, caseId };
  }

  it('lists the primary applicant participant seeded at case creation', async () => {
    const seeded = await createCase();
    const participants = await makeCaseParticipantRepository(handle.db, handle.schemaName).listByCase(
      seeded.caseId,
    );

    expect(participants).toHaveLength(1);
    expect(participants[0]).toMatchObject({
      caseId: seeded.caseId,
      organizationId: seeded.organizationId,
      userId: seeded.userId,
      role: 'applicant',
      invitationStatus: 'active',
      visibility: 'shared',
      relation: { kind: 'primary_applicant' },
    });
  });

  it('upserts linked participants by case, user, and role', async () => {
    const seeded = await createCase();
    const [reviewer] = await handle.db
      .insert(schema.users)
      .values({ organizationId: seeded.organizationId, isAnonymous: false })
      .returning({ id: schema.users.id });
    if (!reviewer) throw new Error('failed to insert reviewer');
    const repo = makeCaseParticipantRepository(handle.db, handle.schemaName);

    const created = await repo.upsert({
      caseId: seeded.caseId,
      organizationId: seeded.organizationId,
      userId: reviewer.id,
      role: 'reviewer',
      visibility: 'internal',
      relation: { queue: 'senior_review' },
    });
    const updated = await repo.upsert({
      caseId: seeded.caseId,
      organizationId: seeded.organizationId,
      userId: reviewer.id,
      role: 'reviewer',
      visibility: 'shared',
      relation: { queue: 'standard_review' },
    });

    expect(updated.id).toBe(created.id);
    expect(updated.visibility).toBe('shared');
    expect(updated.relation).toEqual({ queue: 'standard_review' });
    await expect(repo.getForUser({ caseId: seeded.caseId, userId: reviewer.id })).resolves.toHaveLength(1);
  });

  it('supports invited email participants without a linked user', async () => {
    const seeded = await createCase();
    const participant = await makeCaseParticipantRepository(handle.db, handle.schemaName).upsert({
      caseId: seeded.caseId,
      organizationId: seeded.organizationId,
      invitedEmail: ' Employer@Example.COM ',
      role: 'employer_contact',
      invitationStatus: 'invited',
      visibility: 'client_visible',
    });

    expect(participant.userId).toBeNull();
    expect(participant.invitedEmail).toBe('employer@example.com');
    expect(participant.role).toBe('employer_contact');
    expect(participant.invitationStatus).toBe('invited');
    expect(participant.visibility).toBe('client_visible');
  });
});
