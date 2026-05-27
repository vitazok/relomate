import { describe, it, expect } from 'vitest';
import { z } from 'zod';

describe('sanity', () => {
  it('zod parses a string', () => {
    expect(z.string().parse('hi')).toBe('hi');
  });
});
