import type { ResolvedModel, SketchFeature } from '@icancad/model';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyConstraintAction } from '../src/sketch/constraintModel';
import { useFormulaStore } from '../src/stores/formulaStore';

vi.mock('../src/sketch/client', () => ({
  solveSketch: vi.fn(async (entities: unknown[]) => ({
    entities,
    conflicting: [],
    redundant: [],
    frozenEntityIds: [],
  })),
}));

function sketch(): SketchFeature {
  return {
    id: 'sketch',
    name: 'Sketch',
    suppressed: false,
    type: 'sketch',
    plane: { type: 'datum', plane: 'XY', offset: 0 },
    entities: [{ id: 'line', type: 'line', construction: false, x1: 0, y1: 0, x2: 14, y2: 0 }],
    constraints: [
      {
        id: 'formula_distance',
        type: 'distance',
        refs: [
          { entityId: 'line', pointIndex: 0 },
          { entityId: 'line', pointIndex: 1 },
        ],
        value: { formula: 'width' },
      },
    ],
    references: [],
    projections: [],
  };
}

function resolveSketch(feature: SketchFeature): void {
  const resolved = {
    ...feature,
    constraints: feature.constraints.map((constraint) => ({ ...constraint, value: 14 })),
  };
  const model: ResolvedModel = {
    type: 'model',
    id: 'model',
    name: 'Model',
    features: [resolved as unknown as ResolvedModel['features'][number]],
    bodies: [],
    metadata: {},
    view: { sectionPlanes: [] },
    historyEnd: null,
    variables: [],
    groups: [],
  };
  useFormulaStore.getState().setResolution({
    model,
    inputKey: 'test',
    variableValues: { width: 14 },
    variableErrors: {},
    errors: {},
    drivenSketches: new Set([feature.id]),
    revision: 1,
  });
}

beforeEach(() => useFormulaStore.getState().reset());

describe('constraint actions with formulas', () => {
  it('keeps authored formulas when a new constraint solves the sketch', async () => {
    const feature = sketch();
    resolveSketch(feature);

    const next = await applyConstraintAction(feature, {
      key: 'horizontal',
      type: 'horizontal',
      refs: [{ entityId: 'line' }],
    });

    expect(next.constraints[0]).toMatchObject({ value: { formula: 'width' } });
    expect(next.constraints).toHaveLength(2);
  });

  it('adds a constraint without solving while a formula is broken', async () => {
    const feature = sketch();
    useFormulaStore.getState().setResolution({
      model: { ...feature, features: [feature] } as unknown as ResolvedModel,
      inputKey: 'error',
      variableValues: {},
      variableErrors: {},
      errors: { [feature.id]: { 'constraints.0.value': { code: 'UNKNOWN_NAME', message: 'x' } } },
      drivenSketches: new Set(),
      revision: 2,
    });

    const next = await applyConstraintAction(feature, {
      key: 'horizontal',
      type: 'horizontal',
      refs: [{ entityId: 'line' }],
    });

    expect(next.constraints[0]).toMatchObject({ value: { formula: 'width' } });
    expect(next.constraints).toHaveLength(2);
  });
});
