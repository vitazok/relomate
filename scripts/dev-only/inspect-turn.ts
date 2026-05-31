import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const caseId = process.argv[2];
  if (!caseId) {
    console.error('usage: inspect-turn.ts <caseId>');
    process.exit(1);
  }

  const threads = await pool.query(
    `SELECT id FROM threads WHERE case_id = $1`,
    [caseId],
  );
  if (threads.rows.length === 0) {
    console.log('no thread for case', caseId);
    await pool.end();
    return;
  }
  const threadId = threads.rows[0].id;

  const msgs = await pool.query(
    `SELECT id, role, content, parts, created_at
     FROM messages WHERE thread_id = $1 ORDER BY created_at ASC`,
    [threadId],
  );

  for (const m of msgs.rows) {
    console.log(`\n===== ${m.role} @ ${m.created_at.toISOString()} =====`);
    console.log('content:', JSON.stringify(m.content).slice(0, 400));
    if (m.parts) {
      const parts = m.parts as Array<Record<string, unknown>>;
      for (const p of parts) {
        const type = p.type as string;
        if (type === 'text') {
          console.log(`  [text] ${String(p.text).slice(0, 300)}`);
        } else if (typeof type === 'string' && type.startsWith('tool-')) {
          console.log(`  [${type}] state=${p.state ?? '?'}`);
          if (p.input !== undefined) console.log(`    input: ${JSON.stringify(p.input)}`);
          if (p.output !== undefined) console.log(`    output: ${JSON.stringify(p.output).slice(0, 500)}`);
          if (p.errorText !== undefined) console.log(`    errorText: ${JSON.stringify(p.errorText)}`);
        } else {
          console.log(`  [${type}] ${JSON.stringify(p).slice(0, 300)}`);
        }
      }
    }
  }

  // Also dump the case_facts so we see what actually persisted.
  const facts = await pool.query(`SELECT data FROM case_facts WHERE case_id = $1`, [caseId]);
  console.log('\n===== case_facts.data =====');
  console.log(JSON.stringify(facts.rows[0]?.data ?? {}, null, 2));

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
