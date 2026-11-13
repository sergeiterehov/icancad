import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

/** The `z-index` declared for a selector, if it declares one. */
function zIndex(selector: string): number | null {
  const rule = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g');
  let match: RegExpExecArray | null;
  while ((match = rule.exec(css)) !== null) {
    const value = /z-index:\s*(-?\d+)/.exec(match[1] ?? '');
    if (value) return Number(value[1]);
  }
  return null;
}

describe('tooltip stacking', () => {
  const overlays = ['.context-menu', '.kernel-popover', '.dialog-backdrop', '.toast'];
  const tooltip = zIndex('.tooltip');

  it('declares a z-index for the tooltip and its overlays', () => {
    expect(tooltip).not.toBeNull();
    for (const selector of overlays) {
      const value = zIndex(selector);
      if (value !== null) expect(value).toBeGreaterThan(0);
    }
  });

  it('paints the tooltip above every overlay it can open inside', () => {
    for (const selector of overlays) {
      const value = zIndex(selector);
      if (value !== null) {
        expect(tooltip!, `${selector} z-index ${value}`).toBeGreaterThan(value);
      }
    }
  });
});
