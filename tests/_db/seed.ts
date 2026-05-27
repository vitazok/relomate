import { sql } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import type { TestDbHandle } from './setup';

export interface SeededIds {
  organizationId: string;
  userId: string;
}

/** Insert a single org + user in the test schema. Returns their UUIDs. */
export async function seedOrgAndUser(handle: TestDbHandle): Promise<SeededIds> {
  const { db } = handle;
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: 'Test Org', kind: 'personal' })
    .returning({ id: schema.organizations.id });
  if (!org) throw new Error('failed to insert organization');
  const [user] = await db
    .insert(schema.users)
    .values({ organizationId: org.id, isAnonymous: true })
    .returning({ id: schema.users.id });
  if (!user) throw new Error('failed to insert user');
  return { organizationId: org.id, userId: user.id };
}
