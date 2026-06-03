import { z } from 'zod';

const optionalUrl = z
  .string()
  .transform((v) => (v === '' ? undefined : v))
  .pipe(z.string().url().optional())
  .optional();

const optionalString = z
  .string()
  .transform((v) => (v === '' ? undefined : v))
  .pipe(z.string().min(1).optional())
  .optional();

const optionalEmail = z
  .string()
  .transform((v) => (v === '' ? undefined : v))
  .pipe(z.string().email().optional())
  .optional();

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().url(),
    DIRECT_URL: optionalUrl,
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 chars'),
    AUTH_URL: optionalUrl,
    AUTH_RESEND_KEY: optionalString,
    EMAIL_FROM: optionalEmail,
    ANTHROPIC_API_KEY: z.string().min(1),
    INNGEST_EVENT_KEY: optionalString,
    INNGEST_SIGNING_KEY: optionalString,
    R2_ACCOUNT_ID: optionalString,
    R2_ACCESS_KEY_ID: optionalString,
    R2_SECRET_ACCESS_KEY: optionalString,
    R2_BUCKET: optionalString,
    R2_ENDPOINT: optionalUrl,
    REDUCTO_API_KEY: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (!env.AUTH_RESEND_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AUTH_RESEND_KEY'],
          message: 'AUTH_RESEND_KEY is required in production',
        });
      }
      if (!env.EMAIL_FROM) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_FROM'],
          message: 'EMAIL_FROM is required in production',
        });
      }
      if (!env.AUTH_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AUTH_URL'],
          message: 'AUTH_URL is required in production',
        });
      }
      if (!env.INNGEST_EVENT_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['INNGEST_EVENT_KEY'],
          message: 'INNGEST_EVENT_KEY is required in production',
        });
      }
      if (!env.INNGEST_SIGNING_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['INNGEST_SIGNING_KEY'],
          message: 'INNGEST_SIGNING_KEY is required in production',
        });
      }
      for (const key of [
        'R2_ACCOUNT_ID',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'R2_BUCKET',
        'R2_ENDPOINT',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required in production`,
          });
        }
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment variables:\n${issues}`);
}

export const env: Env = parsed.data;
