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
import type { ApprovalDecision } from '@/lib/approvals/types';

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

export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    caseId: uuid('case_id').references(() => cases.id).notNull(),
    userId: uuid('user_id').references(() => users.id).notNull(),
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

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.identifier, t.token] }) }),
);
