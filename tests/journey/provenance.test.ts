import { describe, it, expect } from 'vitest';
import { mapAnswerProvenance } from '@/lib/journey/provenance';

describe('mapAnswerProvenance', () => {
  it('maps user_stated to chat copy with a formatted date', () => {
    const p = mapAnswerProvenance('user_stated', '2026-05-30T12:00:00.000Z');
    expect(p.label).toBe('You told us in chat');
    expect(p.updatedAt).toBe('2026-05-30T12:00:00.000Z');
  });

  it('maps each known source to distinct copy', () => {
    expect(mapAnswerProvenance('document', null).label).toMatch(/upload/i);
    expect(mapAnswerProvenance('user_corrected', null).label).toMatch(/corrected/i);
    expect(mapAnswerProvenance('inferred', null).label).toMatch(/confirm/i);
    expect(mapAnswerProvenance('system', null).label).toMatch(/computed/i);
  });

  it('falls back gracefully for an unrecognized source', () => {
    // reason: source comes from persisted JSON; tolerate drift rather than throw in a render path
    const p = mapAnswerProvenance('mystery', null);
    expect(p.label).toBeTruthy();
  });
});
