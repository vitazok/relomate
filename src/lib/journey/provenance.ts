import type { AnswerProvenance } from './types';

const COPY: Record<string, string> = {
  user_stated: 'You told us in chat',
  document: 'Read from your document upload',
  user_corrected: 'You corrected this',
  inferred: 'Inferred — please confirm',
  system: 'System-computed',
};

/**
 * Turns a rule-9 fact leaf's source + updatedAt into human-facing provenance copy.
 * Tolerates an unrecognized source (persisted JSON may drift) rather than throwing
 * in a render path.
 */
export function mapAnswerProvenance(
  source: string,
  updatedAt: string | null,
): AnswerProvenance {
  return {
    label: COPY[source] ?? 'On file',
    updatedAt,
  };
}
