import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { systemPrompt, PROMPT_VERSION } from '@/lib/ai/chat/system-prompt';

describe('system prompt loader', () => {
  it('exposes the v0.md content as a constant string', () => {
    const onDisk = readFileSync(
      join(process.cwd(), 'prompts/agent/v0.md'),
      'utf8',
    );
    expect(systemPrompt).toBe(onDisk);
  });

  it('exposes a version constant for activity logs', () => {
    expect(PROMPT_VERSION).toBe('v0');
  });

  it('no longer caveats eligibility/anabin tools as future build steps', () => {
    expect(systemPrompt).not.toMatch(/later build step/i);
  });

  it('keeps PROMPT_VERSION at v0', () => {
    expect(PROMPT_VERSION).toBe('v0');
  });
});
