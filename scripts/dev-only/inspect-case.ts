import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const caseId = process.argv[2];

async function main() {
  if (!caseId) {
    console.error('usage: inspect-case.ts <caseId>');
    process.exit(1);
  }

  const facts = await pool.query(
    `SELECT data FROM case_facts WHERE case_id = $1`,
    [caseId],
  );
  console.log('=== case_facts.data ===');
  console.log(JSON.stringify(facts.rows[0]?.data ?? null, null, 2));

  const msgs = await pool.query(
    `SELECT m.role, m.created_at,
            jsonb_array_length(coalesce(m.parts, '[]'::jsonb)) AS part_count
     FROM messages m
     JOIN threads t ON t.id = m.thread_id
     WHERE t.case_id = $1
     ORDER BY m.created_at`,
    [caseId],
  );
  console.log('\n=== messages (role, parts) ===');
  for (const r of msgs.rows) {
    console.log(`  ${r.role} parts=${r.part_count} at=${r.created_at.toISOString()}`);
  }

  const acts = await pool.query(
    `SELECT kind, payload, created_at FROM activity_log
     WHERE case_id = $1 ORDER BY created_at`,
    [caseId],
  );
  console.log('\n=== activity_log ===');
  for (const r of acts.rows) {
    console.log(`  ${r.kind}: ${JSON.stringify(r.payload)}`);
  }
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    pool.end();
    process.exit(1);
  });
