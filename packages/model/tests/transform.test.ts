import { describe, expect, it } from 'vitest';
import {
  activeModel,
  applyCommands,
  createProject,
  featureParameterSpecs,
  getFeatureDependencies,
  parseProject,
  validateHistory,
  type BodyRef,
  type Feature,
  type PrimitiveFeature,
  type Project,
  type SketchFeature,
  type TransformFeature,
} from '../src/index';

const transform = {
  translation: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  scale: 1,
};

function box(id: string): PrimitiveFeature {
  return {
    id,
    name: id,
    suppressed: false,
    type: 'primitive',
    kind: 'box',
    params: { dx: 20, dy: 20, dz: 20 },
    transform,
  };
}

function sketch(id: string): SketchFeature {
  return {
    id,
    name: id,
    suppressed: false,
    type: 'sketch',
    plane: { type: 'datum', plane: 'XY', offset: 0 },
    entities: [],
    constraints: [],
    references: [],
  };
}

function move(patch: Partial<TransformFeature> = {}): TransformFeature {
  return {
    id: 'feat_move',
    name: 'Transform',
    suppressed: false,
    type: 'transform',
    bodyIds: ['body_a'],
    sketchIds: [],
    transform: { translation: [10, 0, 0], rotation: [0, 0, 90], scale: 2 },
    ...patch,
  };
}

/** A project whose model holds exactly these operations, unchecked by commands. */
function rawProject(features: Feature[], bodies: BodyRef[] = []): Project {
  const project = createProject('Transform');
  const model = activeModel(project);
  return {
    ...project,
    superObjects: [{ ...model, features, bodies }],
  };
}

function validProject(feature: TransformFeature): Project {
  return applyCommands(createProject('Transform'), [
    { type: 'feature/add', feature: sketch('feat_sketch') },
    { type: 'feature/add', feature: box('box_a') },
    { type: 'body/add', body: { id: 'body_a', createdBy: 'box_a' } },
    { type: 'feature/add', feature },
  ]);
}

describe('transform feature model', () => {
  it('fills the new lists when opening an older project', () => {
    const project = createProject('Transform');
    const raw = {
      ...project,
      superObjects: [
        {
          ...activeModel(project),
          features: [
            {
              id: 'feat_move',
              name: 'Transform',
              type: 'transform',
              bodyIds: ['body_a'],
              transform,
            },
          ],
        },
      ],
    };
    const parsed = activeModel(parseProject(raw)).features[0] as TransformFeature;
    expect(parsed.bodyIds).toEqual(['body_a']);
    expect(parsed.sketchIds).toEqual([]);
  });

  it('keeps both lists through a round trip', () => {
    const project = validProject(move({ sketchIds: ['feat_sketch'] }));
    const parsed = activeModel(parseProject(JSON.parse(JSON.stringify(project))));
    const feature = parsed.features[2] as TransformFeature;
    expect(feature.bodyIds).toEqual(['body_a']);
    expect(feature.sketchIds).toEqual(['feat_sketch']);
    expect(feature.transform).toEqual({ translation: [10, 0, 0], rotation: [0, 0, 90], scale: 2 });
  });

  it('depends on the bodies it moves and on the sketches whose result it moves', () => {
    const model = activeModel(validProject(move({ sketchIds: ['feat_sketch'] })));
    const feature = model.features[2]!;
    expect(getFeatureDependencies(feature, model).sort()).toEqual(['box_a', 'feat_sketch']);
  });

  it('reports a sketch that comes after the operation', () => {
    const project = rawProject([move({ sketchIds: ['feat_sketch'] }), sketch('feat_sketch')]);
    const issues = validateHistory(activeModel(project));
    expect(issues.map((issue) => issue.code)).toContain('DEPENDENCY_AFTER_USE');
  });

  it('reports a sketch that does not exist', () => {
    const project = rawProject([move({ sketchIds: ['feat_missing'] })]);
    const issues = validateHistory(activeModel(project));
    expect(issues.map((issue) => issue.code)).toContain('MISSING_DEPENDENCY');
  });

  it('registers the translation, rotation and scale as parameters', () => {
    const paths = featureParameterSpecs(move()).map((spec) => spec.path);
    expect(paths).toEqual([
      'transform.translation.0',
      'transform.translation.1',
      'transform.translation.2',
      'transform.rotation.0',
      'transform.rotation.1',
      'transform.rotation.2',
      'transform.scale',
    ]);
  });
});
