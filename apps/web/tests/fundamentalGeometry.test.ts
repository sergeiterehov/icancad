import type { SketchEntity, SketchFeature } from '@icancad/model';
import { SKETCH_ORIGIN_ID, SKETCH_X_AXIS_ID, SKETCH_Y_AXIS_ID } from '@icancad/sketch';
import { describe, expect, it } from 'vitest';
import { buildConstraintActions, removeSketchEntities } from '../src/sketch/constraintModel';
import { buildSolverPrimitives } from '../src/sketch/mapping';

function sketch(
  entities: SketchEntity[],
  constraints: SketchFeature['constraints'] = [],
): SketchFeature {
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

const point: SketchEntity = { id: 'p', type: 'point', construction: false, x: 10, y: 5 };

const coincidenceWithOrigin: SketchFeature['constraints'][number] = {
  id: 'origin-coincidence',
  type: 'coincident',
  refs: [
    { entityId: SKETCH_ORIGIN_ID, pointIndex: 0 },
    { entityId: 'p', pointIndex: 0 },
  ],
};

describe('fundamental geometry in constraints', () => {
  it('constrains stored geometry to the origin', () => {
    const actions = buildConstraintActions(sketch([point]), [`${SKETCH_ORIGIN_ID}#0`, 'p#0']);

    expect(actions.find((action) => action.type === 'coincident')?.refs).toEqual([
      { entityId: SKETCH_ORIGIN_ID, pointIndex: 0 },
      { entityId: 'p', pointIndex: 0 },
    ]);
    expect(actions.find((action) => action.type === 'distance')?.value).toBeCloseTo(
      Math.hypot(10, 5),
    );
  });

  it('treats an axis as a constraint target but not as geometry of its own', () => {
    expect(buildConstraintActions(sketch([point]), [SKETCH_X_AXIS_ID])).toEqual([]);

    const withPoint = buildConstraintActions(sketch([point]), [SKETCH_X_AXIS_ID, 'p#0']);
    expect(withPoint.find((action) => action.type === 'point-on-line')?.refs).toEqual(
      expect.arrayContaining([{ entityId: 'p', pointIndex: 0 }, { entityId: SKETCH_X_AXIS_ID }]),
    );
  });

  it('keeps a constraint to the origin when other geometry is deleted', () => {
    const feature = sketch([point], [coincidenceWithOrigin]);

    const kept = removeSketchEntities(feature, [SKETCH_ORIGIN_ID]);
    expect(kept.constraints).toEqual([coincidenceWithOrigin]);
    expect(kept.entities).toEqual([point]);

    const withoutPoint = removeSketchEntities(feature, ['p']);
    expect(withoutPoint.constraints).toEqual([]);
  });
});

describe('fundamental geometry in the solver', () => {
  it('passes the fixed origin and axes to the solver', () => {
    const { primitives } = buildSolverPrimitives([point], [coincidenceWithOrigin]);

    expect(primitives.find((primitive) => primitive.id === SKETCH_ORIGIN_ID)).toMatchObject({
      type: 'point',
      x: 0,
      y: 0,
      fixed: true,
    });
    for (const id of [SKETCH_X_AXIS_ID, SKETCH_Y_AXIS_ID]) {
      expect(primitives.find((primitive) => primitive.id === `${id}~p0`)).toMatchObject({
        type: 'point',
        fixed: true,
      });
      expect(primitives.find((primitive) => primitive.id === `${id}~p1`)).toMatchObject({
        type: 'point',
        fixed: true,
      });
      expect(primitives.find((primitive) => primitive.id === id)?.type).toBe('line');
    }
    expect(primitives.find((primitive) => primitive.id === 'origin-coincidence')).toMatchObject({
      type: 'p2p_coincident',
      p1_id: SKETCH_ORIGIN_ID,
      p2_id: 'p',
    });
  });

  it('maps a point on an axis to an alignment with the origin', () => {
    const { primitives } = buildSolverPrimitives(
      [point],
      [
        {
          id: 'on-x-axis',
          type: 'point-on-line',
          refs: [{ entityId: 'p', pointIndex: 0 }, { entityId: SKETCH_X_AXIS_ID }],
        },
        {
          id: 'on-y-axis',
          type: 'point-on-line',
          refs: [{ entityId: 'p', pointIndex: 0 }, { entityId: SKETCH_Y_AXIS_ID }],
        },
      ],
    );
    expect(primitives.find((primitive) => primitive.id === 'on-x-axis')).toMatchObject({
      type: 'horizontal_pp',
      p1_id: 'p',
      p2_id: SKETCH_ORIGIN_ID,
    });
    expect(primitives.find((primitive) => primitive.id === 'on-y-axis')).toMatchObject({
      type: 'vertical_pp',
      p1_id: 'p',
      p2_id: SKETCH_ORIGIN_ID,
    });
  });
});
