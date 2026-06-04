import type { ExtractionSchema } from '@/lib/extraction/types';
import type { ConfidenceBands } from '@/lib/documents/review-config';
import { classifyConfidence, type ConfidenceLevel } from '@/lib/documents/confidence';

export interface ReviewRow {
  key: string;
  label: string;
  value: string;
  confidence: number;
  level: ConfidenceLevel;
  sensitive: boolean;
  mapped: boolean; // false → reviewable but not written (no target)
}

export interface ExtractedFieldsView {
  [key: string]: { value: unknown; confidence: number };
}

function labelFor(key: string): string {
  // Humanize a camelCase extraction key: 'dateOfExpiry' → 'Date Of Expiry'.
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

export function buildReviewRows(
  fields: ExtractedFieldsView,
  schema: ExtractionSchema | null,
  bands: ConfidenceBands,
): ReviewRow[] {
  return Object.entries(fields).map(([key, f]) => {
    const spec = schema?.fields[key];
    return {
      key,
      label: labelFor(key),
      value: f.value == null ? '' : String(f.value),
      confidence: f.confidence,
      level: classifyConfidence(f.confidence, bands),
      sensitive: spec?.sensitive ?? false,
      mapped: Boolean(spec?.target),
    };
  });
}
