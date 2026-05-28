import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedAnonUser, seedCaseFor } from '../_db/seed-auth';
import { promoteToAuthed } from '@/lib/auth/merge';
import * as schema from '@/lib/db/schema';

describe('promoteToAuthed', () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestSchema(); });
  afterAll(async () => { await handle.cleanup(); });

  it('branch (b): promotes anon user in place when no existing identity', async () => {
    const anon = await seedAnonUser(handle);
    await seedCaseFor(handle, anon.userId);
    const email = 'priya@example.com';

    const { targetUserId } = await promoteToAuthed(handle.db, {
      anonymousUserId: anon.userId,
      email,
    });

    expect(targetUserId).toBe(anon.userId);

    const [user] = await handle.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, anon.userId));
    expect(user?.isAnonymous).toBe(false);

    const idents = await handle.db
      .select()
      .from(schema.userIdentities)
      .where(eq(schema.userIdentities.userId, anon.userId));
    expect(idents).toHaveLength(1);
    expect(idents[0]?.provider).toBe('email_magiclink');
    expect(idents[0]?.providerId).toBe(email);

    const cases = await handle.db
      .select()
      .from(schema.cases)
      .where(eq(schema.cases.userId, anon.userId));
    expect(cases).toHaveLength(1);

    const log = await handle.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.userId, anon.userId));
    expect(log).toHaveLength(1);
    expect(log[0]?.kind).toBe('auth.promoted_anon');
    expect((log[0]?.payload as Record<string, unknown>).email).toBe(email);
  });

  it('branch (c): re-points cases, deletes anon, deletes anon org, transfers profile when target has none', async () => {
    const email = 'rahul@example.com';
    const anon = await seedAnonUser(handle);
    await seedCaseFor(handle, anon.userId);
    await seedCaseFor(handle, anon.userId);
    const { seedProfileFor } = await import('../_db/seed-auth');
    await seedProfileFor(handle, anon.userId, {
      schemaVersion: 1,
      nationality: { value: 'IN', source: 'user_stated', confidence: 0.9, updatedAt: new Date().toISOString(), sourceTurnId: '00000000-0000-0000-0000-000000000000' },
    });
    const target = await (await import('../_db/seed-auth')).seedAuthedUser(handle, email);
    await seedCaseFor(handle, target.userId);

    const { targetUserId } = await promoteToAuthed(handle.db, {
      anonymousUserId: anon.userId,
      email,
    });

    expect(targetUserId).toBe(target.userId);

    const targetCases = await handle.db
      .select()
      .from(schema.cases)
      .where(eq(schema.cases.userId, target.userId));
    expect(targetCases).toHaveLength(3);

    const anonExists = await handle.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, anon.userId));
    expect(anonExists).toHaveLength(0);

    const anonOrgExists = await handle.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, anon.organizationId));
    expect(anonOrgExists).toHaveLength(0);

    const targetProfile = await handle.db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.userId, target.userId));
    expect(targetProfile).toHaveLength(1);

    const log = await handle.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.userId, target.userId));
    expect(log).toHaveLength(1);
    expect(log[0]?.kind).toBe('auth.merged_anon');
    const payload = log[0]?.payload as Record<string, unknown>;
    expect(payload.from).toBe(anon.userId);
    expect(payload.into).toBe(target.userId);
    expect(payload.casesMerged).toBe(2);
    expect(payload.profileTransferred).toBe(true);
  });

  it('branch (c): drops anon profile when target already has one', async () => {
    const email = 'meera@example.com';
    const anon = await seedAnonUser(handle);
    const { seedProfileFor, seedAuthedUser } = await import('../_db/seed-auth');
    await seedProfileFor(handle, anon.userId, { schemaVersion: 1 });
    const target = await seedAuthedUser(handle, email);
    await seedProfileFor(handle, target.userId, { schemaVersion: 1 });

    await promoteToAuthed(handle.db, { anonymousUserId: anon.userId, email });

    const profiles = await handle.db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.userId, target.userId));
    expect(profiles).toHaveLength(1);

    const log = await handle.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.userId, target.userId));
    expect((log[0]?.payload as Record<string, unknown>).profileTransferred).toBe(false);
  });
});
