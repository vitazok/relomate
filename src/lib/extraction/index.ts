import { env } from '@/lib/env';
import { makeAnthropicVisionProvider } from './anthropic-vision';
import { makeReductoProvider } from './reducto';
import type {
  ExtractionProvider,
  ClassificationResult,
  ExtractionResult,
  ExtractionSchema,
  SpineItem,
  DocBytes,
} from './types';

export type { ExtractionProvider } from './types';

export function withFallback(
  primary: ExtractionProvider,
  fallback: ExtractionProvider,
): ExtractionProvider {
  return {
    async classify(input, spine) {
      try {
        return await primary.classify(input, spine);
      } catch {
        return fallback.classify(input, spine);
      }
    },
    async extract(input, schema) {
      try {
        return await primary.extract(input, schema);
      } catch {
        return fallback.extract(input, schema);
      }
    },
  };
}

export function makeExtractionProvider(): ExtractionProvider {
  // Both factories are side-effect-free at import and construct their SDK/HTTP clients
  // lazily on first call, so a top-level import costs nothing until used.
  const vision = makeAnthropicVisionProvider();
  if (env.REDUCTO_API_KEY) {
    return withFallback(makeReductoProvider(), vision);
  }
  return vision;
}

export interface FakeProviderConfig {
  classifyResult?: ClassificationResult;
  extractResult?: ExtractionResult;
  throwOnClassify?: boolean;
  throwOnExtract?: boolean;
}

export function makeFakeExtractionProvider(cfg: FakeProviderConfig = {}): ExtractionProvider {
  return {
    async classify(_input: DocBytes, _spine: SpineItem[]) {
      if (cfg.throwOnClassify) throw new Error('fake classify error');
      return cfg.classifyResult ?? { spineItemId: 'passport', confidence: 0.5 };
    },
    async extract(_input: DocBytes, _schema: ExtractionSchema) {
      if (cfg.throwOnExtract) throw new Error('fake extract error');
      return (
        cfg.extractResult ?? {
          fields: {},
          provider: 'anthropic_vision',
          modelVersion: 'fake',
        }
      );
    },
  };
}
