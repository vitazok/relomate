import { getNationalityIso2Map } from '@/lib/documents/review-config';

export interface TransformField {
  key: string;
  value: unknown;
  part?: string;
}

// Returns the transformed value, or null when the inputs cannot be resolved (the caller
// then leaves the field UNMAPPED so the user is forced to pick/correct rather than writing junk).
export type Transform = (fields: TransformField[]) => unknown | null;

const composeFullName: Transform = (fields) => {
  const str = (part: string) => {
    const f = fields.find((x) => x.part === part);
    const v = typeof f?.value === 'string' ? f.value.trim() : '';
    return v;
  };
  const given = str('given');
  const surname = str('surname');
  const full = [given, surname].filter(Boolean).join(' ').trim();
  return full.length > 0 ? full : null;
};

const toIso2: Transform = (fields) => {
  const raw = fields[0]?.value;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const upper = trimmed.toUpperCase();
    // Accept a 2-letter code only if it's a value we know (in the seed map's values).
    const known = new Set([...getNationalityIso2Map().values()]);
    if (known.has(upper)) return upper;
  }
  return getNationalityIso2Map().get(trimmed.toLowerCase()) ?? null;
};

const registry: Record<string, Transform> = {
  composeFullName,
  toIso2,
};

export function applyTransform(name: string, fields: TransformField[]): unknown | null {
  const fn = registry[name];
  if (!fn) throw new Error(`unknown transform: ${name}`);
  return fn(fields);
}
