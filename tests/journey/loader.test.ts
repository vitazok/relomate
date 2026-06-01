import { describe, it, expect } from 'vitest';
import { getJourneyManifest, __resetJourneyCacheForTests } from '@/lib/journey/loader';

describe('journey loader', () => {
  it('loads + validates journey.yaml', () => {
    __resetJourneyCacheForTests();
    const m = getJourneyManifest();
    expect(m.schemaVersion).toBe(1);
    expect(m.phases.map((p) => p.id)).toEqual([
      'eligibility',
      'documents',
      'drafts',
      'package',
    ]);
  });

  it('eligibility phase has 8 steps each with at least one path', () => {
    const elig = getJourneyManifest().phases.find((p) => p.id === 'eligibility');
    expect(elig?.steps).toHaveLength(8);
    for (const step of elig!.steps) {
      expect(step.paths.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('marks drafts + package phases locked with coming-soon copy', () => {
    const m = getJourneyManifest();
    const drafts = m.phases.find((p) => p.id === 'drafts');
    const pkg = m.phases.find((p) => p.id === 'package');
    expect(drafts?.locked).toBe(true);
    expect(pkg?.locked).toBe(true);
    expect(drafts?.comingSoon).toBeTruthy();
    expect(pkg?.comingSoon).toBeTruthy();
  });
});
