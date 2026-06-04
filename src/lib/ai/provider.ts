import { createAnthropic } from '@ai-sdk/anthropic';
import { env } from '@/lib/env';

export const anthropic = createAnthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

export const MODEL_ID = 'claude-sonnet-4-6';

// Cheap model for document classification (the extract pass uses MODEL_ID).
export const VISION_MODEL_ID = 'claude-haiku-4-5';
