import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { JourneyManifest } from './types';

const RULES_DIR = join(process.cwd(), 'config', 'rules');

let cache: JourneyManifest | null = null;

export function getJourneyManifest(): JourneyManifest {
  if (cache) return cache;
  const raw = readFileSync(join(RULES_DIR, 'journey.yaml'), 'utf8');
  const result = JourneyManifest.safeParse(yaml.load(raw));
  if (!result.success) {
    throw new Error(`Invalid config/rules/journey.yaml: ${result.error.message}`);
  }
  cache = result.data;
  return cache;
}

/** Test-only: clear the module cache so subsequent calls re-read the YAML. */
export function __resetJourneyCacheForTests(): void {
  cache = null;
}
