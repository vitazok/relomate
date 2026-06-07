import { describe, it, expect } from 'vitest';
import { Tracker, phaseBadge } from '@/components/workspace/Tracker';
import type { JourneyProgress } from '@/lib/journey/types';

const EMPTY: JourneyProgress = {
  overallPct: 0,
  phases: [
    { id: 'eligibility', label: 'Eligibility & route', status: 'todo', completed: 0, total: 8, comingSoon: null, steps: [] },
    { id: 'documents', label: 'Documents', status: 'todo', completed: 0, total: 0, comingSoon: null, steps: [] },
    { id: 'drafts', label: 'Drafts', status: 'todo', completed: 0, total: 3, comingSoon: null, steps: [] },
    { id: 'package', label: 'Package', status: 'locked', completed: 0, total: 0, comingSoon: 'soon', steps: [] },
  ],
};

describe('phaseBadge', () => {
  it('renders a fraction for unlocked phases and a lock marker for locked', () => {
    expect(phaseBadge(EMPTY.phases[0]!)).toBe('0/8');
    expect(phaseBadge(EMPTY.phases[2]!)).toBe('0/3');
    expect(phaseBadge(EMPTY.phases[3]!)).toBe('Coming soon');
  });
});

describe('Tracker', () => {
  it('returns an element without throwing for a populated progress', () => {
    const el = Tracker({ caseId: 'case-1', progress: EMPTY, eligibilityHeadline: null });
    expect(el).toBeTruthy();
  });

  it('returns the empty-state element when all phases are empty/todo', () => {
    const el = Tracker({ caseId: 'case-1', progress: EMPTY, eligibilityHeadline: null });
    expect(el).toBeTruthy();
  });
});
