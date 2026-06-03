import { generateObject } from 'ai';
import { z } from 'zod';
import { anthropic, MODEL_ID, VISION_MODEL_ID } from '@/lib/ai/provider';
import type {
  ExtractionProvider,
  ExtractionSchema,
  SpineItem,
  DocBytes,
  ClassificationResult,
  ExtractionResult,
} from './types';

function toImagePart(doc: DocBytes) {
  // AI SDK v6 ImagePart: the IANA media-type key is `mediaType` (NOT `mimeType` — that key
  // is silently ignored by the loosely-typed content array, leaving the type undetected).
  return { type: 'image' as const, image: doc.body, mediaType: doc.contentType };
}

function fieldsZod(schema: ExtractionSchema) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const key of Object.keys(schema.fields)) {
    shape[key] = z.object({
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      confidence: z.number().min(0).max(1),
    });
  }
  return z.object({ fields: z.object(shape) });
}

export function makeAnthropicVisionProvider(): ExtractionProvider {
  return {
    async classify(input, spine: SpineItem[]): Promise<ClassificationResult> {
      const options = spine.map((s) => `${s.id}: ${s.label}`).join('\n');
      const { object } = await generateObject({
        model: anthropic(VISION_MODEL_ID),
        schema: z.object({
          spineItemId: z.string().nullable(),
          confidence: z.number().min(0).max(1),
        }),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  'Classify this document against the catalog below. Reply with the matching ' +
                  `id or null if none fits.\n${options}`,
              },
              toImagePart(input),
            ],
          },
        ],
      });
      return { spineItemId: object.spineItemId, confidence: object.confidence };
    },

    async extract(input, schema): Promise<ExtractionResult> {
      const { object } = await generateObject({
        model: anthropic(MODEL_ID),
        schema: fieldsZod(schema),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  'Extract the following fields from this document. For each, give the value and ' +
                  'a 0..1 confidence. Use null when a field is not present.\n' +
                  Object.keys(schema.fields).join(', '),
              },
              toImagePart(input),
            ],
          },
        ],
      });
      const obj = object as { fields: Record<string, { value: unknown; confidence: number }> };
      // Iterate the REQUESTED fields, not the model's returned keys: a skipped field becomes
      // {value:null, confidence:0} (surfaced for manual entry in review) rather than absent,
      // and any hallucinated extra key the model returns is dropped.
      const fields: ExtractionResult['fields'] = {};
      for (const key of Object.keys(schema.fields)) {
        const extracted = obj.fields?.[key];
        fields[key] = extracted
          ? { value: extracted.value, confidence: extracted.confidence }
          : { value: null, confidence: 0 };
      }
      return { fields, provider: 'anthropic_vision', modelVersion: MODEL_ID };
    },
  };
}
