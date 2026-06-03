import { env } from '@/lib/env';
import type {
  ExtractionProvider,
  ExtractionSchema,
  SpineItem,
  DocBytes,
  ClassificationResult,
  ExtractionResult,
} from './types';

const REDUCTO_BASE = 'https://platform.reducto.ai';

function authHeaders(): Record<string, string> {
  if (!env.REDUCTO_API_KEY) throw new Error('REDUCTO_API_KEY is not configured');
  return { Authorization: `Bearer ${env.REDUCTO_API_KEY}`, 'Content-Type': 'application/json' };
}

function toBase64(body: Uint8Array): string {
  return Buffer.from(body).toString('base64');
}

export function makeReductoProvider(): ExtractionProvider {
  return {
    // Reducto is not our classifier; throw so withFallback routes classify() to the vision provider.
    async classify(_input: DocBytes, _spine: SpineItem[]): Promise<ClassificationResult> {
      throw new Error('reducto: classify delegated to fallback');
    },

    async extract(input, schema: ExtractionSchema): Promise<ExtractionResult> {
      // NOTE: Reducto request/response shape is a best-effort guess pending live API verification
      // (see docs/runbooks/r2-reducto-setup.md). Reconcile reducto.ts + this test against the live
      // contract when REDUCTO_API_KEY is provisioned.
      const fieldNames = Object.keys(schema.fields);
      const res = await fetch(`${REDUCTO_BASE}/extract`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          document: { type: 'base64', data: toBase64(input.body), mime_type: input.contentType },
          schema: { fields: fieldNames },
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`reducto extract failed: POST ${REDUCTO_BASE}/extract ${res.status} ${text}`);
      }
      const json = (await res.json()) as {
        result?: Record<string, unknown>;
        confidence?: Record<string, number>;
      };
      const fields: ExtractionResult['fields'] = {};
      for (const name of fieldNames) {
        fields[name] = {
          value: json.result?.[name] ?? null,
          // Missing field ⇒ no confidence (0), matching the vision provider. A field the
          // provider didn't return is "unknown", not "medium confidence".
          confidence: json.confidence?.[name] ?? 0,
        };
      }
      return { fields, provider: 'reducto', modelVersion: 'reducto-extract-v1', raw: json };
    },
  };
}
