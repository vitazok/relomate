import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PersonaSchema } from '../../data/personas/schema';

const PERSONAS_DIR = join(process.cwd(), 'data', 'personas');

describe('persona library', () => {
  const files = readdirSync(PERSONAS_DIR).filter((f) => f.endsWith('.json'));

  it('finds the shipped personas', () => {
    expect(files.sort()).toEqual([
      'arjun-it-no-degree.json',
      'out-of-scope-asylum.json',
      'priya-strong.json',
      'toronto-canadian-visa-free-option.json',
      'toronto-edge-anabin.json',
      'toronto-non-canadian-resident.json',
      'toronto-strong-pretravel.json',
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

  it('loads firm role metadata for every persona', () => {
    for (const f of files) {
      const persona = PersonaSchema.parse(JSON.parse(readFileSync(join(PERSONAS_DIR, f), 'utf8')));
      expect(persona.firm.participants.some((p) => p.role === 'primary_applicant')).toBe(true);
      expect(persona.firm.participants.some((p) => p.role === 'consultant')).toBe(true);
      expect(persona.firm.reviewerRole).toMatch(/^(reviewer|consultant)$/);
    }
  });

  it('marks Toronto personas with the Canada/Toronto firm flow', () => {
    const toronto = files.filter((f) => f.startsWith('toronto-'));
    expect(toronto.length).toBe(4);
    for (const f of toronto) {
      const persona = PersonaSchema.parse(JSON.parse(readFileSync(join(PERSONAS_DIR, f), 'utf8')));
      expect(persona.firm.sourceResidenceFlow).toBe('canada_toronto');
      expect(persona.caseFacts.target?.consulate).toBe('toronto');
    }
  });
});
