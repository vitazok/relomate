export type ExtractionFieldType = 'string' | 'date' | 'number' | 'boolean';

export interface ExtractionFieldSpec {
  type: ExtractionFieldType;
  sensitive: boolean;
  // Confirm-mapping (3B): the case/profile leaf path this field writes to (bare path,
  // e.g. 'passportNumber' / 'fullName' — NOT 'profile.passportNumber'). Absent → field is
  // reviewable but never written.
  target?: string;
  // Optional named transform (registry key) applied before the write. Absent → 1:1 passthrough.
  transform?: string;
  // Discriminator for fan-in transforms (e.g. composeFullName: part='surname' | 'given').
  part?: string;
}

export interface ExtractionSchema {
  spineItemId: string;
  fields: Record<string, ExtractionFieldSpec>;
}

export interface SpineItem {
  id: string;
  label: string;
  section: string;
}

export interface ClassificationResult {
  spineItemId: string | null;
  confidence: number;
}

export interface ExtractedField {
  value: unknown;
  confidence: number;
}

export interface ExtractionResult {
  fields: Record<string, ExtractedField>;
  provider: 'reducto' | 'anthropic_vision';
  modelVersion: string;
  raw?: unknown;
}

export interface DocBytes {
  body: Uint8Array;
  contentType: string;
}

export interface ExtractionProvider {
  classify(input: DocBytes, spine: SpineItem[]): Promise<ClassificationResult>;
  extract(input: DocBytes, schema: ExtractionSchema): Promise<ExtractionResult>;
}
