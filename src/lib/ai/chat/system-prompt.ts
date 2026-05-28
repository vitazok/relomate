import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PROMPT_VERSION = 'v0-stub';

export const systemPrompt: string = readFileSync(
  join(process.cwd(), 'prompts/agent/v0-stub.md'),
  'utf8',
);
