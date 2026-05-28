import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Load .env.test.local into process.env before any test module imports.
// Modules like @/lib/env validate at import time; vitest does not auto-load
// dotenv files, so we mirror the lightweight parser used in tests/_db/setup.ts.
const envPath = join(process.cwd(), '.env.test.local');
if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
