import { describe, it, expect } from 'vitest';
import {
  cases,
  profiles,
  caseFacts,
  threads,
  messages,
  activityLog,
  documents,
} from '@/lib/db/schema';

describe('db schema', () => {
  it('exports the core tables', () => {
    expect(cases).toBeDefined();
    expect(profiles).toBeDefined();
    expect(caseFacts).toBeDefined();
    expect(threads).toBeDefined();
    expect(messages).toBeDefined();
    expect(activityLog).toBeDefined();
  });

  it('cases.eligibilityVerdict is a jsonb column', () => {
    const col = cases.eligibilityVerdict;
    expect(col).toBeDefined();
    expect(String(col.dataType)).toContain('json');
  });
});

describe('documents table', () => {
  it('exposes the expected columns', () => {
    const cols = Object.keys(documents);
    for (const c of [
      'id', 'caseId', 'userId', 'spineItemId', 'detectedType', 'status',
      'r2Key', 'fileName', 'contentType', 'byteSize', 'extracted',
      'classification', 'error', 'createdAt', 'updatedAt',
    ]) {
      expect(cols).toContain(c);
    }
  });
});
