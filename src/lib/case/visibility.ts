export const VISIBILITY_VALUES = ['internal', 'client_visible', 'shared'] as const;

export type Visibility = (typeof VISIBILITY_VALUES)[number];

export function isVisibility(value: string): value is Visibility {
  return VISIBILITY_VALUES.includes(value as Visibility);
}
