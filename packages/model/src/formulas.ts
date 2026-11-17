import { isFormula } from './types';

/** One formula handed to the engine; it does not know the CAD schema. */
export interface ExpressionSource {
  /** Feature id for now, a form or script id later. */
  targetId: string;
  /** Dotted address inside the owner: `params.dx`, `directions.0.count`. */
  path: string;
  source: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !isFormula(value);
}

/**
 * Finds every formula of an object by its marker alone, so a new parameter
 * needs no collector change: putting a `Formula` in a field is enough.
 */
export function collectFormulas(value: unknown, targetId: string, path = ''): ExpressionSource[] {
  if (isFormula(value)) return [{ targetId, path, source: value.formula }];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectFormulas(item, targetId, path ? `${path}.${index}` : String(index)),
    );
  }
  if (isPlainObject(value)) {
    return Object.entries(value).flatMap(([key, item]) =>
      collectFormulas(item, targetId, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

/**
 * Replaces formulas with the numbers they resolved to and keeps every untouched
 * subtree — and the whole object when it holds no formulas — identical, which
 * is what lets the rebuild cache match snapshots.
 */
export function applyResolvedValues<T>(
  value: T,
  values: Readonly<Record<string, number>>,
  path = '',
): T {
  if (isFormula(value)) return (values[path] ?? Number.NaN) as T;
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item, index) => {
      const resolved = applyResolvedValues(item, values, path ? `${path}.${index}` : String(index));
      if (resolved !== item) changed = true;
      return resolved;
    });
    return (changed ? next : value) as T;
  }
  if (isPlainObject(value)) {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const resolved = applyResolvedValues(item, values, path ? `${path}.${key}` : key);
      if (resolved !== item) changed = true;
      next[key] = resolved;
    }
    return (changed ? next : value) as T;
  }
  return value;
}
