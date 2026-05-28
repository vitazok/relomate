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

    // Branch (c): existing user found
    const targetUserId = existing.userId;

    // Self-merge (existing == anon): just touch last_seen_at
    if (anonymousUserId === targetUserId) {
      await tx
        .update(schema.users)
        .set({ lastSeenAt: new Date() })
        .where(eq(schema.users.id, targetUserId));
      return { targetUserId };
    }

    let casesMerged = 0;
    let profileTransferred = false;
    let anonOrgId: string | null = null;

    if (anonymousUserId) {
      // Re-point cases
      const repointed = await tx
        .update(schema.cases)
        .set({ userId: targetUserId })
        .where(eq(schema.cases.userId, anonymousUserId))
        .returning({ id: schema.cases.id });
      casesMerged = repointed.length;

      // Look up anon org id for later deletion (users.organization_id is NOT NULL)
      const [anonRow] = await tx
        .select({ orgId: schema.users.organizationId })
        .from(schema.users)
        .where(eq(schema.users.id, anonymousUserId));
      anonOrgId = anonRow?.orgId ?? null;

      // Profile transfer: only if target has none
      const [targetProfile] = await tx
        .select({ userId: schema.profiles.userId })
        .from(schema.profiles)
        .where(eq(schema.profiles.userId, targetUserId));
      const [anonProfile] = await tx
        .select({ userId: schema.profiles.userId })
        .from(schema.profiles)
        .where(eq(schema.profiles.userId, anonymousUserId));

      if (anonProfile && !targetProfile) {
        await tx
          .update(schema.profiles)
          .set({ userId: targetUserId })
          .where(eq(schema.profiles.userId, anonymousUserId));
        profileTransferred = true;
      } else if (anonProfile) {
        await tx
          .delete(schema.profiles)
          .where(eq(schema.profiles.userId, anonymousUserId));
      }

      await tx.delete(schema.users).where(eq(schema.users.id, anonymousUserId));
      if (anonOrgId) {
        await tx.delete(schema.organizations).where(eq(schema.organizations.id, anonOrgId));
      }

      await tx.insert(schema.activityLog).values({
        userId: targetUserId,
        kind: 'auth.merged_anon',
        payload: {
          from: anonymousUserId,
          into: targetUserId,
          email,
          casesMerged,
          profileTransferred,
        } as never,
      });
    }

    await tx
      .update(schema.users)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.users.id, targetUserId));

    return { targetUserId };
  });
}
