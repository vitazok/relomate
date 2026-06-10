import { z } from 'zod';

export const ApprovalStatusEnum = z.enum(['pending', 'approved', 'rejected']);
export type ApprovalStatus = z.infer<typeof ApprovalStatusEnum>;

export const SubjectTypeEnum = z.enum(['document', 'draft']);
export type SubjectType = z.infer<typeof SubjectTypeEnum>;

export const ApprovalRequiredRoleEnum = z.enum([
  'applicant',
  'employer_contact',
  'consultant',
  'reviewer',
]);
export type ApprovalRequiredRole = z.infer<typeof ApprovalRequiredRoleEnum>;

export const ApprovalEscalationStatusEnum = z.enum(['none', 'due_soon', 'overdue', 'escalated']);
export type ApprovalEscalationStatus = z.infer<typeof ApprovalEscalationStatusEnum>;

// PII-safe: KEYS only (leaf paths), never values.
export const ApprovalDecisionSchema = z.object({
  confirmedPaths: z.array(z.string()),
  editedPaths: z.array(z.string()),
  rejectedReason: z.string().nullable(),
});
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
