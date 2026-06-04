import { describe, it, expect } from 'vitest';
import { classifyConfidence } from '@/lib/documents/confidence';

const bands = { high: 0.9, low: 0.7 };

describe('classifyConfidence', () => {
  it('classifies by band', () => {
    expect(classifyConfidence(0.95, bands)).toBe('high');
    expect(classifyConfidence(0.9, bands)).toBe('high');
    expect(classifyConfidence(0.8, bands)).toBe('mid');
    expect(classifyConfidence(0.7, bands)).toBe('mid');
    expect(classifyConfidence(0.5, bands)).toBe('low');
  });
});
