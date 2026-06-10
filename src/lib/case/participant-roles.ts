export const CASE_PARTICIPANT_ROLES = [
  'applicant',
  'spouse',
  'child',
  'employer_contact',
  'consultant',
  'reviewer',
  'ops_manager',
] as const;

export type CaseParticipantRole = (typeof CASE_PARTICIPANT_ROLES)[number];
