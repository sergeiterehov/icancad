import type { Feature } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { chipOpensSketch, chipSelects } from '../src/ui/operationStrip';

const sketch = (id: string): Feature => ({
  id,
  name: id,
  suppressed: false,
  type: 'sketch',
  plane: { type: 'datum', plane: 'XY', offset: 0 },
  entities: [],
  constraints: [],
  references: [],
});

const primitive: Feature = {
  id: 'box',
  name: 'Box',
  suppressed: false,
  type: 'primitive',
  kind: 'box',
  params: { dx: 10, dy: 10, dz: 10 },
  transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
};

describe('a press on an operation chip', () => {
  it('selects its operation while no sketch is being edited', () => {
    expect(chipSelects(null)).toBe(true);
  });

  it('selects nothing while the sketch editor owns the workspace', () => {
    // Otherwise the panel and the view would show an operation the mode has
    // already put aside.
    expect(chipSelects('sketch-a')).toBe(false);
  });
});

describe('a second press on an operation chip', () => {
  it('opens the sketch it belongs to', () => {
    expect(chipOpensSketch(sketch('sketch-b'), null, true)).toBe(true);
    expect(chipOpensSketch(sketch('sketch-b'), 'sketch-a', true)).toBe(true);
  });

  it('leaves the editor where it is when the sketch is the one being edited', () => {
    expect(chipOpensSketch(sketch('sketch-a'), 'sketch-a', true)).toBe(false);
  });

  it('refuses a sketch that cannot be edited', () => {
    expect(chipOpensSketch(sketch('sketch-b'), 'sketch-a', false)).toBe(false);
  });

  it('never opens a primitive', () => {
    expect(chipOpensSketch(primitive, null, true)).toBe(false);
    expect(chipOpensSketch(primitive, 'sketch-a', true)).toBe(false);
  });
});
