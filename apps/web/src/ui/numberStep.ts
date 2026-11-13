/** Both the dot and the comma are accepted as the decimal separator. */
export function parseNumber(text: string): number {
  return Number(text.replace(',', '.'));
}

/**
 * The digits typed after the separator pick the wheel step: `12.34` steps by
 * 0.01, `0.1` by 0.1 and a whole number by 1.
 */
export function wheelStep(text: string): number {
  const fraction = text.replace(',', '.').split('.')[1] ?? '';
  return 10 ** -Math.min(12, fraction.length);
}

function decimalsOf(value: number): number {
  const fraction = String(value).split('.')[1] ?? '';
  return fraction.length;
}

/** One step of the field, rounded so binary noise never reaches the text. */
export function steppedValue(value: number, step: number, direction: number): number {
  const decimals = Math.min(12, Math.max(decimalsOf(value), Math.round(-Math.log10(step))));
  return Number((value + direction * step).toFixed(decimals));
}

/** Text of a stepped value, padded so the step stays visible: `2.0`, not `2`. */
export function formatStep(value: number, step: number): string {
  const decimals = Math.min(12, Math.max(0, Math.round(-Math.log10(step))));
  return value.toFixed(decimals);
}
