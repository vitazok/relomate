import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import type { Adapter, AdapterUser } from 'next-auth/adapters';
import { db as defaultDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';

type Db = ReturnType<typeof drizzle<typeof schema>>;

function toAdapterUser(input: { id: string; email: string }): AdapterUser {
  return {
    id: input.id,
    email: input.email,
    emailVerified: null,
    name: null,
    image: null,
  };
}

export function makeVerificationAdapter(db: Db): Adapter {
  return {
    async createVerificationToken(token) {
      await db.insert(schema.verificationTokens).values({
        identifier: token.identifier,
        token: token.token,
        expires: token.expires,
      });
      return token;
    },

    async useVerificationToken({ identifier, token }) {
      const [row] = await db
        .delete(schema.verificationTokens)
        .where(
          and(
            eq(schema.verificationTokens.identifier, identifier),
            eq(schema.verificationTokens.token, token),
          ),
        )
        .returning();
      return row ?? null;
    },

    async getUserByEmail(email) {
      const [row] = await db
        .select({ id: schema.users.id })
        .from(schema.userIdentities)
        .innerJoin(schema.users, eq(schema.users.id, schema.userIdentities.userId))
        .where(
          and(
            eq(schema.userIdentities.provider, 'email_magiclink'),
            eq(schema.userIdentities.providerId, email),
          ),
        )
        .limit(1);
      return row ? toAdapterUser({ id: row.id, email }) : null;
    },

    async createUser(user) {
      // We do NOT insert into users here. Real user rows are created by
      // ensureAnonymousSession or promoteToAuthed. Auth.js needs *some* user
      // shape back to keep its JWT flow happy; the id we return is the one
      // it'll embed in the JWT.
      return {
        id: user.id ?? randomUUID(),
        email: user.email,
        emailVerified: user.emailVerified ?? null,
        name: null,
        image: null,
      };
    },

    async linkAccount() {
      return undefined;
    },

    async getUser() {
      return null;
    },

    async getUserByAccount() {
      return null;
    },

    async updateUser(user) {
      const [ident] = await db
        .select({ email: schema.userIdentities.providerId })
        .from(schema.userIdentities)
        .where(
          and(
            eq(schema.userIdentities.userId, user.id!),
            eq(schema.userIdentities.provider, 'email_magiclink'),
          ),
        )
        .limit(1);
      return {
        id: user.id!,
        email: ident?.email ?? (user as Partial<AdapterUser>).email ?? '',
        emailVerified: user.emailVerified ?? new Date(),
        name: null,
        image: null,
      };
    },
  };
}

/** Convenience export for the Auth.js config to avoid passing db through. */
export const verificationAdapter: Adapter = makeVerificationAdapter(defaultDb);
