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
});
