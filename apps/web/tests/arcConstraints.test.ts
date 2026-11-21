import { createRequire } from 'node:module';
import type { SketchConstraint, SketchEntity, SketchFeature } from '@icancad/model';
import {
  Algorithm,
  GcsWrapper,
  init_planegcs_module,
  type ModuleStatic,
} from '@salusoft89/planegcs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildConstraintActions, constraintsSatisfied } from '../src/sketch/constraintModel';
import { referenceAnnotations } from '../src/sketch/dimensions';
import { referenceMenuItems } from '../src/sketch/referenceMenu';
import { applySolverSolution, buildSolverPrimitives } from '../src/sketch/mapping';

let gcs: GcsWrapper;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const wasm = require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm');
  const mod = (await init_planegcs_module({ locateFile: () => wasm })) as ModuleStatic;
  gcs = new GcsWrapper(new mod.GcsSystem(), mod);
  gcs.set_max_iterations(200);
});

const arc = (startAngle: number, endAngle: number, r = 10): SketchEntity => ({
  id: 'a',
  type: 'arc',
  construction: false,
  cx: 0,
  cy: 0,
  r,
  startAngle,
  endAngle,
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

function action(type: SketchConstraint['type']) {
  return buildConstraintActions(sketch([arc(0, Math.PI / 3)]), ['a']).find(
    (candidate) => candidate.type === type,
  );
}

function solve(entities: SketchEntity[], constraints: SketchConstraint[]) {
  gcs.clear_data();
  const { primitives } = buildSolverPrimitives(entities, constraints);
  gcs.push_primitives_and_params(primitives);
  const status = gcs.solve(Algorithm.DogLeg);
  const conflicting = gcs.get_gcs_conflicting_constraints();
  if (status >= 2) return { status, conflicting, entities };
  gcs.apply_solution();
  return {
    status,
    conflicting,
    entities: applySolverSolution(entities, gcs.sketch_index.get_primitives()),
  };
}

function setup(start: number, end: number) {
  const entity = arc(start, end);
  const fixes: SketchConstraint[] = [
    { id: 'f0', type: 'fix', refs: [{ entityId: 'a', pointIndex: 0 }], x: 0, y: 0 },
    {
      id: 'f1',
      type: 'fix',
      refs: [{ entityId: 'a', pointIndex: 1 }],
      x: Math.cos(start) * 10,
      y: Math.sin(start) * 10,
    },
    { id: 'r', type: 'radius', refs: [{ entityId: 'a' }], value: 10 },
  ];
  return { entity, fixes };
}

function solvedArc(result: ReturnType<typeof solve>) {
  return result.entities.find((entity) => entity.id === 'a') as Extract<
    SketchEntity,
    { type: 'arc' }
  >;
}

describe('arc dimensions', () => {
  it('offers arc length and sweep angle for a single arc', () => {
    expect(action('arc-length')?.value).toBeCloseTo(10.47, 2);
    expect(action('angle')?.value).toBe(60);
  });

  it('shows arc length and sweep as references until they are constrained', () => {
    const entity = arc(0, Math.PI / 3);
    const feature: SketchFeature = {
      ...sketch([entity]),
      references: [
        { id: 'ref-length', entityId: 'a', measure: 'length' },
        { id: 'ref-angle', entityId: 'a', measure: 'angle' },
      ],
    };
    expect(referenceAnnotations(feature, 'en', 'mm').map((item) => item.text)).toEqual([
      '60°',
      '10.47 mm',
    ]);

    const constrained: SketchFeature = {
      ...feature,
      constraints: [
        { id: 'len', type: 'arc-length', refs: [{ entityId: 'a' }], value: 10.47 },
        { id: 'ang', type: 'angle', refs: [{ entityId: 'a' }], value: 60, side: 1 },
      ],
    };
    expect(referenceAnnotations(constrained, 'en', 'mm')).toEqual([]);
  });

  it('recognises an arc dimension that the geometry already meets', () => {
    const entity = arc(0, Math.PI / 3);
    const length = (Math.PI / 3) * 10;
    expect(
      constraintsSatisfied(
        [{ id: 'len', type: 'arc-length', refs: [{ entityId: 'a' }], value: length }],
        [entity],
      ),
    ).toBe(true);
    expect(
      constraintsSatisfied(
        [{ id: 'len', type: 'arc-length', refs: [{ entityId: 'a' }], value: length + 1 }],
        [entity],
      ),
    ).toBe(false);
    expect(
      constraintsSatisfied(
        [{ id: 'ang', type: 'angle', refs: [{ entityId: 'a' }], value: 60 }],
        [entity],
      ),
    ).toBe(true);
    expect(
      constraintsSatisfied(
        [{ id: 'ang', type: 'angle', refs: [{ entityId: 'a' }], value: 61 }],
        [entity],
      ),
    ).toBe(false);
  });

  it('offers arc length and sweep as reference measurements', () => {
    const feature = sketch([arc(0, Math.PI / 3)]);
    const ids = referenceMenuItems(
      feature,
      'a',
      (key) => key,
      'en',
      () => undefined,
    )
      .map((item) => item.id)
      .filter((id): id is string => typeof id === 'string');
    expect(ids).toContain('reference-length');
    expect(ids).toContain('reference-angle');

    const labels = new Map(
      referenceMenuItems(
        sketch([arc(0, Math.PI / 3, 45)]),
        'a',
        (key) => key,
        'en',
        () => undefined,
      )
        .filter((item): item is typeof item & { id: string } => typeof item.id === 'string')
        .map((item) => [item.id, 'label' in item ? item.label : null]),
    );
    expect(labels.get('reference-length')).toBe('47.12 mm');
    expect(labels.get('reference-radius')).toBe('45 mm');
    expect(labels.get('reference-diameter')).toBe('90 mm');
    expect(labels.get('reference-angle')).toBe('60°');
  });

  it('solves arc length without flipping a counter-clockwise arc', () => {
    const { entity, fixes } = setup(0, Math.PI / 3);
    const result = solve(
      [entity],
      [...fixes, { id: 'len', type: 'arc-length', refs: [{ entityId: 'a' }], value: 20.944 }],
    );
    expect(result.conflicting).toEqual([]);
    expect(solvedArc(result).endAngle).toBeCloseTo((Math.PI * 2) / 3, 3);
  });

  it('keeps a clockwise arc clockwise under an arc length constraint', () => {
    const { entity, fixes } = setup(0, -Math.PI / 3);
    const result = solve(
      [entity],
      [...fixes, { id: 'len', type: 'arc-length', refs: [{ entityId: 'a' }], value: 20.944 }],
    );
    expect(result.conflicting).toEqual([]);
    expect(solvedArc(result).endAngle).toBeCloseTo((-Math.PI * 2) / 3, 3);
  });

  it('sets an arc sweep angle in both directions', () => {
    const positive = setup(0, Math.PI / 3);
    const positiveResult = solve(
      [positive.entity],
      [
        ...positive.fixes,
        { id: 'ang', type: 'angle', refs: [{ entityId: 'a' }], value: 120, side: 1 },
      ],
    );
    expect(positiveResult.conflicting).toEqual([]);
    expect(solvedArc(positiveResult).endAngle).toBeCloseTo((Math.PI * 2) / 3, 3);

    const negative = setup(0, -Math.PI / 3);
    const negativeResult = solve(
      [negative.entity],
      [
        ...negative.fixes,
        { id: 'ang', type: 'angle', refs: [{ entityId: 'a' }], value: 120, side: -1 },
      ],
    );
    expect(negativeResult.conflicting).toEqual([]);
    expect(solvedArc(negativeResult).endAngle).toBeCloseTo((-Math.PI * 2) / 3, 3);
  });
});

describe('a curve centre as a constrained point', () => {
  it('puts the centre of an arc on another circle', () => {
    const circle: SketchEntity = {
      id: 'c',
      type: 'circle',
      construction: true,
      cx: 0,
      cy: 0,
      r: 20,
    };
    const entity: SketchEntity = {
      id: 'a',
      type: 'arc',
      construction: false,
      cx: 20,
      cy: 4,
      r: 2,
      startAngle: 0,
      endAngle: Math.PI,
    };
    const result = solve(
      [circle, entity],
      [
        { id: 'fixc', type: 'fix', refs: [{ entityId: 'c' }] },
        { id: 'r', type: 'radius', refs: [{ entityId: 'a' }], value: 2 },
        {
          id: 'on-circle',
          type: 'point-on-circle',
          refs: [
            { entityId: 'a', pointIndex: 0 },
            { entityId: 'c' },
          ],
        },
      ],
    );
    expect(result.conflicting).toEqual([]);
    expect(solvedArc(result).cx ** 2 + solvedArc(result).cy ** 2).toBeCloseTo(400, 3);
  });
});
