import { describe, expect, it } from 'vitest';
import {
  activeModel,
  applyCommands,
  bodiesInHistory,
  createProject,
  parseProject,
  validateHistory,
  type BooleanFeature,
  type PrimitiveFeature,
  type Project,
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

function booleanFeature(patch: Partial<BooleanFeature> = {}): BooleanFeature {
  return {
    id: 'feat_boolean',
    name: 'Boolean',
    suppressed: false,
    type: 'boolean',
    op: 'union',
    bodyIds: ['body_a'],
    toolIds: ['body_b'],
    keepBodies: false,
    keepTools: false,
    ...patch,
  };
}

function withBoxes(patch: Partial<BooleanFeature> = {}): Project {
  return applyCommands(createProject('Boolean'), [
    { type: 'feature/add', feature: box('box_a') },
    { type: 'feature/add', feature: box('box_b') },
    { type: 'body/add', body: { id: 'body_a', createdBy: 'box_a' } },
    { type: 'body/add', body: { id: 'body_b', createdBy: 'box_b' } },
    { type: 'feature/add', feature: booleanFeature(patch) },
  ]);
}

describe('boolean feature model', () => {
  it('fills the second list and the Keep flags when opening an older project', () => {
    const project = createProject('Boolean');
    const model = activeModel(project);
    const raw = {
      ...project,
      superObjects: [
        {
          ...model,
          features: [
            {
              id: 'feat_boolean',
              name: 'Boolean',
              type: 'boolean',
              op: 'union',
              bodyIds: ['body_a'],
            },
          ],
        },
      ],
    };
    const parsed = activeModel(parseProject(raw)).features[0] as BooleanFeature;
    expect(parsed.toolIds).toEqual([]);
    expect(parsed.keepBodies).toBe(false);
    expect(parsed.keepTools).toBe(false);
  });

  it('hides the bodies the rebuild reports as consumed and brings them back', () => {
    const model = activeModel(withBoxes());
    expect(bodiesInHistory(model).map((body) => body.id)).toEqual(['body_a', 'body_b']);
    expect(bodiesInHistory(model, new Set(['body_a', 'body_b'])).map((body) => body.id)).toEqual(
      [],
    );
    expect(bodiesInHistory(model, new Set(['body_b'])).map((body) => body.id)).toEqual(['body_a']);
    // A later build that consumes nothing returns the same refs unchanged.
    expect(bodiesInHistory(model).map((body) => body.id)).toEqual(['body_a', 'body_b']);
  });

  it('checks both lists for unknown bodies and build order', () => {
    const project = withBoxes();
    const broken = createProject('Broken');
    const model = activeModel(broken);
    const unknown = {
      ...broken,
      superObjects: [
        {
          ...model,
          features: [booleanFeature({ toolIds: ['body_missing'] })],
        },
      ],
    };
    expect(
      validateHistory(activeModel(unknown)).some(
        (issue) => issue.code === 'UNKNOWN_BODY' && issue.featureId === 'feat_boolean',
      ),
    ).toBe(true);

    const reordered = {
      ...project,
      superObjects: [
        {
          ...activeModel(project),
          features: [booleanFeature(), box('box_a'), box('box_b')],
        },
      ],
    };
    expect(
      validateHistory(activeModel(reordered)).some(
        (issue) => issue.code === 'DEPENDENCY_AFTER_USE' && issue.featureId === 'feat_boolean',
      ),
    ).toBe(true);
  });
});
