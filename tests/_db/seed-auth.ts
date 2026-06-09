import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import type { TestDbHandle } from './setup';

export interface SeededAnon {
  organizationId: string;
  userId: string;
}

export interface SeededAuthed {
  organizationId: string;
  userId: string;
  email: string;
}

export async function seedAnonUser(handle: TestDbHandle): Promise<SeededAnon> {
  const { db } = handle;
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: 'Anon Org', kind: 'individual_anon' })
    .returning({ id: schema.organizations.id });
  if (!org) throw new Error('failed to insert organization');
  const [user] = await db
    .insert(schema.users)
    .values({ organizationId: org.id, isAnonymous: true })
    .returning({ id: schema.users.id });
  if (!user) throw new Error('failed to insert user');
  await db.insert(schema.organizationMembers).values({
    organizationId: org.id,
    userId: user.id,
    role: 'firm_admin',
  });
  return { organizationId: org.id, userId: user.id };
}

export async function seedAuthedUser(
  handle: TestDbHandle,
  email: string,
): Promise<SeededAuthed> {
  const { db } = handle;
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: 'Authed Org', kind: 'individual' })
    .returning({ id: schema.organizations.id });
  if (!org) throw new Error('failed to insert organization');
  const [user] = await db
    .insert(schema.users)
    .values({ organizationId: org.id, isAnonymous: false })
    .returning({ id: schema.users.id });
  if (!user) throw new Error('failed to insert user');
  await db.insert(schema.organizationMembers).values({
    organizationId: org.id,
    userId: user.id,
    role: 'firm_admin',
  });
  await db.insert(schema.userIdentities).values({
    userId: user.id,
    provider: 'email_magiclink',
    providerId: email,
    verifiedAt: new Date(),
  });
  return { organizationId: org.id, userId: user.id, email };
}

export async function seedCaseFor(
  handle: TestDbHandle,
  userId: string,
): Promise<{ caseId: string }> {
  const { db } = handle;
  const [user] = await db
    .select({ organizationId: schema.users.organizationId })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!user) throw new Error('failed to find user');
  const [c] = await db
    .insert(schema.cases)
    .values({
      userId,
      organizationId: user.organizationId,
      primaryApplicantUserId: userId,
      status: 'active',
      visaType: 'eu_blue_card',
      targetCountry: 'DE',
    })
    .returning({ id: schema.cases.id });
  if (!c) throw new Error('failed to insert case');
  await db.insert(schema.caseFacts).values({ caseId: c.id, data: { schemaVersion: 1 } as never });
  await db.insert(schema.caseParticipants).values({
    caseId: c.id,
    organizationId: user.organizationId,
    userId,
    role: 'applicant',
    invitationStatus: 'active',
    visibility: 'shared',
    relation: { kind: 'primary_applicant' },
  });
  return { caseId: c.id };
}

export async function seedProfileFor(
  handle: TestDbHandle,
  userId: string,
  data: Record<string, unknown> = { schemaVersion: 1 },
): Promise<void> {
  const { db } = handle;
  await db.insert(schema.profiles).values({ userId, data: data as never });
}
