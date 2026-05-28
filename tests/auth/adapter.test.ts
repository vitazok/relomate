import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedAuthedUser } from '../_db/seed-auth';
import { makeVerificationAdapter } from '@/lib/auth/adapter';
import * as schema from '@/lib/db/schema';

describe('verificationAdapter', () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestSchema(); });
  afterAll(async () => { await handle.cleanup(); });

  it('createVerificationToken inserts a row', async () => {
    const adapter = makeVerificationAdapter(handle.db);
    const expires = new Date(Date.now() + 60_000);
    await adapter.createVerificationToken!({
      identifier: 'a@b.com',
      token: 'tok-1',
      expires,
    });
    const rows = await handle.db
      .select()
      .from(schema.verificationTokens)
      .where(eq(schema.verificationTokens.token, 'tok-1'));
    expect(rows).toHaveLength(1);
  });

  it('useVerificationToken deletes and returns the row', async () => {
    const adapter = makeVerificationAdapter(handle.db);
    const expires = new Date(Date.now() + 60_000);
    await adapter.createVerificationToken!({
      identifier: 'c@d.com',
      token: 'tok-2',
      expires,
    });
    const used = await adapter.useVerificationToken!({
      identifier: 'c@d.com',
      token: 'tok-2',
    });
    expect(used?.token).toBe('tok-2');

    const rows = await handle.db
      .select()
      .from(schema.verificationTokens)
      .where(eq(schema.verificationTokens.token, 'tok-2'));
    expect(rows).toHaveLength(0);
  });

  it('useVerificationToken returns null on miss', async () => {
    const adapter = makeVerificationAdapter(handle.db);
    const used = await adapter.useVerificationToken!({
      identifier: 'nope@nope.com',
      token: 'never',
    });
    expect(used).toBeNull();
  });

  it('getUserByEmail returns adapter user when identity exists', async () => {
    const adapter = makeVerificationAdapter(handle.db);
    const seeded = await seedAuthedUser(handle, 'priya2@example.com');
    const got = await adapter.getUserByEmail!('priya2@example.com');
    expect(got?.id).toBe(seeded.userId);
    expect(got?.email).toBe('priya2@example.com');
  });

  it('getUserByEmail returns null on miss', async () => {
    const adapter = makeVerificationAdapter(handle.db);
    const got = await adapter.getUserByEmail!('nobody@example.com');
    expect(got).toBeNull();
  });
});
