import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { z } from 'zod';
import {
  AnabinSeed,
  type AnabinInstitution,
  ApostilleRules,
  BlueCardRules,
  type ConsulateRules,
  ConsulatesFile,
  DocumentRules,
  FirmKnowledgeConfig,
  FamilyRules,
  ShortageOccupationsRules,
  type ConsulateId,
  type ShortageMapping,
} from './types';

const RULES_DIR = join(process.cwd(), 'config', 'rules');

type Cache = {
  blueCard: z.infer<typeof BlueCardRules>;
  family: z.infer<typeof FamilyRules>;
  consulates: z.infer<typeof ConsulatesFile>;
  apostille: z.infer<typeof ApostilleRules>;
  shortage: z.infer<typeof ShortageOccupationsRules>;
  anabin: z.infer<typeof AnabinSeed>;
  documents: z.infer<typeof DocumentRules>;
  firmKnowledge: z.infer<typeof FirmKnowledgeConfig>;
};

let cache: Cache | null = null;

function parseYaml<T>(file: string, schema: z.ZodType<T>): T {
  const raw = readFileSync(join(RULES_DIR, file), 'utf8');
  const data = yaml.load(raw);
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Invalid rules YAML at config/rules/${file}: ${result.error.message}`,
    );
  }
  return result.data;
}

function loadAll(): Cache {
  if (cache) return cache;
  cache = {
    blueCard: parseYaml('blue-card.yaml', BlueCardRules),
    family: parseYaml('family-reunification.yaml', FamilyRules),
    consulates: parseYaml('consulates.yaml', ConsulatesFile),
    apostille: parseYaml('apostille.yaml', ApostilleRules),
    shortage: parseYaml('shortage-occupations.yaml', ShortageOccupationsRules),
    anabin: parseYaml('anabin-seed.yaml', AnabinSeed),
    documents: parseYaml('documents.yaml', DocumentRules),
    firmKnowledge: parseYaml('firm-knowledge.yaml', FirmKnowledgeConfig),
  };
  return cache;
}

export type Rules = Cache;

export function loadRules(): Rules {
  return loadAll();
}

export function getBlueCardRules(): Rules['blueCard'] {
  return loadAll().blueCard;
}

export function getFamilyRules(): Rules['family'] {
  return loadAll().family;
}

export function getConsulate(name: ConsulateId): ConsulateRules {
  return loadAll().consulates[name];
}

export function getApostilleRules(): Rules['apostille'] {
  return loadAll().apostille;
}

export function getShortageMappings(): ShortageMapping[] {
  return loadAll().shortage.mappings;
}

export function findShortageMappingByIscoGroup(group: string): ShortageMapping | undefined {
  return loadAll().shortage.mappings.find((m) => m.iscoGroup === group);
}

export function getDocumentRules(): Rules['documents'] {
  return loadAll().documents;
}

export function getFirmKnowledgeConfig(): Rules['firmKnowledge'] {
  return loadAll().firmKnowledge;
}

export function getAnabinInstitutionByName(name: string): AnabinInstitution | undefined {
  const needle = name.trim().toLowerCase();
  return loadAll().anabin.institutions.find(
    (i) => i.name.toLowerCase() === needle || i.id === needle,
  );
}

/** Test-only: clear the module cache so subsequent calls re-read the YAMLs. */
export function __resetRulesCacheForTests(): void {
  cache = null;
}
