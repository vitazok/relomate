import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const tables = ['organizations', 'users', 'cases', 'case_facts', 'threads', 'messages'];
  for (const t of tables) {
    try {
      const r = await pool.query(`SELECT count(*)::int AS n FROM ${t}`);
      console.log(`${t}: ${r.rows[0].n}`);
    } catch (e) {
      console.log(`${t}: ERROR ${(e as Error).message}`);
    }
  }

  console.log('\nMost recent 5 cases:');
  const cases = await pool.query(`
    SELECT c.id, c.user_id, c.created_at,
           (SELECT count(*)::int FROM threads t WHERE t.case_id = c.id) AS thread_count,
           (SELECT count(*)::int FROM case_facts f WHERE f.case_id = c.id) AS facts_count
    FROM cases c
    ORDER BY c.created_at DESC
    LIMIT 5
  `);
  for (const row of cases.rows) {
    console.log(`  case ${row.id} user=${row.user_id} threads=${row.thread_count} facts=${row.facts_count} at=${row.created_at.toISOString()}`);
  }

  console.log('\nMost recent 3 users:');
  const users = await pool.query(`SELECT id, organization_id, is_anonymous, created_at FROM users ORDER BY created_at DESC LIMIT 3`);
  for (const u of users.rows) {
    console.log(`  user ${u.id} anon=${u.is_anonymous} org=${u.organization_id} at=${u.created_at.toISOString()}`);
  }

  console.log('\nthreads table columns:');
  const cols = await pool.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='threads' ORDER BY ordinal_position
  `);
  for (const c of cols.rows) console.log(`  ${c.column_name} ${c.data_type}`);

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
