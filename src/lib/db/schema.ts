import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  numeric,
  primaryKey,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { CaseFacts, EligibilityVerdict } from '@/lib/case/schema';
import type { Profile } from '@/lib/profile/schema';
import type { ExtractedData, Classification } from '@/lib/documents/types';
import type {
  ApprovalDecision,
  ApprovalEscalationStatus,
  ApprovalRequiredRole,
} from '@/lib/approvals/types';
import type { DraftContent } from '@/lib/drafting/types';
import type {
  TaskChangeKind,
  TaskRequiredRole,
  TaskSource,
  TaskStatus,
  TaskSubjectType,
} from '@/lib/tasks/types';
import type {
  FirmKnowledgeEntryMetadata,
  FirmKnowledgeSourceMetadata,
  FirmKnowledgeSourceType,
} from '@/lib/firm-knowledge/types';

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').references(() => organizations.id).notNull(),
  displayName: text('display_name'),
  isAnonymous: boolean('is_anonymous').notNull().default(false),
  // Set when this (anon) user is merged into another during anon→authed promotion. The row is
  // kept as a tombstone (append-only audit rows FK to it), but it is no longer a usable session:
  // getCurrentUserId treats a non-null merged_into as logged-out. Recoverable merge pointer.
  mergedInto: uuid('merged_into'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
});

export const organizationMembers = pgTable(
  'organization_members',
  {
    organizationId: uuid('organization_id').references(() => organizations.id).notNull(),
    userId: uuid('user_id').references(() => users.id).notNull(),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.organizationId, t.userId] }),
  }),
);

export const userIdentities = pgTable(
  'user_identities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id).notNull(),
    provider: text('provider').notNull(),
    providerId: text('provider_id').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
  },
  (t) => ({
    providerProviderIdUnique: unique('user_identities_provider_provider_id_unique').on(
      t.provider,
      t.providerId,
    ),
  }),
);

export const profiles = pgTable('profiles', {
  userId: uuid('user_id').primaryKey().references(() => users.id),
  schemaVersion: integer('schema_version').notNull().default(1),
  data: jsonb('data').$type<Profile>().notNull(),
  summary: text('summary'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const cases = pgTable('cases', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  organizationId: uuid('organization_id').references(() => organizations.id).notNull(),
  primaryApplicantUserId: uuid('primary_applicant_user_id').references(() => users.id).notNull(),
  assignedConsultantId: uuid('assigned_consultant_id').references(() => users.id),
  reviewerId: uuid('reviewer_id').references(() => users.id),
  stage: text('stage').notNull().default('intake'),
  priority: text('priority').notNull().default('normal'),
  targetSubmissionDate: timestamp('target_submission_date', { withTimezone: true }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  status: text('status').notNull(),
  visaType: text('visa_type').notNull(),
  targetCountry: text('target_country').notNull(),
  targetConsulate: text('target_consulate'),
  targetMoveDate: text('target_move_date'),
  eligibilityVerdict: jsonb('eligibility_verdict').$type<EligibilityVerdict | null>(),
  schemaVersion: integer('schema_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const caseFacts = pgTable('case_facts', {
  caseId: uuid('case_id').primaryKey().references(() => cases.id),
  data: jsonb('data').$type<CaseFacts>().notNull(),
  summary: text('summary'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const caseParticipants = pgTable(
  'case_participants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    caseId: uuid('case_id').references(() => cases.id).notNull(),
    organizationId: uuid('organization_id').references(() => organizations.id).notNull(),
    userId: uuid('user_id').references(() => users.id),
    invitedEmail: text('invited_email'),
    role: text('role').notNull(),
    invitationStatus: text('invitation_status').notNull().default('active'),
    visibility: text('visibility').notNull().default('shared'),
    relation: jsonb('relation').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    caseUserRoleUnique: uniqueIndex('case_participants_case_user_role_unique')
      .on(t.caseId, t.userId, t.role)
      .where(sql`${t.userId} IS NOT NULL`),
  }),
);

export const threads = pgTable('threads', {
  id: uuid('id').defaultRandom().primaryKey(),
  caseId: uuid('case_id').references(() => cases.id).notNull(),
  title: text('title'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
});

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  threadId: uuid('thread_id').references(() => threads.id).notNull(),
  userId: uuid('user_id').references(() => users.id),
  role: text('role').notNull(),
  content: text('content').notNull().default(''),
  parts: jsonb('parts'),
  channel: text('channel').notNull().default('web'),
  modelVersion: text('model_version'),
  promptVersion: text('prompt_version'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const toolCalls = pgTable('tool_calls', {
  id: uuid('id').defaultRandom().primaryKey(),
  messageId: uuid('message_id').references(() => messages.id).notNull(),
  toolName: text('tool_name').notNull(),
  input: jsonb('input').notNull(),
  output: jsonb('output'),
  durationMs: integer('duration_ms'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const activityLog = pgTable('activity_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  caseId: uuid('case_id').references(() => cases.id),
  userId: uuid('user_id').references(() => users.id),
  kind: text('kind').notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const profileChanges = pgTable('profile_changes', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  fieldPath: text('field_path').notNull(),
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value'),
  source: text('source').notNull(),
  sourceTurnId: uuid('source_turn_id'),
  confidence: numeric('confidence', { precision: 3, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const caseChanges = pgTable('case_changes', {
  id: uuid('id').defaultRandom().primaryKey(),
  caseId: uuid('case_id').references(() => cases.id).notNull(),
  fieldPath: text('field_path').notNull(),
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value'),
  source: text('source').notNull(),
  sourceTurnId: uuid('source_turn_id'),
  confidence: numeric('confidence', { precision: 3, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const documents = pgTable('documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  caseId: uuid('case_id').references(() => cases.id).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  spineItemId: text('spine_item_id'),
  detectedType: text('detected_type'),
  status: text('status').notNull().default('pending_upload'),
  r2Key: text('r2_key').notNull(),
  fileName: text('file_name').notNull(),
  contentType: text('content_type').notNull(),
  byteSize: integer('byte_size').notNull(),
  extracted: jsonb('extracted').$type<ExtractedData | null>(),
  classification: jsonb('classification').$type<Classification | null>(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const drafts = pgTable('drafts', {
  id: uuid('id').defaultRandom().primaryKey(),
  caseId: uuid('case_id').references(() => cases.id).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  type: text('type').notNull(),
  version: integer('version').notNull().default(1),
  status: text('status').notNull().default('drafting'),
  content: jsonb('content').$type<DraftContent | null>(),
  modelVersion: text('model_version'),
  promptVersion: text('prompt_version'),
  error: text('error'),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    caseId: uuid('case_id').references(() => cases.id).notNull(),
    userId: uuid('user_id').references(() => users.id).notNull(),
    assigneeUserId: uuid('assignee_user_id').references(() => users.id),
    requiredRole: text('required_role').$type<ApprovalRequiredRole>().notNull().default('applicant'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    escalationStatus: text('escalation_status')
      .$type<ApprovalEscalationStatus>()
      .notNull()
      .default('none'),
    visibility: text('visibility').notNull().default('shared'),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    status: text('status').notNull().default('pending'),
    decision: jsonb('decision').$type<ApprovalDecision | null>(),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // At most one OPEN (pending) approval per subject. Resolved rows don't conflict,
    // so a subject can be re-reviewed later (e.g. re-upload after reject).
    pendingPerSubject: uniqueIndex('approvals_pending_subject_unique')
      .on(t.subjectType, t.subjectId)
      .where(sql`${t.status} = 'pending'`),
  }),
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    caseId: uuid('case_id').references(() => cases.id).notNull(),
    organizationId: uuid('organization_id').references(() => organizations.id).notNull(),
    title: text('title').notNull(),
    // `system` tasks are reconciled from case state by the generator; `manual` tasks are firm-authored.
    source: text('source').$type<TaskSource>().notNull().default('manual'),
    // Stable dedupe key for `system` tasks (e.g. `document:<id>:reupload`). NULL for `manual` tasks.
    // The partial unique index below keeps at most one OPEN system task per (case, key).
    generationKey: text('generation_key'),
    status: text('status').$type<TaskStatus>().notNull().default('open'),
    requiredRole: text('required_role').$type<TaskRequiredRole | null>(),
    assigneeUserId: uuid('assignee_user_id').references(() => users.id),
    dueAt: timestamp('due_at', { withTimezone: true }),
    // Blocking tasks gate downstream progress (e.g. the submission package); surfaced first.
    blocking: boolean('blocking').notNull().default(false),
    visibility: text('visibility').notNull().default('internal'),
    subjectType: text('subject_type').$type<TaskSubjectType | null>(),
    subjectId: uuid('subject_id'),
    createdBy: uuid('created_by').references(() => users.id),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // At most one OPEN system task per (case, generationKey). Terminal-status rows release the key,
    // so a re-emerging trigger can spawn a fresh task. Mirrors the approvals pending-subject index.
    openSystemTaskUnique: uniqueIndex('tasks_open_system_generation_unique')
      .on(t.caseId, t.generationKey)
      .where(sql`${t.source} = 'system' AND ${t.status} NOT IN ('done', 'cancelled')`),
  }),
);

export const taskChanges = pgTable('task_changes', {
  id: uuid('id').defaultRandom().primaryKey(),
  taskId: uuid('task_id').references(() => tasks.id).notNull(),
  kind: text('kind').$type<TaskChangeKind>().notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  // PII-safe: structural change metadata only (status transitions, assignee ids), never case data.
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const firmKnowledgeSources = pgTable('firm_knowledge_sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').references(() => organizations.id).notNull(),
  title: text('title').notNull(),
  sourceType: text('source_type').$type<FirmKnowledgeSourceType>().notNull(),
  url: text('url'),
  jurisdiction: text('jurisdiction'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  staleAfter: timestamp('stale_after', { withTimezone: true }),
  verifiedByUser: boolean('verified_by_user').notNull().default(false),
  metadata: jsonb('metadata').$type<FirmKnowledgeSourceMetadata>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const firmKnowledgeEntries = pgTable('firm_knowledge_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').references(() => organizations.id).notNull(),
  sourceId: uuid('source_id').references(() => firmKnowledgeSources.id),
  title: text('title').notNull(),
  category: text('category').notNull(),
  body: text('body').notNull(),
  visibility: text('visibility').notNull().default('internal'),
  jurisdiction: text('jurisdiction'),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  metadata: jsonb('metadata').$type<FirmKnowledgeEntryMetadata>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.identifier, t.token] }) }),
);
