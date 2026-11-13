import { createRequire } from 'node:module';
import type { SketchConstraint, SketchEntity, SketchFeature } from '@icancad/model';
import { SKETCH_X_AXIS_ID, sketchEntityIndex } from '@icancad/sketch';
import { Algorithm, GcsWrapper, init_planegcs_module, type ModuleStatic } from '@salusoft89/planegcs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildConstraintActions,
  constraintIdsForEntities,
  constraintsForAction,
  constraintsGeometryIds,
  type ConstraintAction,
} from '../src/sketch/constraintModel';
import { applySolverSolution, buildSolverPrimitives } from '../src/sketch/mapping';
import { referenceMenuItems } from '../src/sketch/referenceMenu';

let gcs: GcsWrapper;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const wasm = require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm');
  const mod = (await init_planegcs_module({ locateFile: () => wasm })) as ModuleStatic;
  gcs = new GcsWrapper(new mod.GcsSystem(), mod);
  gcs.set_max_iterations(200);
});

function sketch(entities: SketchEntity[]): SketchFeature {
  return {
    id: 'sketch',
    type: 'sketch',
    name: 'Sketch',
    suppressed: false,
    plane: { type: 'datum', plane: 'XY', offset: 0 },
    entities,
    constraints: [],
    references: [],
  };
}

function line(id: string, y: number): SketchEntity {
  return { id, type: 'line', construction: false, x1: 0, y1: y, x2: 10, y2: y + 1 };
}

function circle(id: string, r: number): SketchEntity {
  return { id, type: 'circle', construction: false, cx: r, cy: 0, r };
}

function point(id: string, x: number, y: number): SketchEntity {
  return { id, type: 'point', construction: false, x, y };
}

function action(feature: SketchFeature, keys: string[], type: ConstraintAction['type']) {
  return buildConstraintActions(feature, keys).find((candidate) => candidate.type === type);
}

function expand(feature: SketchFeature, value: ConstraintAction): string[][] {
  return constraintsForAction(value, sketchEntityIndex(feature.entities)).map((constraint) =>
    constraint.refs.map((ref) => ref.entityId),
  );
}

describe('group constraint actions', () => {
  it('applies equality to every selected line, first against each following one', () => {
    const feature = sketch([line('a', 0), line('b', 10), line('c', 20)]);
    const equal = action(feature, ['a', 'b', 'c'], 'equal');

    expect(equal?.refs.map((ref) => ref.entityId)).toEqual(['a', 'b', 'c']);
    expect(expand(feature, equal!)).toEqual([
      ['a', 'b'],
      ['a', 'c'],
    ]);
  });

  it('applies equality and tangency to every selected circle', () => {
    const feature = sketch([circle('c1', 5), circle('c2', 8), circle('c3', 12)]);
    const equal = action(feature, ['c1', 'c2', 'c3'], 'equal');
    const tangent = action(feature, ['c1', 'c2', 'c3'], 'tangent');

    expect(expand(feature, equal!)).toEqual([
      ['c1', 'c2'],
      ['c1', 'c3'],
    ]);
    expect(expand(feature, tangent!)).toEqual([
      ['c1', 'c2'],
      ['c1', 'c3'],
    ]);
  });

  it('expands parallel and perpendicular against the first line', () => {
    const feature = sketch([line('a', 0), line('b', 10), line('c', 20)]);

    expect(expand(feature, action(feature, ['a', 'b', 'c'], 'parallel')!)).toEqual([
      ['a', 'b'],
      ['a', 'c'],
    ]);
    expect(expand(feature, action(feature, ['a', 'b', 'c'], 'perpendicular')!)).toEqual([
      ['a', 'b'],
      ['a', 'c'],
    ]);
  });

  it('constrains every selected line separately with horizontal and vertical', () => {
    const feature = sketch([line('a', 0), line('b', 10)]);

    expect(expand(feature, action(feature, ['a', 'b'], 'horizontal')!)).toEqual([['a'], ['b']]);
    expect(expand(feature, action(feature, ['a', 'b'], 'vertical')!)).toEqual([['a'], ['b']]);
  });

  it('aligns every selected point to the first one', () => {
    const feature = sketch([point('p1', 0, 0), point('p2', 5, 2), point('p3', 9, 4)]);
    const keys = ['p1#0', 'p2#0', 'p3#0'];

    expect(expand(feature, action(feature, keys, 'coincident')!)).toEqual([
      ['p1', 'p2'],
      ['p1', 'p3'],
    ]);
    expect(expand(feature, action(feature, keys, 'horizontal')!)).toEqual([
      ['p1', 'p2'],
      ['p1', 'p3'],
    ]);
    expect(action(feature, keys, 'distance')).toBeUndefined();
    expect(action(feature, keys, 'horizontal-distance')).toBeUndefined();
  });

  it('puts every selected point on the selected line', () => {
    const feature = sketch([point('p1', 0, 0), point('p2', 5, 2), line('l', 3)]);
    const onLine = action(feature, ['p1#0', 'p2#0', 'l'], 'point-on-line');

    expect(onLine).toBeDefined();
    expect(expand(feature, onLine!)).toEqual([
      ['p1', 'l'],
      ['p2', 'l'],
    ]);
  });

  it('hides constraints the whole selection cannot satisfy', () => {
    const feature = sketch([line('a', 0), line('b', 10), circle('c', 6)]);
    const types = buildConstraintActions(feature, ['a', 'b', 'c']).map(
      (candidate) => candidate.type,
    );

    expect(types).toContain('fix');
    expect(types).not.toContain('equal');
    expect(types).not.toContain('parallel');
    expect(types).not.toContain('perpendicular');
    expect(types).not.toContain('horizontal');
    expect(types).not.toContain('vertical');
    expect(types).not.toContain('point-on-line');
  });

  it('hides point-on-line when more than one line is selected', () => {
    const feature = sketch([point('p', 0, 0), line('a', 0), line('b', 10)]);

    expect(action(feature, ['p#0', 'a', 'b'], 'point-on-line')).toBeUndefined();
    expect(action(feature, ['p#0', 'a'], 'point-on-line')).toBeDefined();
  });

  it('keeps symmetric limited to an exact selection', () => {
    const feature = sketch([
      point('p1', 0, 0),
      point('p2', 5, 2),
      point('p3', 9, 4),
      point('p4', 12, 6),
    ]);

    expect(action(feature, ['p1#0', 'p2#0', 'p3#0'], 'symmetric')).toBeDefined();
    expect(action(feature, ['p1#0', 'p2#0', 'p3#0', 'p4#0'], 'symmetric')).toBeUndefined();
  });
});

describe('group constraints in the solver', () => {
  it('solves a grouped equality across three lines', () => {
    const entities = [line('a', 0), line('b', 10), line('c', 20)];
    const feature = sketch(entities);
    const selection = ['a', 'b', 'c'];
    const constraints = (['equal', 'horizontal'] as const).flatMap((type) =>
      constraintsForAction(
        action(feature, selection, type)!,
        sketchEntityIndex(entities),
      ),
    );

    gcs.clear_data();
    const { primitives } = buildSolverPrimitives(entities, constraints);
    gcs.push_primitives_and_params(primitives);
    expect(gcs.solve(Algorithm.DogLeg)).toBeLessThan(2);
    gcs.apply_solution();

    const solved = applySolverSolution(entities, gcs.sketch_index.get_primitives());
    const lengths = solved.map((entity) =>
      entity.type === 'line' ? Math.hypot(entity.x2 - entity.x1, entity.y2 - entity.y1) : NaN,
    );
    expect(lengths[1]).toBeCloseTo(lengths[0]!, 3);
    expect(lengths[2]).toBeCloseTo(lengths[0]!, 3);
    expect(gcs.get_gcs_conflicting_constraints()).toEqual([]);
  });
});

describe('constraint and geometry cross-selection', () => {
  const constraints: SketchConstraint[] = [
    {
      id: 'equal-lines',
      type: 'equal',
      refs: [{ entityId: 'a' }, { entityId: 'b' }],
    },
    {
      id: 'point-on-line',
      type: 'point-on-line',
      refs: [{ entityId: 'p', pointIndex: 0 }, { entityId: 'l' }],
    },
    {
      id: 'fix-circle',
      type: 'fix',
      refs: [{ entityId: 'c', pointIndex: 0 }],
      x: 1,
      y: 2,
    },
  ];
  const feature: SketchFeature = {
    ...sketch([line('a', 0), line('b', 10), line('l', 20), point('p', 0, 0), circle('c', 4)]),
    constraints,
  };

  it('collects the geometry of several constraints without duplicates', () => {
    expect(constraintsGeometryIds(constraints.slice(0, 2))).toEqual(['a', 'b', 'p', 'l']);
  });

  it('collects every constraint that refers to any selected entity', () => {
    expect(constraintIdsForEntities(feature, ['a', 'l'])).toEqual(['equal-lines', 'point-on-line']);
    expect(constraintIdsForEntities(feature, ['c'])).toEqual(['fix-circle']);
    expect(constraintIdsForEntities(feature, ['missing'])).toEqual([]);
  });
});

describe('geometry context menu deletion', () => {
  const feature = sketch([line('a', 0), line('b', 10)]);

  function deleteTargets(entityId: string, selectedEntityIds: string[]): string[] | null {
    let deleted: string[] | null = null;
    const menu = referenceMenuItems(
      feature,
      entityId,
      (key) => key,
      'en',
      () => {},
      {
        selectedEntityIds,
        onDelete: (ids) => {
          deleted = ids;
        },
      },
    );
    const item = menu.find((candidate) => candidate.id === 'delete-geometry');
    if (!item || !('onSelect' in item)) return null;
    item.onSelect();
    return deleted;
  }

  it('deletes the whole selected group when the clicked geometry is in it', () => {
    expect(deleteTargets('a', ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('deletes only the clicked geometry when it is not selected', () => {
    expect(deleteTargets('a', ['b'])).toEqual(['a']);
  });

  it('offers no deletion for fundamental geometry on its own', () => {
    expect(deleteTargets(SKETCH_X_AXIS_ID, [SKETCH_X_AXIS_ID])).toBeNull();
    expect(deleteTargets(SKETCH_X_AXIS_ID, [SKETCH_X_AXIS_ID, 'a'])).toEqual(['a']);
  });
});
