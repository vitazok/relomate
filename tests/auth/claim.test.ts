import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedAnonUser, seedCaseFor } from '../_db/seed-auth';
import { encodeSession } from '@/lib/auth/cookie';
import * as schema from '@/lib/db/schema';

vi.mock('@/lib/auth/config', () => ({
  auth: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
}));

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

// Force the route module to use our test DB instance via a module-level swap.
let testHandle: TestDbHandle;
vi.mock('@/lib/db/client', () => {
  return {
    get db() {
      return testHandle.db;
    },
  };
});

describe('/api/claim-anonymous', () => {
  beforeAll(async () => {
    testHandle = await createTestSchema();
  });
  afterAll(async () => { if (testHandle) await testHandle.cleanup(); });
  beforeEach(() => {
    cookieStore.clear();
    vi.clearAllMocks();
  });

  it('promotes anon user when no existing identity', async () => {
    const anon = await seedAnonUser(testHandle);
    await seedCaseFor(testHandle, anon.userId);
    cookieStore.set(
      'visa_session',
      encodeSession({
        userId: anon.userId,
        iat: Date.now(),
        exp: Date.now() + 60_000,
      }),
    );

    const { auth } = await import('@/lib/auth/config');
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { email: 'CLaIm@example.com  ' },
    });

    const { GET } = await import('@/app/api/claim-anonymous/route');
    const res = await GET(new Request('http://localhost/api/claim-anonymous'));

    expect(res.status).toBe(307); // NextResponse.redirect default

    const idents = await testHandle.db
      .select()
      .from(schema.userIdentities)
      .where(eq(schema.userIdentities.providerId, 'claim@example.com'));
    expect(idents).toHaveLength(1);
    expect(idents[0]?.userId).toBe(anon.userId);

    // Cookie should still point at the same userId (we promoted in place)
    expect(cookieStore.get('visa_session')).toBeDefined();
  });

  it('redirects to /signin?error=verification when no verified email', async () => {
    const { auth } = await import('@/lib/auth/config');
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { GET } = await import('@/app/api/claim-anonymous/route');
    const res = await GET(new Request('http://localhost/api/claim-anonymous'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/signin?error=verification');
  });
});
