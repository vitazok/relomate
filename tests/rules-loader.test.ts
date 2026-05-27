import { describe, expect, it } from 'vitest';
import {
  getApostilleRules,
  getBlueCardRules,
  getConsulate,
  getFamilyRules,
  getShortageMappings,
  loadRules,
} from '@/lib/rules/loader';

describe('rules loader', () => {
  it('loads and validates all 5 YAMLs + anabin seed', () => {
    const rules = loadRules();
    expect(rules.blueCard.schemaVersion).toBe(1);
    expect(rules.family.schemaVersion).toBe(1);
    expect(rules.consulates.schemaVersion).toBe(1);
    expect(rules.apostille.schemaVersion).toBe(1);
    expect(rules.shortage.schemaVersion).toBe(1);
    expect(rules.anabin.schemaVersion).toBe(1);
  });

  it('exposes the 2026 Blue Card thresholds', () => {
    const blueCard = getBlueCardRules();
    // reason: schema guarantees .min(1) on thresholds array
    expect(blueCard.thresholds[0]!.standard.annualGrossEur).toBe(50700);
    expect(blueCard.thresholds[0]!.reduced.annualGrossEur).toBe(45934.2);
  });

  it('exposes the Bengaluru consulate passport rule', () => {
    const bengaluru = getConsulate('bengaluru');
    expect(bengaluru.passportRequirements.minRemainingValidityMonths).toBe(12);
  });

  it('exposes family reunification spouse legal basis array', () => {
    const family = getFamilyRules();
    expect(family.blueCardSpouse.legalBasis).toContain(
      '§30 Abs. 1 S. 3 Nr. 5 AufenthG',
    );
    expect(family.blueCardSpouse.legalBasis).toContain('§27 Abs. 5 AufenthG');
  });

  it('exposes apostille India totals', () => {
    const apostille = getApostilleRules();
    expect(apostille.india.totalEducationalDurationWeeks).toEqual([2, 4]);
  });

  it('seeds at least 8 shortage-occupation mappings', () => {
    const mappings = getShortageMappings();
    expect(mappings.length).toBeGreaterThanOrEqual(8);
  });
});
