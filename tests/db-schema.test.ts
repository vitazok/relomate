import { describe, it, expect } from 'vitest';
import {
  cases,
  profiles,
  caseFacts,
  threads,
  messages,
  activityLog,
  documents,
  organizationMembers,
  caseParticipants,
  firmKnowledgeSources,
  firmKnowledgeEntries,
} from '@/lib/db/schema';

describe('db schema', () => {
  it('exports the core tables', () => {
    expect(cases).toBeDefined();
    expect(profiles).toBeDefined();
    expect(caseFacts).toBeDefined();
    expect(threads).toBeDefined();
    expect(messages).toBeDefined();
    expect(activityLog).toBeDefined();
    expect(organizationMembers).toBeDefined();
    expect(caseParticipants).toBeDefined();
    expect(firmKnowledgeSources).toBeDefined();
    expect(firmKnowledgeEntries).toBeDefined();
  });

  it('cases.eligibilityVerdict is a jsonb column', () => {
    const col = cases.eligibilityVerdict;
    expect(col).toBeDefined();
    expect(String(col.dataType)).toContain('json');
  });
});

describe('firm knowledge schema', () => {
  it('sources expose source metadata and staleness columns', () => {
    const cols = Object.keys(firmKnowledgeSources);
    for (const c of [
      'id',
      'organizationId',
      'title',
      'sourceType',
      'url',
      'jurisdiction',
      'lastCheckedAt',
      'lastVerifiedAt',
      'staleAfter',
      'verifiedByUser',
      'metadata',
      'createdAt',
      'updatedAt',
    ]) {
      expect(cols).toContain(c);
    }
  });

  it('entries expose source linkage and internal visibility columns', () => {
    const cols = Object.keys(firmKnowledgeEntries);
    for (const c of [
      'id',
      'organizationId',
      'sourceId',
      'title',
      'category',
      'body',
      'visibility',
      'jurisdiction',
      'tags',
      'metadata',
      'createdAt',
      'updatedAt',
    ]) {
      expect(cols).toContain(c);
    }
  });
});

describe('firm ownership schema', () => {
  it('cases expose organization ownership and assignment columns', () => {
    const cols = Object.keys(cases);
    for (const c of [
      'organizationId',
      'primaryApplicantUserId',
      'assignedConsultantId',
      'reviewerId',
      'stage',
      'priority',
      'targetSubmissionDate',
      'submittedAt',
      'closedAt',
    ]) {
      expect(cols).toContain(c);
    }
  });

  it('organization_members exposes role and status columns', () => {
    const cols = Object.keys(organizationMembers);
    for (const c of ['organizationId', 'userId', 'role', 'status', 'createdAt', 'updatedAt']) {
      expect(cols).toContain(c);
    }
  });

  it('case_participants exposes role, invitation, visibility, and relation columns', () => {
    const cols = Object.keys(caseParticipants);
    for (const c of [
      'id',
      'caseId',
      'organizationId',
      'userId',
      'invitedEmail',
      'role',
      'invitationStatus',
      'visibility',
      'relation',
      'createdAt',
      'updatedAt',
    ]) {
      expect(cols).toContain(c);
    }
  });
});

describe('documents table', () => {
  it('exposes the expected columns', () => {
    const cols = Object.keys(documents);
    for (const c of [
      'id', 'caseId', 'userId', 'spineItemId', 'detectedType', 'status',
      'r2Key', 'fileName', 'contentType', 'byteSize', 'extracted',
      'classification', 'error', 'createdAt', 'updatedAt',
    ]) {
      expect(cols).toContain(c);
    }
  });
});
