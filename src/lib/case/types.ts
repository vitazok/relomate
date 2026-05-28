import { z } from 'zod';
import { ProvenanceSourceEnum } from '@/lib/case/schema';

export const UpdateCaseInputSchema = z.object({
  caseId: z.string().uuid(),
  source: ProvenanceSourceEnum,
  sourceTurnId: z.string().uuid().nullable(),
  confidence: z.number().min(0).max(1),
  updates: z.record(z.string(), z.unknown()),
  fieldNotes: z.record(z.string(), z.string()).optional(),
});
export type UpdateCaseInput = z.infer<typeof UpdateCaseInputSchema>;

export const UpdateCaseInputSchemaForLLM = UpdateCaseInputSchema.omit({
  caseId: true,
  sourceTurnId: true,
});
export type UpdateCaseInputForLLM = z.infer<typeof UpdateCaseInputSchemaForLLM>;

export interface ContradictionReport {
  path: string;
  previousValue: unknown;
  previousConfidence: number;
  newValue: unknown;
  newConfidence: number;
}

export interface UpdateCaseResult {
  caseId: string;
  updatedPaths: string[];
  contradictions: ContradictionReport[];
}
