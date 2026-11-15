import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

/** The declarations of the first rule written for exactly this selector. */
function declarations(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'g');
  const match = rule.exec(css);
  return match ? (match[1] ?? '') : null;
}

/**
 * A row can be read without a pointer resting on it: a finger has no hover, so
 * an action that only appears on hover can never be reached on a tablet.
 */
describe('row actions are always on screen', () => {
  it('shows the eye that hides an object', () => {
    const eye = declarations('.tree-row .tree-eye');
    expect(eye, 'the eye has no rule of its own').not.toBeNull();
    expect(eye).not.toMatch(/opacity:\s*0(?:[;\s]|$)/);
    expect(css).not.toMatch(/\.tree-row:hover \.tree-eye/);
  });

  it('shows the remove action of a selected entity', () => {
    const remove = declarations('.selection-item .icon-btn');
    expect(remove, 'the remove action has no rule of its own').not.toBeNull();
    expect(remove).not.toMatch(/opacity:\s*0(?:[;\s]|$)/);
    expect(css).not.toMatch(/\.selection-item:hover \.icon-btn/);
  });
});
