import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** The declarations of the first rule written for exactly this selector. */
function declarations(selector: string): string | null {
  for (const rule of rules()) {
    if (rule.selectors.includes(selector)) return rule.body;
  }
  return null;
}

/** Whether the stylesheet states this selector with the given declaration. */
function statesRule(selector: string, declaration: string): boolean {
  return rules().some(
    (rule) => rule.selectors.includes(selector) && rule.body.includes(declaration),
  );
}

/** Every rule of the sheet as its list of selectors and its declarations. */
function rules(): Array<{ selectors: string[]; body: string }> {
  const found: Array<{ selectors: string[]; body: string }> = [];
  const pattern = /([^{}]+)\{([^}]*)\}/g;
  for (let match = pattern.exec(css); match; match = pattern.exec(css)) {
    const selectors = (match[1] ?? '')
      .split(',')
      .map((selector) => selector.trim())
      .filter(Boolean);
    found.push({ selectors, body: match[2] ?? '' });
  }
  return found;
}

/**
 * A row action is shown by a cursor that rests on the row, and simply present
 * for a finger: a hidden action can never be reached on a tablet, while a tidy
 * list is what a desktop expects. The stylesheet reads the hand from the
 * document, which the pointer watch keeps up to date.
 */
describe('row actions follow the hand in use', () => {
  it('keeps the eye away until the cursor reaches the row', () => {
    expect(declarations('.tree-row .tree-eye')).toMatch(/opacity:\s*0(?:[;\s]|$)/);
    expect(statesRule('.tree-row:hover .tree-eye', 'opacity: 1')).toBe(true);
  });

  it('shows the eye on a touch screen without any hover', () => {
    expect(statesRule("html[data-pointer='finger'] .tree-row .tree-eye", 'opacity: 1')).toBe(true);
  });

  it('keeps the remove action away until the cursor reaches its row', () => {
    expect(declarations('.selection-item .icon-btn')).toMatch(/opacity:\s*0(?:[;\s]|$)/);
    expect(statesRule('.selection-item:hover .icon-btn', 'opacity: 1')).toBe(true);
  });

  it('shows the remove action on a touch screen without any hover', () => {
    expect(statesRule("html[data-pointer='finger'] .selection-item .icon-btn", 'opacity: 1')).toBe(
      true,
    );
  });
});
