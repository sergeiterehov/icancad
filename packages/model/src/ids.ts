let counter = 0;

function randomToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  const time = Date.now().toString(36);
  const sequence = (counter++).toString(36).padStart(4, '0');
  return `${time}${sequence}`;
}

export function createId(prefix: string): string {
  return `${prefix}_${randomToken().slice(0, 20)}`;
}

function fnv1a(value: string, seed: number): number {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * An id that depends only on the values that define the object. Repeating an
 * operation on the same inputs produces the same id, which keeps selections,
 * metadata and downstream references stable (ADR 0007). Two independent
 * hashes keep the chance of a collision in one sketch negligible.
 */
export function createStableId(prefix: string, ...values: string[]): string {
  const key = values.join('\u0001');
  const first = fnv1a(key, 2166136261);
  const second = fnv1a(key, 0x9e3779b9);
  return `${prefix}_${first.toString(36)}${second.toString(36)}`;
}
