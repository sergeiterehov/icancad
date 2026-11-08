import { describe, expect, it } from 'vitest';
import en from '../src/i18n/locales/en.json';
import ru from '../src/i18n/locales/ru.json';

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => flattenKeys(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}

describe('i18n resources', () => {
  it('keeps English and Russian key sets in sync', () => {
    expect(flattenKeys(ru)).toEqual(flattenKeys(en));
  });

  it('has no empty strings', () => {
    const emptyKeys = flattenKeys(en).filter((key) => {
      const read = (source: unknown) =>
        key.split('.').reduce<unknown>((current, part) => {
          if (typeof current !== 'object' || current === null) return undefined;
          return (current as Record<string, unknown>)[part];
        }, source);
      return read(en) === '' || read(ru) === '';
    });
    expect(emptyKeys).toEqual([]);
  });
});
