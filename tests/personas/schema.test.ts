import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PersonaSchema } from '../../data/personas/schema';

const PERSONAS_DIR = join(process.cwd(), 'data', 'personas');

describe('persona library', () => {
  const files = readdirSync(PERSONAS_DIR).filter((f) => f.endsWith('.json'));

  it('finds the four shipped personas', () => {
    expect(files.sort()).toEqual([
      'arjun-it-no-degree.json',
      'out-of-scope-asylum.json',
      'priya-strong.json',
      'vikram-edge-anabin.json',
    ]);
  });

  for (const f of files) {
    it(`parses ${f}`, () => {
      const raw = JSON.parse(readFileSync(join(PERSONAS_DIR, f), 'utf8'));
      const result = PersonaSchema.safeParse(raw);
      if (!result.success) console.error(f, result.error.issues);
      expect(result.success).toBe(true);
    });
  }
});
