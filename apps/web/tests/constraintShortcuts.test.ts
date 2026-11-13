import type { SketchEntity, SketchFeature } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { buildConstraintActions } from '../src/sketch/constraintModel';
import { SKETCH_TOOL_SHORTCUTS, sketchToolFromShortcut } from '../src/sketch/tool';
import {
  CONSTRAINT_CATALOG,
  constraintsFromShortcut,
  resolveConstraintShortcut,
} from '../src/ui/constraintCatalog';

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

const shift = (letter: string) => key(letter, { shiftKey: true });

const point = (id: string, x = 0, y = 0): SketchEntity => ({
  id,
  type: 'point',
  construction: false,
  x,
  y,
});
const line = (id: string, x = 0, y = 0): SketchEntity => ({
  id,
  type: 'line',
  construction: false,
  x1: x,
  y1: y,
  x2: x + 10,
  y2: y,
});
const circle = (id: string, x = 0): SketchEntity => ({
  id,
  type: 'circle',
  construction: false,
  cx: x,
  cy: 0,
  r: 5,
});
const arc = (id: string, x = 0): SketchEntity => ({
  id,
  type: 'arc',
  construction: false,
  cx: x,
  cy: 0,
  r: 5,
  startAngle: 0,
  endAngle: Math.PI / 2,
});
const ellipse = (id: string, x = 0): SketchEntity => ({
  id,
  type: 'ellipse',
  construction: false,
  cx: x,
  cy: 0,
  rx: 8,
  ry: 4,
  rotation: 0,
});

function sketch(entities: SketchEntity[]): SketchFeature {
  return {
    id: 'sketch',
    name: 'Sketch',
    suppressed: false,
    type: 'sketch',
    plane: { type: 'datum', plane: 'XY', offset: 0 },
    entities,
    constraints: [],
    references: [],
    projections: [],
  };
}

const ENTITIES: SketchEntity[] = [
  point('p1'),
  point('p2', 5),
  point('p3', 10),
  point('p4', 15),
  line('l1'),
  line('l2', 0, 5),
  line('l3', 0, 10),
  circle('c1'),
  circle('c2', 20),
  arc('a1', 40),
  arc('a2', 50),
  ellipse('e1', 60),
  ellipse('e2', 80),
];

const SELECTIONS: Record<string, string[]> = {
  'single point': ['p1'],
  'two points': ['p1', 'p2'],
  'three points': ['p1', 'p2', 'p3'],
  'four points': ['p1', 'p2', 'p3', 'p4'],
  'single line': ['l1'],
  'two lines': ['l1', 'l2'],
  'three lines': ['l1', 'l2', 'l3'],
  'single circle': ['c1'],
  'two circles': ['c1', 'c2'],
  'single arc': ['a1'],
  'two arcs': ['a1', 'a2'],
  'circle and arc': ['c1', 'a1'],
  'single ellipse': ['e1'],
  'two ellipses': ['e1', 'e2'],
  'point and line': ['p1', 'l1'],
  'point and circle': ['p1', 'c1'],
  'point and arc': ['p1', 'a1'],
  'point and ellipse': ['p1', 'e1'],
  'two points and line': ['p1', 'p2', 'l1'],
  'line and circle': ['l1', 'c1'],
  'line and ellipse': ['l1', 'e1'],
  'circle center and point': ['c1#0', 'p1'],
  'point on axis': ['p1', 'sketch:x-axis'],
  'origin and point': ['sketch:origin', 'p1'],
  'line and axis': ['l1', 'sketch:x-axis'],
  'three points with origin': ['sketch:origin', 'p1', 'p2'],
  'line with two points': ['l1', 'p1', 'p2'],
  'point, line and circle': ['p1', 'l1', 'c1'],
};

describe('sketch constraint shortcuts', () => {
  it('gives every constraint a Shift letter from A to Z', () => {
    const letters = Object.values(CONSTRAINT_CATALOG).map((info) => info.shortcut);
    expect(letters.every((letter) => /^[A-Z]$/.test(letter))).toBe(true);
  });

  it('does not offer constraints the model cannot solve', () => {
    expect(Object.keys(CONSTRAINT_CATALOG)).not.toContain('concentric');
    expect(Object.keys(CONSTRAINT_CATALOG)).not.toContain('midpoint');
  });

  it('shares a letter only between constraints that never apply together', () => {
    const feature = sketch(ENTITIES);
    for (const [name, selection] of Object.entries(SELECTIONS)) {
      const hints = buildConstraintActions(feature, selection).map(
        (action) => CONSTRAINT_CATALOG[action.type].shortcut,
      );
      expect(new Set(hints).size, `${name}: ${hints.join(', ')}`).toBe(hints.length);
    }
  });

  it('resolves a shared letter to the constraint the selection allows', () => {
    const feature = sketch(ENTITIES);
    const resolve = (selection: string[], letter: string) =>
      resolveConstraintShortcut(buildConstraintActions(feature, selection), shift(letter))?.type;

    expect(resolve(['p1', 'p2'], 'c')).toBe('coincident');
    expect(resolve(['p1', 'l1'], 'c')).toBe('point-on-line');
    expect(resolve(['p1', 'c1'], 'c')).toBe('point-on-circle');
    expect(resolve(['p1', 'a1'], 'c')).toBe('point-on-circle');
    expect(resolve(['p1', 'e1'], 'c')).toBe('point-on-ellipse');
    expect(resolve(['p1', 'sketch:x-axis'], 'c')).toBe('point-on-line');

    expect(resolve(['l1'], 'd')).toBe('distance');
    expect(resolve(['p1', 'p2'], 'd')).toBe('distance');
    expect(resolve(['c1'], 'd')).toBe('diameter');
    expect(resolve(['a1'], 'd')).toBe('diameter');

    expect(resolve(['p1', 'l1'], 'd')).toBe('distance');
    expect(resolve(['l1', 'l2'], 'd')).toBe('distance');

    expect(resolve(['c1'], 'r')).toBe('radius');
    expect(resolve(['l1', 'l2'], 'p')).toBe('parallel');
  });

  it('returns nothing when the selection has no constraint of that family', () => {
    const feature = sketch(ENTITIES);
    const actions = buildConstraintActions(feature, ['l1', 'l2']);
    expect(resolveConstraintShortcut(actions, shift('c'))).toBeNull();
    expect(resolveConstraintShortcut(actions, shift('r'))).toBeNull();
    expect(resolveConstraintShortcut(actions, key('c'))).toBeNull();
    expect(
      resolveConstraintShortcut(actions, key('c', { metaKey: true, shiftKey: true })),
    ).toBeNull();
  });

  it('maps Shift letters to constraint families', () => {
    expect(constraintsFromShortcut(shift('f'))).toEqual(['fix']);
    expect(constraintsFromShortcut(shift('c'))).toEqual([
      'coincident',
      'point-on-line',
      'point-on-circle',
      'point-on-ellipse',
    ]);
    expect(constraintsFromShortcut(shift('d'))).toEqual(['distance', 'diameter']);
    expect(constraintsFromShortcut(shift('l'))).toEqual([]);
    expect(constraintsFromShortcut(key('d'))).toEqual([]);
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
    expect(constraintsFromShortcut({ ...key('f'), key: 'а', shiftKey: true } as KeyboardEvent)).toEqual(
      ['fix'],
    );
  });

  it('keeps the tool shortcuts distinct', () => {
    const letters = Object.values(SKETCH_TOOL_SHORTCUTS);
    expect(new Set(letters).size).toBe(letters.length);
  });
});
