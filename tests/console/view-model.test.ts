import { describe, it, expect } from 'vitest';
import {
  bucketizeConsoleCases,
  type ConsoleCaseInput,
} from '@/lib/console/view-model';

const NOW = new Date('2026-06-10T12:00:00Z');

function makeCase(overrides: Partial<ConsoleCaseInput>): ConsoleCaseInput {
  return {
    id: 'case-x',
    status: 'active',
    assignedConsultantId: null,
    reviewerId: null,
    targetSubmissionDate: null,
    hasBlockingTask: false,
    earliestTaskDueAt: null,
    primaryApplicantUserId: 'applicant-x',
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    ...overrides,
  };
}

describe('bucketizeConsoleCases', () => {
  it('puts cases assigned to the viewer in assignedToMe', () => {
    const cases = [
      makeCase({ id: 'a', assignedConsultantId: 'me' }),
      makeCase({ id: 'b', assignedConsultantId: 'other' }),
    ];
    const { assignedToMe, unassigned } = bucketizeConsoleCases(cases, {
      viewerUserId: 'me',
      now: NOW,
    });
    expect(assignedToMe.map((c) => c.id)).toEqual(['a']);
    expect(unassigned).toHaveLength(0);
  });

  it('puts open unassigned cases in unassigned, excluding closed/submitted', () => {
    const cases = [
      makeCase({ id: 'open', assignedConsultantId: null, status: 'active' }),
      makeCase({ id: 'closed', assignedConsultantId: null, status: 'closed' }),
      makeCase({ id: 'submitted', assignedConsultantId: null, status: 'submitted' }),
    ];
    const { unassigned } = bucketizeConsoleCases(cases, { now: NOW });
    expect(unassigned.map((c) => c.id)).toEqual(['open']);
  });

  it('surfaces blocking and overdue cases in blockedOrOverdue (attention lens, not partition)', () => {
    const cases = [
      makeCase({ id: 'blocked', assignedConsultantId: 'me', hasBlockingTask: true }),
      makeCase({
        id: 'overdue',
        earliestTaskDueAt: new Date('2026-06-09T00:00:00Z'),
      }),
      makeCase({
        id: 'future',
        earliestTaskDueAt: new Date('2026-06-20T00:00:00Z'),
      }),
    ];
    const { assignedToMe, blockedOrOverdue } = bucketizeConsoleCases(cases, {
      viewerUserId: 'me',
      now: NOW,
    });
    expect(blockedOrOverdue.map((c) => c.id).sort()).toEqual(['blocked', 'overdue']);
    // 'blocked' is assigned to me AND blocked — appears in both lenses.
    expect(assignedToMe.map((c) => c.id)).toContain('blocked');
  });

  it('evaluates overdue against the parameterized now', () => {
    const dueAt = new Date('2026-06-10T11:59:00Z');
    const cases = [makeCase({ id: 'edge', earliestTaskDueAt: dueAt })];
    expect(bucketizeConsoleCases(cases, { now: NOW }).blockedOrOverdue).toHaveLength(1);
    const earlier = new Date('2026-06-10T11:00:00Z');
    expect(bucketizeConsoleCases(cases, { now: earlier }).blockedOrOverdue).toHaveLength(0);
  });

  it('orders each bucket by most-recently-updated first', () => {
    const cases = [
      makeCase({ id: 'old', assignedConsultantId: null, updatedAt: new Date('2026-06-01T00:00:00Z') }),
      makeCase({ id: 'new', assignedConsultantId: null, updatedAt: new Date('2026-06-09T00:00:00Z') }),
    ];
    expect(bucketizeConsoleCases(cases, { now: NOW }).unassigned.map((c) => c.id)).toEqual([
      'new',
      'old',
    ]);
  });

  it('leaves assignedToMe empty when no viewer is given (admin triage view)', () => {
    const cases = [makeCase({ id: 'a', assignedConsultantId: 'someone' })];
    expect(bucketizeConsoleCases(cases, { now: NOW }).assignedToMe).toHaveLength(0);
  });
});
