import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedAnonUser, seedCaseFor } from '../_db/seed-auth';
import { promoteToAuthed } from '@/lib/auth/merge';
import * as schema from '@/lib/db/schema';

describe('promoteToAuthed', () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestSchema(); });
  afterAll(async () => { if (handle) await handle.cleanup(); });

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

  it('branch (c): re-points cases, tombstones anon + anon org, transfers profile when target has none', async () => {
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

    // Anon user + org are tombstoned, not deleted, so audit-row FKs stay valid.
    const anonExists = await handle.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, anon.userId));
    expect(anonExists).toHaveLength(1);

    const anonOrgExists = await handle.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, anon.organizationId));
    expect(anonOrgExists).toHaveLength(1);

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

  it('branch (c): preserves anon-owned audit rows (activity_log + profile_changes) instead of orphaning them', async () => {
    const email = 'audit@example.com';
    const anon = await seedAnonUser(handle);
    const { caseId } = await seedCaseFor(handle, anon.userId);
    const target = await (await import('../_db/seed-auth')).seedAuthedUser(handle, email);

    // Rows that repository.applyUpdate writes under the anon user during an anonymous chat session.
    await handle.db.insert(schema.activityLog).values({
      caseId,
      userId: anon.userId,
      kind: 'case.facts.updated',
      payload: { paths: ['employment.employerName'] } as never,
    });
    await handle.db.insert(schema.profileChanges).values({
      userId: anon.userId,
      fieldPath: 'nationality',
      oldValue: null,
      newValue: 'IN',
      source: 'user_stated',
      confidence: '0.90',
    });

    await promoteToAuthed(handle.db, { anonymousUserId: anon.userId, email });

    // Audit rows survive the merge: their user_id FK still resolves to a (tombstoned) user.
    const auditLogs = await handle.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.userId, anon.userId));
    expect(auditLogs).toHaveLength(1);

    const changes = await handle.db
      .select()
      .from(schema.profileChanges)
      .where(eq(schema.profileChanges.userId, anon.userId));
    expect(changes).toHaveLength(1);

    // The anon user is tombstoned, not deleted — so the audit FKs remain valid.
    const anonRow = await handle.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, anon.userId));
    expect(anonRow).toHaveLength(1);

    // The case still re-points to the target.
    const targetCases = await handle.db
      .select()
      .from(schema.cases)
      .where(eq(schema.cases.userId, target.userId));
    expect(targetCases).toHaveLength(1);
  });

  it('idempotent: calling twice with same inputs yields same end state', async () => {
    const email = 'kavya@example.com';
    const anon = await seedAnonUser(handle);
    await seedCaseFor(handle, anon.userId);

    const r1 = await promoteToAuthed(handle.db, { anonymousUserId: anon.userId, email });
    expect(r1.targetUserId).toBe(anon.userId);

    // Second call with the same anon id: anon is now authed, no merge needed
    const r2 = await promoteToAuthed(handle.db, { anonymousUserId: anon.userId, email });
    expect(r2.targetUserId).toBe(anon.userId);

    const idents = await handle.db
      .select()
      .from(schema.userIdentities)
      .where(eq(schema.userIdentities.providerId, email));
    expect(idents).toHaveLength(1);
  });

  it('race: two parallel calls with same anon + email leave consistent state', async () => {
    const email = 'arjun@example.com';
    const anon = await seedAnonUser(handle);
    await seedCaseFor(handle, anon.userId);
    await seedCaseFor(handle, anon.userId);

    const [r1, r2] = await Promise.all([
      promoteToAuthed(handle.db, { anonymousUserId: anon.userId, email }),
      promoteToAuthed(handle.db, { anonymousUserId: anon.userId, email }),
    ]);
    expect(r1.targetUserId).toBe(r2.targetUserId);

    const idents = await handle.db
      .select()
      .from(schema.userIdentities)
      .where(eq(schema.userIdentities.providerId, email));
    expect(idents).toHaveLength(1);
  });

  it('branch (a): no anon, no existing — creates new user from scratch', async () => {
    const email = 'vikram@example.com';
    const { targetUserId } = await promoteToAuthed(handle.db, {
      anonymousUserId: null,
      email,
    });

    const [user] = await handle.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, targetUserId));
    expect(user?.isAnonymous).toBe(false);

    const idents = await handle.db
      .select()
      .from(schema.userIdentities)
      .where(eq(schema.userIdentities.userId, targetUserId));
    expect(idents).toHaveLength(1);
    expect(idents[0]?.providerId).toBe(email);
  });

  it('self-merge: existing user signs in with no anon session', async () => {
    const email = 'samir@example.com';
    const { seedAuthedUser } = await import('../_db/seed-auth');
    const target = await seedAuthedUser(handle, email);

    const before = await handle.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.userId, target.userId));
    expect(before).toHaveLength(0);

    const { targetUserId } = await promoteToAuthed(handle.db, {
      anonymousUserId: null,
      email,
    });
    expect(targetUserId).toBe(target.userId);

    const after = await handle.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.userId, target.userId));
    expect(after).toHaveLength(0);
  });
});
