import { describe, expect, it } from 'vitest';
import {
  activeModel,
  applyCommands,
  createProject,
  featureBodyId,
  getFeatureDependencies,
  parseProject,
  validateHistory,
  type ArrayFeature,
  type PrimitiveFeature,
  type SketchFeature,
} from '../src/index';

const transform = {
  translation: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  scale: 1,
};

const box: PrimitiveFeature = {
  id: 'feat_box',
  name: 'Box',
  suppressed: false,
  type: 'primitive',
  kind: 'box',
  params: { dx: 10, dy: 10, dz: 10 },
  transform,
};

const sketch: SketchFeature = {
  id: 'feat_sketch',
  name: 'Path',
  suppressed: false,
  type: 'sketch',
  plane: { type: 'datum', plane: 'XY', offset: 0 },
  entities: [],
  constraints: [],
  references: [],
};

const array: ArrayFeature = {
  id: 'feat_array',
  name: 'Array',
  suppressed: false,
  type: 'array',
  target: 'bodies',
  bodyIds: [featureBodyId(box.id)],
  featureIds: [],
  directions: [
    { kind: 'linear', direction: [1, 0, 0], spacing: 12, count: 3 },
    { kind: 'rotation', axis: { kind: 'world', axis: 'z' }, angle: 45, count: 2 },
    { kind: 'path', path: { kind: 'sketch-edge', sketchId: sketch.id, entityId: 'line' }, count: 4 },
  ],
};

function arrayProject() {
  return applyCommands(createProject('Array'), [
    { type: 'feature/add', feature: box },
    { type: 'body/add', body: { id: featureBodyId(box.id), createdBy: box.id } },
    { type: 'feature/add', feature: sketch },
    { type: 'feature/add', feature: array },
  ]);
}

describe('array feature', () => {
  it('is a valid part of the history', () => {
    const model = activeModel(arrayProject());
    const errors = validateHistory(model).filter((issue) => issue.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('depends on the bodies it repeats and on the path sketch', () => {
    const model = activeModel(arrayProject());
    const dependencies = getFeatureDependencies(array, model);
    expect(new Set(dependencies)).toEqual(new Set([box.id, sketch.id]));
  });

  it('survives a project round trip', () => {
    const project = arrayProject();
    const parsed = parseProject(JSON.parse(JSON.stringify(project)));
    const parsedArray = activeModel(parsed).features.find(
      (feature): feature is ArrayFeature => feature.type === 'array',
    );
    expect(parsedArray).toEqual(array);
  });
});
