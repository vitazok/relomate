import { and, eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@/lib/db/schema';

type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface PromoteInput {
  anonymousUserId: string | null;
  email: string;
}

export interface PromoteResult {
  targetUserId: string;
}

async function findExistingByEmail(tx: Db, email: string) {
  const [row] = await tx
    .select({
      userId: schema.userIdentities.userId,
      orgId: schema.users.organizationId,
    })
    .from(schema.userIdentities)
    .innerJoin(schema.users, eq(schema.users.id, schema.userIdentities.userId))
    .where(
      and(
        eq(schema.userIdentities.provider, 'email_magiclink'),
        eq(schema.userIdentities.providerId, email),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function promoteToAuthed(
  db: Db,
  { anonymousUserId, email }: PromoteInput,
): Promise<PromoteResult> {
  return db.transaction(async (tx) => {
    const existing = await findExistingByEmail(tx as unknown as Db, email);

    if (!existing && anonymousUserId) {
      // Branch (b): promote anon in place
      await tx
        .update(schema.users)
        .set({ isAnonymous: false, lastSeenAt: new Date() })
        .where(eq(schema.users.id, anonymousUserId));

      await tx
        .insert(schema.userIdentities)
        .values({
          userId: anonymousUserId,
          provider: 'email_magiclink',
          providerId: email,
          verifiedAt: new Date(),
        })
        .onConflictDoNothing({
          target: [schema.userIdentities.provider, schema.userIdentities.providerId],
        });

      await tx.insert(schema.activityLog).values({
        userId: anonymousUserId,
        kind: 'auth.promoted_anon',
        payload: { email, from: 'anonymous' } as never,
      });

      return { targetUserId: anonymousUserId };
    }

    if (!existing && !anonymousUserId) {
      // Branch (a): create from scratch
      const [org] = await tx
        .insert(schema.organizations)
        .values({ name: email.split('@')[0] ?? 'individual', kind: 'individual' })
        .returning({ id: schema.organizations.id });
      if (!org) throw new Error('failed to insert organization');
      const [user] = await tx
        .insert(schema.users)
        .values({ organizationId: org.id, isAnonymous: false, lastSeenAt: new Date() })
        .returning({ id: schema.users.id });
      if (!user) throw new Error('failed to insert user');
      await tx
        .insert(schema.userIdentities)
        .values({
          userId: user.id,
          provider: 'email_magiclink',
          providerId: email,
          verifiedAt: new Date(),
        })
        .onConflictDoNothing({
          target: [schema.userIdentities.provider, schema.userIdentities.providerId],
        });
      return { targetUserId: user.id };
    }

    // Branch (c): existing — implemented in Task 4
    throw new Error('branch (c) not yet implemented');
  });
}
