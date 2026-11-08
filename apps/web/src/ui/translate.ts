import type { TFunction } from 'i18next';

export function translate(t: TFunction, key: string, fallback?: string): string {
  return t(key as never, { defaultValue: fallback ?? key } as never) as unknown as string;
}
