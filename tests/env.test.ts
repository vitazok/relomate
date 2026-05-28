import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EnvSchema } from '@/lib/env';

function parseEnv(input: Record<string, unknown>) {
  const result = EnvSchema.safeParse(input);
  return { ok: result.success, errors: result.success ? undefined : result.error.issues };
}

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
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
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

  it('rejects missing ANTHROPIC_API_KEY in any environment', () => {
    const result = parseEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://localhost:5432/db',
      AUTH_SECRET: 'a'.repeat(32),
    });
    expect(result.ok).toBe(false);
    expect(result.errors?.some((e) => e.path.includes('ANTHROPIC_API_KEY'))).toBe(true);
  });

  it('accepts missing INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY in development', () => {
    const result = parseEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://localhost:5432/db',
      AUTH_SECRET: 'a'.repeat(32),
      ANTHROPIC_API_KEY: 'sk-ant-test',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects missing INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY in production', () => {
    const result = parseEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://localhost:5432/db',
      AUTH_SECRET: 'a'.repeat(32),
      ANTHROPIC_API_KEY: 'sk-ant-test',
      AUTH_RESEND_KEY: 're_test',
      EMAIL_FROM: 'noreply@example.com',
      AUTH_URL: 'https://example.com',
    });
    expect(result.ok).toBe(false);
    expect(result.errors?.some((e) => e.path.includes('INNGEST_EVENT_KEY'))).toBe(true);
    expect(result.errors?.some((e) => e.path.includes('INNGEST_SIGNING_KEY'))).toBe(true);
  });
});
