import { createAnthropic } from '@ai-sdk/anthropic';
import { env } from '@/lib/env';

export const anthropic = createAnthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

export const MODEL_ID = 'claude-sonnet-4-6';
