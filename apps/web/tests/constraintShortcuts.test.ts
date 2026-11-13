import { describe, expect, it } from 'vitest';
import { SKETCH_TOOL_SHORTCUTS, sketchToolFromShortcut } from '../src/sketch/tool';
import { CONSTRAINT_CATALOG, constraintFromShortcut } from '../src/ui/constraintCatalog';

function key(letter: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: letter,
    code: `Key${letter.toUpperCase()}`,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...modifiers,
  } as KeyboardEvent;
}

describe('sketch shortcuts', () => {
  it('gives every constraint a unique Shift letter', () => {
    const letters = Object.values(CONSTRAINT_CATALOG).map((info) => info.shortcut);
    expect(new Set(letters).size).toBe(letters.length);
    expect(letters.every((letter) => /^[A-Z]$/.test(letter))).toBe(true);
  });

  it('maps Shift letters to constraints', () => {
    expect(constraintFromShortcut(key('f', { shiftKey: true }))).toBe('fix');
    expect(constraintFromShortcut(key('c', { shiftKey: true }))).toBe('coincident');
    expect(constraintFromShortcut(key('l', { shiftKey: true }))).toBe('distance');
    expect(constraintFromShortcut(key('l'))).toBeNull();
  });

  it('maps bare letters to drawing tools', () => {
    expect(sketchToolFromShortcut(key('p'))).toBe('point');
    expect(sketchToolFromShortcut(key('l'))).toBe('line');
    expect(sketchToolFromShortcut(key('c'))).toBe('circle');
    expect(sketchToolFromShortcut(key('a'))).toBe('arc');
    expect(sketchToolFromShortcut(key('e'))).toBe('ellipse');
    expect(sketchToolFromShortcut(key('b'))).toBe('bezier');
    expect(sketchToolFromShortcut(key('p', { shiftKey: true }))).toBeNull();
    expect(sketchToolFromShortcut(key('p', { metaKey: true }))).toBeNull();
  });

  it('reads the physical key so a non-Latin layout still matches', () => {
    expect(sketchToolFromShortcut(key('з'))).toBeNull();
    expect(sketchToolFromShortcut({ ...key('p'), key: 'з' } as KeyboardEvent)).toBe('point');
    expect(constraintFromShortcut({ ...key('f'), key: 'а', shiftKey: true } as KeyboardEvent)).toBe(
      'fix',
    );
  });

  it('keeps the tool shortcuts distinct', () => {
    const letters = Object.values(SKETCH_TOOL_SHORTCUTS);
    expect(new Set(letters).size).toBe(letters.length);
  });
});
