import type { SketchConstraint, SketchEntity, SketchFeature } from '@icancad/model';
import { sketchEntityIndex } from '@icancad/sketch';
import { describe, expect, it, vi } from 'vitest';
import {
  applyConstraintAction,
  buildConstraintActions,
  constraintHolds,
} from '../src/sketch/constraintModel';

vi.mock('../src/sketch/client', () => import('./planegcsSolve'));

const line = (id: string, x1: number, y1: number, x2: number, y2: number): SketchEntity => ({
  id,
  type: 'line',
  construction: false,
  x1,
  y1,
  x2,
  y2,
});

const con = (
  id: string,
  type: SketchConstraint['type'],
  refs: SketchConstraint['refs'],
): SketchConstraint => ({ id, type, refs });

function sketch(entities: SketchEntity[], constraints: SketchConstraint[] = []): SketchFeature {
  return {
    id: 'sketch',
    type: 'sketch',
    name: 'Sketch',
    suppressed: false,
    plane: { type: 'datum', plane: 'XY', offset: 0 },
    entities,
    constraints,
    references: [],
  };
}

function rectangle() {
  return sketch(
    [
      line('top', 0, 10, 10, 10),
      line('right', 10, 10, 10, 0),
      line('bottom', 10, 0, 0, 0),
      line('left', 0, 0, 0, 10),
    ],
    [
      con('h1', 'horizontal', [{ entityId: 'top' }]),
      con('v1', 'vertical', [{ entityId: 'right' }]),
      con('h2', 'horizontal', [{ entityId: 'bottom' }]),
      con('v2', 'vertical', [{ entityId: 'left' }]),
      con('j1', 'coincident', [
        { entityId: 'top', pointIndex: 1 },
        { entityId: 'right', pointIndex: 0 },
      ]),
      con('j2', 'coincident', [
        { entityId: 'right', pointIndex: 1 },
        { entityId: 'bottom', pointIndex: 0 },
      ]),
      con('j3', 'coincident', [
        { entityId: 'bottom', pointIndex: 1 },
        { entityId: 'left', pointIndex: 0 },
      ]),
      con('j4', 'coincident', [
        { entityId: 'left', pointIndex: 1 },
        { entityId: 'top', pointIndex: 0 },
      ]),
    ],
  );
}

describe('constraint orientation', () => {
  it('does not offer a vertical for a line that is already horizontal', () => {
    const feature = sketch([line('a', 0, 0, 10, 0)], [con('h', 'horizontal', [{ entityId: 'a' }])]);
    const actions = buildConstraintActions(feature, ['a']);
    expect(actions.some((action) => action.type === 'horizontal')).toBe(false);
    expect(actions.some((action) => action.type === 'vertical')).toBe(false);
  });

  it('does not offer both orientations to two points that already have one', () => {
    const feature = sketch(
      [
        { id: 'p1', type: 'point', construction: false, x: 0, y: 0 },
        { id: 'p2', type: 'point', construction: false, x: 0, y: 5 },
      ],
      [
        con('v', 'vertical', [
          { entityId: 'p1', pointIndex: 0 },
          { entityId: 'p2', pointIndex: 0 },
        ]),
      ],
    );
    const actions = buildConstraintActions(feature, ['p1', 'p2']);
    expect(actions.some((action) => action.type === 'vertical')).toBe(false);
    expect(actions.some((action) => action.type === 'horizontal')).toBe(false);
  });

  it('adds a constraint the geometry already satisfies without moving it', async () => {
    const feature = rectangle();
    const entities = sketchEntityIndex(feature.entities);
    const constraint: SketchConstraint = con('vtop', 'vertical', [
      { entityId: 'top', pointIndex: 1 },
      { entityId: 'right', pointIndex: 1 },
    ]);
    expect(constraintHolds(constraint, entities)).toBe(true);

    const applied = await applyConstraintAction(feature, {
      key: 'vertical',
      type: 'vertical',
      refs: [
        { entityId: 'top', pointIndex: 1 },
        { entityId: 'right', pointIndex: 1 },
      ],
    });
    const top = applied.feature.entities.find((entity) => entity.id === 'top');
    expect(top).toMatchObject({ x1: 0, y1: 10, x2: 10, y2: 10 });
    expect(applied.feature.constraints).toHaveLength(9);
  });

  it('refuses to add the opposite orientation of a line', async () => {
    const feature = sketch([line('a', 0, 0, 10, 0)], [con('h', 'horizontal', [{ entityId: 'a' }])]);
    const applied = await applyConstraintAction(feature, {
      key: 'vertical',
      type: 'vertical',
      refs: [{ entityId: 'a' }],
    });
    expect(applied.feature.constraints).toHaveLength(1);
    expect(applied.feature.constraints[0]!.type).toBe('horizontal');
  });
});
