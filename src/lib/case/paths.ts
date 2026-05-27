import { z } from 'zod';
import { CaseFactsSchema } from '@/lib/case/schema';
import { ProfileSchema } from '@/lib/profile/schema';

export type PathKind = 'case' | 'profile';

export interface ResolvedPath {
  kind: PathKind;
  inner: z.ZodTypeAny;
}

/**
 * Walks the discriminated case+profile tree to confirm `path` resolves to a leaf
 * (a `FieldSchema(inner)` wrapper) and returns the inner schema.
 *
 * Throws if:
 *  - the top segment is not a known root on either schema
 *  - a nested segment is not a known sub-shape
 *  - the path resolves to an intermediate object, not a Field-wrapped leaf
 */
export function validateLeafPath(path: string): ResolvedPath {
  const segments = path.split('.');
  if (segments.length === 0 || segments.some((s) => s.length === 0)) {
    throw new Error(`invalid path: ${path}`);
  }

  // Try profile first (single-segment root paths win there).
  const profileTry = walk(unwrap(ProfileSchema), segments);
  if (profileTry.kind === 'leaf') return { kind: 'profile', inner: profileTry.inner };

  const caseTry = walk(unwrap(CaseFactsSchema), segments);
  if (caseTry.kind === 'leaf') return { kind: 'case', inner: caseTry.inner };

  if (profileTry.kind === 'intermediate' || caseTry.kind === 'intermediate') {
    throw new Error(`path is not a leaf: ${path}`);
  }
  throw new Error(`unknown path: ${path}`);
}

type WalkResult =
  | { kind: 'leaf'; inner: z.ZodTypeAny }
  | { kind: 'intermediate' }
  | { kind: 'unknown' };

function walk(node: z.ZodTypeAny, segments: string[]): WalkResult {
  let current: z.ZodTypeAny = node;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i] as string;
    const obj = unwrap(current);
    if (!(obj instanceof z.ZodObject)) return { kind: 'unknown' };
    const shape = obj.shape as Record<string, z.ZodTypeAny>;
    const next = shape[segment];
    if (!next) return { kind: 'unknown' };
    current = next;
  }
  // After consuming all segments, `current` should be a FieldSchema:
  // a ZodObject with .shape.value present. Anything else is an intermediate.
  const u = unwrap(current);
  if (u instanceof z.ZodObject) {
    const shape = u.shape as Record<string, z.ZodTypeAny>;
    const valueSchema = shape['value'];
    if (valueSchema) {
      return { kind: 'leaf', inner: unwrapNullable(valueSchema) };
    }
    return { kind: 'intermediate' };
  }
  return { kind: 'unknown' };
}

/** Strip `.optional()` / `.default()` / `.nullable()` wrappers off a Zod node. */
function unwrap(node: z.ZodTypeAny): z.ZodTypeAny {
  let n: z.ZodTypeAny = node;
  // ZodOptional / ZodDefault / ZodNullable all expose `_def.innerType`.
  // Loop a few times to cover Optional<Default<Nullable<...>>>.
  for (let i = 0; i < 5; i++) {
    const def = (n as unknown as { _def?: { innerType?: z.ZodTypeAny } })._def;
    if (def?.innerType && def.innerType !== n) {
      n = def.innerType;
      continue;
    }
    break;
  }
  return n;
}

/** For a leaf value schema like `inner.nullable()`, return the underlying inner. */
function unwrapNullable(node: z.ZodTypeAny): z.ZodTypeAny {
  return unwrap(node);
}

/** Validate that a runtime value matches the leaf's inner schema. */
export function validateLeafValue(inner: z.ZodTypeAny, value: unknown): void {
  if (value === null) return;
  const result = inner.safeParse(value);
  if (!result.success) {
    throw new Error(
      `invalid leaf value: ${result.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
}

/** Immutably set `path` to `value` on `obj`, synthesising intermediate objects. */
export function setAtPath<T extends Record<string, unknown>>(
  obj: T,
  path: string,
  value: unknown,
): T {
  const segments = path.split('.');
  const out: Record<string, unknown> = { ...obj };
  let cursor: Record<string, unknown> = out;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i] as string;
    const existing = cursor[segment];
    const nextCursor: Record<string, unknown> =
      existing && typeof existing === 'object' && existing !== null
        ? { ...(existing as Record<string, unknown>) }
        : {};
    cursor[segment] = nextCursor;
    cursor = nextCursor;
  }
  cursor[segments[segments.length - 1] as string] = value;
  return out as T;
}

/** Get the value at `path` or undefined if any segment is missing. */
export function getAtPath(obj: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.');
  let cursor: unknown = obj;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/** Flatten the tool-input shape to per-row records for the change log. */
export interface FlatChange {
  path: string;
  newValue: unknown;
  resolved: ResolvedPath;
}

export function flattenForChangeLog(updates: Record<string, unknown>): FlatChange[] {
  return Object.entries(updates).map(([path, newValue]) => ({
    path,
    newValue,
    resolved: validateLeafPath(path),
  }));
}
