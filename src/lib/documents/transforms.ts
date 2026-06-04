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

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function isoOrNull(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const iso = `${year}-${mm}-${dd}`;
  // Round-trip through Date to reject impossible days (e.g. 31 Feb, 32 Jan).
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) return null;
  return iso;
}

const normalizeDate: Transform = (fields) => {
  const raw = fields[0]?.value;
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s.length === 0) return null;

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return isoOrNull(Number(m[1]), Number(m[2]), Number(m[3]));

  // Day-first numeric: DD/MM/YYYY, DD.MM.YYYY, DD-MM-YYYY
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(s);
  if (m) return isoOrNull(Number(m[3]), Number(m[2]), Number(m[1]));

  // "15 JAN 1990" / "1 Jan 1990"
  m = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS[m[2]!.slice(0, 3).toLowerCase()];
    if (!month) return null;
    return isoOrNull(Number(m[3]), month, Number(m[1]));
  }

  return null;
};

const registry: Record<string, Transform> = {
  composeFullName,
  toIso2,
  normalizeDate,
};

export function applyTransform(name: string, fields: TransformField[]): unknown | null {
  const fn = registry[name];
  if (!fn) throw new Error(`unknown transform: ${name}`);
  return fn(fields);
}
