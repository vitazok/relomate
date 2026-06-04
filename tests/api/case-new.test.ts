import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import * as schema from '@/lib/db/schema';

let testHandle: TestDbHandle;

const cookieStore = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => {
      const v = cookieStore.get(name);
      return v ? { name, value: v } : undefined;
    },
    set: (name: string, value: string) => { cookieStore.set(name, value); },
    delete: (name: string) => { cookieStore.delete(name); },
  }),
}));

vi.mock('@/lib/db/client', () => ({
  get db() { return testHandle.db; },
}));

describe('POST /api/case/new', () => {
  beforeAll(async () => { testHandle = await createTestSchema(); });
  afterAll(async () => { if (testHandle) await testHandle.cleanup(); });
  beforeEach(async () => {
    cookieStore.clear();
    vi.clearAllMocks();
    await testHandle.db.execute(
      sql`TRUNCATE TABLE cases, users, organizations RESTART IDENTITY CASCADE`,
    );
  });

  it('mints anon session, creates case + thread, redirects to /case/<id>', async () => {
    const { POST } = await import('@/app/api/case/new/route');
    const res = await POST(new Request('http://localhost/api/case/new', { method: 'POST' }));

    expect([303, 307].includes(res.status)).toBe(true);
    const location = res.headers.get('location') ?? '';
    const match = /\/case\/([0-9a-f-]{36})/.exec(location);
    expect(match).not.toBeNull();

    expect(cookieStore.get('relomate_session')).toBeDefined();

    const cases = await testHandle.db.select().from(schema.cases);
    expect(cases).toHaveLength(1);
    const threads = await testHandle.db.select().from(schema.threads);
    expect(threads).toHaveLength(1);
  });

  it('seeds the new case from ?persona=<id> when provided (#15)', async () => {
    const { POST } = await import('@/app/api/case/new/route');
    const res = await POST(
      new Request('http://localhost/api/case/new?persona=priya-strong', { method: 'POST' }),
    );
    expect(res.status).toBeGreaterThanOrEqual(300);
    const location = res.headers.get('location') ?? '';
    const match = /\/case\/([0-9a-f-]{36})/.exec(location);
    expect(match).not.toBeNull();
    const caseId = match![1]!;

    const facts = await testHandle.db
      .select()
      .from(schema.caseFacts)
      .where(eq(schema.caseFacts.caseId, caseId));
    const data = facts[0]?.data as { employment?: { annualGrossSalaryEur?: { value: number } } };
    // priya-strong has a salary on file — seeding must have populated case_facts.
    expect(data?.employment?.annualGrossSalaryEur?.value).toBeGreaterThan(0);
  });

  it('ignores an unknown ?persona=<id> and still creates an empty case (#15)', async () => {
    const { POST } = await import('@/app/api/case/new/route');
    const res = await POST(
      new Request('http://localhost/api/case/new?persona=does-not-exist', { method: 'POST' }),
    );
    expect(res.status).toBeGreaterThanOrEqual(300);
    const cases = await testHandle.db.select().from(schema.cases);
    expect(cases).toHaveLength(1);
  });

  it('reuses an existing anon session if the cookie is valid', async () => {
    const { POST } = await import('@/app/api/case/new/route');
    const first = await POST(new Request('http://localhost/api/case/new', { method: 'POST' }));
    expect(first.status).toBeGreaterThanOrEqual(300);
    const cookieAfterFirst = cookieStore.get('relomate_session');

    const second = await POST(new Request('http://localhost/api/case/new', { method: 'POST' }));
    expect(second.status).toBeGreaterThanOrEqual(300);
    expect(cookieStore.get('relomate_session')).toBe(cookieAfterFirst);

    const users = await testHandle.db.select().from(schema.users);
    expect(users).toHaveLength(1);  // anon user reused
    const cases = await testHandle.db.select().from(schema.cases);
    expect(cases).toHaveLength(2);  // two cases, same user
  });
});
