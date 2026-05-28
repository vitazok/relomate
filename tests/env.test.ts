import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('env', () => {
  const original = { ...process.env };

  beforeEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, original);
  });

  it('parses a complete environment', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgres://u:p@h:6543/db';
    process.env.DIRECT_URL = 'postgres://u:p@h:5432/db';
    process.env.AUTH_SECRET = 'a'.repeat(32);
    const { vi } = await import('vitest');
    vi.resetModules();
    const { env } = await import('@/lib/env');
    expect(env.DATABASE_URL).toBe('postgres://u:p@h:6543/db');
    expect(env.DIRECT_URL).toBe('postgres://u:p@h:5432/db');
  });

  it('rejects missing DATABASE_URL', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'test';
    const { vi } = await import('vitest');
    vi.resetModules();
    await expect(import('@/lib/env')).rejects.toThrow(/DATABASE_URL/);
  });
});
