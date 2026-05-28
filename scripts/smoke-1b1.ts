import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { makeRepository } from '@/lib/case/repository';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL not set; run via `pnpm smoke:1b1` (loads .env.local).');
  }
  const pool = new Pool({ connectionString: url, max: 2 });
  const db = drizzle(pool, { schema });

  const [org] = await db
    .insert(schema.organizations)
    .values({ name: 'Smoke Org', kind: 'personal' })
    .returning({ id: schema.organizations.id });
  if (!org) throw new Error('failed to seed org');
  const [user] = await db
    .insert(schema.users)
    .values({ organizationId: org.id, isAnonymous: true })
    .returning({ id: schema.users.id });
  if (!user) throw new Error('failed to seed user');
  console.log('seeded user', user.id, 'in org', org.id);

  const repo = makeRepository(db, null);
  const { caseId } = await repo.createCase({
    userId: user.id,
    visaType: 'blue_card',
    targetCountry: 'DE',
    targetConsulate: 'bengaluru',
  });
  console.log('created case', caseId);

  const r1 = await repo.applyUpdate({
    caseId,
    source: 'user_stated',
    sourceTurnId: '00000000-0000-4000-8000-000000000001',
    confidence: 0.9,
    updates: { 'employment.annualGrossSalaryEur': 48500, 'education.anabinStatus': 'H+' },
  });
  console.log('write 1:', r1);

  const r2 = await repo.applyUpdate({
    caseId,
    source: 'user_corrected',
    sourceTurnId: '00000000-0000-4000-8000-000000000002',
    confidence: 0.9,
    updates: { 'employment.annualGrossSalaryEur': 55000 },
  });
  console.log('write 2:', r2);

  const loaded = await repo.loadCase(caseId);
  console.log('caseFacts.employment.annualGrossSalaryEur:', loaded.caseFacts.employment?.annualGrossSalaryEur);
  console.log('caseFacts.education.anabinStatus:', loaded.caseFacts.education?.anabinStatus);

  await db.delete(schema.activityLog).where(eq(schema.activityLog.caseId, caseId));
  await db.delete(schema.caseChanges).where(eq(schema.caseChanges.caseId, caseId));
  await db.delete(schema.caseFacts).where(eq(schema.caseFacts.caseId, caseId));
  await db.delete(schema.cases).where(eq(schema.cases.id, caseId));
  await db.delete(schema.profileChanges).where(eq(schema.profileChanges.userId, user.id));
  await db.delete(schema.profiles).where(eq(schema.profiles.userId, user.id));
  await db.delete(schema.users).where(eq(schema.users.id, user.id));
  await db.delete(schema.organizations).where(eq(schema.organizations.id, org.id));
  console.log('cleaned up.');

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
