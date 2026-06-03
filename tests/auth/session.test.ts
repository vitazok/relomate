import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedAnonUser, seedAuthedUser } from '../_db/seed-auth';
import { promoteToAuthed } from '@/lib/auth/merge';
import { encodeSession } from '@/lib/auth/cookie';

const cookieStore = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => {
      const v = cookieStore.get(name);
      return v ? { name, value: v } : undefined;
    },
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  }),
}));

let testHandle: TestDbHandle;
vi.mock('@/lib/db/client', () => ({
  get db() {
    return testHandle.db;
  },
}));

describe('getCurrentUserId (#13)', () => {
  beforeAll(async () => {
    testHandle = await createTestSchema();
  }, 30_000);
  afterAll(async () => {
    if (testHandle) await testHandle.cleanup();
  });
  beforeEach(() => {
    cookieStore.clear();
  });

  function setSession(userId: string) {
    cookieStore.set(
      'visa_session',
      encodeSession({ userId, iat: Date.now(), exp: Date.now() + 60_000 }),
    );
  }

  it('returns the userId for a live (existing) user', async () => {
    const { getCurrentUserId } = await import('@/lib/auth/session');
    const anon = await seedAnonUser(testHandle);
    setSession(anon.userId);
    expect(await getCurrentUserId()).toBe(anon.userId);
  });

  it('returns null for a userId that does not exist (deleted user)', async () => {
    const { getCurrentUserId } = await import('@/lib/auth/session');
    setSession('00000000-0000-4000-8000-0000000000ff');
    expect(await getCurrentUserId()).toBeNull();
  });

  it('returns null for a tombstoned (merged-away) anon user', async () => {
    const { getCurrentUserId } = await import('@/lib/auth/session');
    const email = 'tombstone@example.com';
    const anon = await seedAnonUser(testHandle);
    await seedAuthedUser(testHandle, email);
    // Branch (c): anon merges into the existing authed user → anon is tombstoned.
    await promoteToAuthed(testHandle.db, { anonymousUserId: anon.userId, email });

    setSession(anon.userId);
    expect(await getCurrentUserId()).toBeNull();
  });

  it('returns null when no cookie present', async () => {
    const { getCurrentUserId } = await import('@/lib/auth/session');
    expect(await getCurrentUserId()).toBeNull();
  });
});
