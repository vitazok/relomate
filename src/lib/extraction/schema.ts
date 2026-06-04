import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { ExtractionSchema, SpineItem } from './types';
import { validateLeafPath } from '@/lib/case/paths';

const RULES_DIR = join(process.cwd(), 'config', 'rules');

const FieldSpecYaml = z.object({
  type: z.enum(['string', 'date', 'number', 'boolean']),
  sensitive: z.boolean().optional().default(false),
  target: z.string().optional(),
  transform: z.string().optional(),
  part: z.string().optional(),
});

const ItemYaml = z.object({
  id: z.string(),
  label: z.string(),
  section: z.string(),
  extraction: z
    .object({ fields: z.record(z.string(), FieldSpecYaml) })
    .optional(),
});

const DocumentsYaml = z.object({
  items: z.array(ItemYaml),
});

interface Loaded {
  schemas: Map<string, ExtractionSchema>;
  spine: SpineItem[];
}

let cache: Loaded | null = null;

function load(): Loaded {
  if (cache) return cache;
  const raw = readFileSync(join(RULES_DIR, 'documents.yaml'), 'utf8');
  const parsed = DocumentsYaml.safeParse(yaml.load(raw));
  if (!parsed.success) {
    throw new Error(`Invalid config/rules/documents.yaml: ${parsed.error.message}`);
  }
  const schemas = new Map<string, ExtractionSchema>();
  const spine: SpineItem[] = [];
  for (const item of parsed.data.items) {
    spine.push({ id: item.id, label: item.label, section: item.section });
    if (item.extraction) {
      schemas.set(item.id, {
        spineItemId: item.id,
        fields: Object.fromEntries(
          Object.entries(item.extraction.fields).map(([k, v]) => [
            k,
            {
              type: v.type,
              sensitive: v.sensitive,
              ...(v.target ? { target: v.target } : {}),
              ...(v.transform ? { transform: v.transform } : {}),
              ...(v.part ? { part: v.part } : {}),
            },
          ]),
        ),
      });
    }
  }
  assertValidTargets(schemas);
  cache = { schemas, spine };
  return cache;
}

export function getExtractionSchema(spineItemId: string): ExtractionSchema | null {
  return load().schemas.get(spineItemId) ?? null;
}

export function listExtractableItems(): string[] {
  return [...load().schemas.keys()];
}

export function getDocumentSpine(): SpineItem[] {
  return load().spine;
}

export function sensitiveKeys(schema: ExtractionSchema): string[] {
  return Object.entries(schema.fields)
    .filter(([, spec]) => spec.sensitive)
    .map(([k]) => k);
}

/**
 * Fail-fast guard: every extraction-field `target` must resolve to a real case/profile
 * leaf path. A typo here would otherwise surface only at confirm-time as a write failure.
 */
export function assertValidTargets(schemas: Map<string, ExtractionSchema>): void {
  for (const [spineItemId, schema] of schemas) {
    for (const [fieldKey, spec] of Object.entries(schema.fields)) {
      if (!spec.target) continue;
      try {
        validateLeafPath(spec.target);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Invalid extraction target for ${spineItemId}.${fieldKey}: "${spec.target}" — ${msg}`,
        );
      }
    }
  }
}

/** Test-only: clear the module cache so subsequent calls re-read the YAML. */
export function __resetExtractionSchemaCacheForTests(): void {
  cache = null;
}
