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
