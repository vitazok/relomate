import type { ConfidenceBands } from '@/lib/documents/review-config';

export type ConfidenceLevel = 'high' | 'mid' | 'low';

export function classifyConfidence(score: number, bands: ConfidenceBands): ConfidenceLevel {
  if (score >= bands.high) return 'high';
  if (score >= bands.low) return 'mid';
  return 'low';
}
