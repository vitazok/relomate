import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PROMPT_VERSION = 'v0';

export const systemPrompt: string = readFileSync(
  join(process.cwd(), 'prompts/agent/v0.md'),
  'utf8',
);
