import { describe, it, expect } from 'vitest';
import { resolveCitation } from '@/lib/journey/citations';

describe('resolveCitation', () => {
  it('resolves the salary threshold citation from blue-card.yaml', () => {
    const c = resolveCitation('blue-card-threshold');
    expect(c).not.toBeNull();
    expect(c!.legalBasis).toBe('§18g Abs. 1 S. 1 AufenthG');
    expect(c!.sourceUrl).toContain('make-it-in-germany');
    expect(c!.lastVerified).toBe('2026-05-25');
  });

  it('resolves the IT-no-degree citation', () => {
    const c = resolveCitation('it-no-degree');
    expect(c!.legalBasis).toBe('§18g Abs. 2 AufenthG');
  });

  it('resolves the consulate citation from consulates.yaml', () => {
    const c = resolveCitation('consulate');
    expect(c!.sourceUrl).toContain('diplo.de');
    expect(c!.legalBasis).toBeNull();
  });

  it('returns null for a manifest step with no cite (null pointer)', () => {
    expect(resolveCitation(null)).toBeNull();
  });

  it('throws loudly for an unknown cite pointer', () => {
    expect(() => resolveCitation('does-not-exist')).toThrow(/unknown citation/i);
  });
});
