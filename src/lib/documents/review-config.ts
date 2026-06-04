import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';

const RULES_DIR = join(process.cwd(), 'config', 'rules');

export interface ConfidenceBands {
  high: number;
  low: number;
}

const ReviewYaml = z.object({
  schemaVersion: z.literal(1),
  confidenceBands: z.object({ high: z.number().min(0).max(1), low: z.number().min(0).max(1) }),
  nationalityToIso2: z.record(z.string(), z.string().length(2)),
});

interface Loaded {
  confidenceBands: ConfidenceBands;
  nationalityToIso2: Map<string, string>;
}

let cache: Loaded | null = null;

function load(): Loaded {
  if (cache) return cache;
  const raw = readFileSync(join(RULES_DIR, 'review.yaml'), 'utf8');
  const parsed = ReviewYaml.safeParse(yaml.load(raw));
  if (!parsed.success) throw new Error(`Invalid config/rules/review.yaml: ${parsed.error.message}`);
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(parsed.data.nationalityToIso2)) map.set(k.toLowerCase(), v.toUpperCase());
  cache = { confidenceBands: parsed.data.confidenceBands, nationalityToIso2: map };
  return cache;
}

export function getConfidenceBands(): ConfidenceBands {
  return load().confidenceBands;
}

export function getNationalityIso2Map(): Map<string, string> {
  return load().nationalityToIso2;
}

/** Test-only: clear the module cache. */
export function __resetReviewConfigCacheForTests(): void {
  cache = null;
}
