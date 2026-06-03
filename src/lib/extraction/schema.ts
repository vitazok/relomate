import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { ExtractionSchema, SpineItem } from './types';

const RULES_DIR = join(process.cwd(), 'config', 'rules');

const FieldSpecYaml = z.object({
  type: z.enum(['string', 'date', 'number', 'boolean']),
  sensitive: z.boolean().optional().default(false),
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
            { type: v.type, sensitive: v.sensitive },
          ]),
        ),
      });
    }
  }
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

/** Test-only: clear the module cache so subsequent calls re-read the YAML. */
export function __resetExtractionSchemaCacheForTests(): void {
  cache = null;
}
