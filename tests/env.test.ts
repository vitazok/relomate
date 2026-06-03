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

describe('R2 + Reducto env', () => {
  const base = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://x',
    AUTH_SECRET: 'x'.repeat(32),
    ANTHROPIC_API_KEY: 'k',
    AUTH_RESEND_KEY: 'r',
    EMAIL_FROM: 'a@b.com',
    AUTH_URL: 'https://x',
    INNGEST_EVENT_KEY: 'e',
    INNGEST_SIGNING_KEY: 's',
  };

  it('requires R2_* in production', () => {
    const r = EnvSchema.safeParse(base);
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join('.'));
      for (const key of [
        'R2_ACCOUNT_ID',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'R2_BUCKET',
        'R2_ENDPOINT',
      ]) {
        expect(paths).toContain(key);
      }
    }
  });

  it('passes in production when R2_* present', () => {
    const r = EnvSchema.safeParse({
      ...base,
      R2_ACCOUNT_ID: 'acct',
      R2_ACCESS_KEY_ID: 'ak',
      R2_SECRET_ACCESS_KEY: 'sk',
      R2_BUCKET: 'visa-docs',
      R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
    });
    expect(r.success).toBe(true);
  });

  it('does NOT require R2_* outside production', () => {
    const r = EnvSchema.safeParse({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://x',
      AUTH_SECRET: 'x'.repeat(32),
      ANTHROPIC_API_KEY: 'k',
    });
    expect(r.success).toBe(true);
  });
});
