import { describe, it, expect } from 'vitest';
import { makeLookupAnabinTool } from '@/lib/ai/tools/lookup_anabin';

describe('lookup_anabin tool', () => {
  it('found:false for an institution not in the seed', async () => {
    const tool = makeLookupAnabinTool();
    const out = (await tool.execute!({ institution: 'XYZ Engineering College' }, {} as never)) as {
      type: string; data: { found: boolean; query?: string };
    };
    expect(out.type).toBe('anabin_result');
    expect(out.data.found).toBe(false);
    expect(out.data.query).toBe('XYZ Engineering College');
  });

  it('found:true status unknown for a seeded-but-unrated institution', async () => {
    const tool = makeLookupAnabinTool();
    const out = (await tool.execute!({ institution: 'Indian Institute of Technology Bombay' }, {} as never)) as {
      data: { found: boolean; status?: string; verifiedByUser?: boolean };
    };
    expect(out.data.found).toBe(true);
    expect(out.data.status).toBe('unknown');
    expect(out.data.verifiedByUser).toBe(false);
  });

  it('found:true with a rated status for a seeded H+ institution', async () => {
    const tool = makeLookupAnabinTool();
    const out = (await tool.execute!(
      { institution: 'Birla Institute of Technology and Science, Pilani' },
      {} as never,
    )) as { data: { found: boolean; status?: string } };
    expect(out.data.found).toBe(true);
    expect(out.data.status).toBe('H+');
  });

  it('carries the single ephemeral cache breakpoint (registered last in the tool set)', () => {
    const tool = makeLookupAnabinTool();
    expect(tool.providerOptions?.anthropic).toEqual({ cacheControl: { type: 'ephemeral' } });
  });
});
