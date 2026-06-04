import { getExtractionSchema } from '@/lib/extraction/schema';
import { applyTransform } from '@/lib/documents/transforms';

export interface ReviewedField {
  key: string;
  value: unknown;
  edited: boolean;
}

export type FieldSource = 'document' | 'user_corrected';

export interface ConfirmUpdates {
  updates: Record<string, unknown>;
  perPathSource: Record<string, FieldSource>;
  unmapped: string[]; // extraction field keys that were NOT written (no target / failed transform)
}

export function buildConfirmUpdates(
  spineItemId: string | null,
  fields: ReviewedField[],
): ConfirmUpdates {
  const updates: Record<string, unknown> = {};
  const perPathSource: Record<string, FieldSource> = {};
  const unmapped: string[] = [];

  const schema = spineItemId ? getExtractionSchema(spineItemId) : null;
  if (!schema) {
    return { updates, perPathSource, unmapped: fields.map((f) => f.key) };
  }

  // Group reviewed fields by their target leaf path (fields with no target → unmapped).
  const groups = new Map<string, { reviewed: ReviewedField; part?: string; transform?: string }[]>();
  for (const f of fields) {
    const spec = schema.fields[f.key];
    if (!spec || !spec.target) {
      unmapped.push(f.key);
      continue;
    }
    const arr = groups.get(spec.target) ?? [];
    arr.push({ reviewed: f, part: spec.part, transform: spec.transform });
    groups.set(spec.target, arr);
  }

  for (const [target, members] of groups) {
    const transformName = members.find((m) => m.transform)?.transform;
    let value: unknown;
    if (transformName) {
      value = applyTransform(
        transformName,
        members.map((m) => ({ key: m.reviewed.key, value: m.reviewed.value, part: m.part })),
      );
    } else {
      // 1:1 path — exactly one contributing field.
      value = members[0]?.reviewed.value;
    }

    if (value === null || value === undefined || value === '') {
      for (const m of members) unmapped.push(m.reviewed.key);
      continue;
    }

    updates[target] = value;
    perPathSource[target] = members.some((m) => m.reviewed.edited) ? 'user_corrected' : 'document';
  }

  return { updates, perPathSource, unmapped };
}
