import { beforeEach, describe, expect, it } from 'vitest';
import { type BooleanFeature, type PrimitiveFeature } from '@icancad/model';
import { booleanInputFromSelection } from '../src/quick/boolean';
import { useDocumentStore } from '../src/stores/documentStore';
import { useUiStore } from '../src/stores/uiStore';
import { modelOf, modelProject } from './modelFixture';

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

function project() {
  return modelProject(
    {
      features: [box('box_a'), box('box_b')],
      bodies: [
        { id: 'body_a', createdBy: 'box_a' },
        { id: 'body_b', createdBy: 'box_b' },
      ],
    },
    'Boolean',
  );
}

function reset() {
  useDocumentStore.getState().hydrate(project());
  useUiStore.setState({ pickingBooleanBodies: null, pickingBooleanTools: null });
}

function booleanOf(): BooleanFeature {
  const feature = modelOf(useDocumentStore.getState().project).features.find(
    (candidate): candidate is BooleanFeature => candidate.type === 'boolean',
  );
  if (!feature) throw new Error('no boolean');
  return feature;
}

describe('boolean selection input', () => {
  it('puts the first picked body in the first list and the rest in the second', () => {
    expect(
      booleanInputFromSelection(modelOf(project()), [
        { kind: 'body', id: 'body_b' },
        { kind: 'body', id: 'body_a' },
      ]),
    ).toEqual({ bodyIds: ['body_b'], toolIds: ['body_a'] });
  });

  it('starts a single picked body on the first list', () => {
    expect(booleanInputFromSelection(modelOf(project()), [{ kind: 'body', id: 'body_a' }])).toEqual(
      { bodyIds: ['body_a'], toolIds: [] },
    );
  });

  it('ignores meshes and non-body selection', () => {
    const model = modelOf(project());
    model.bodies.push({ id: 'mesh-1', createdBy: 'mesh', kind: 'mesh' });
    expect(
      booleanInputFromSelection(model, [
        { kind: 'mesh', id: 'mesh-1' },
        { kind: 'feature', id: 'box_a' },
      ]),
    ).toBeUndefined();
  });
});

describe('boolean creation', () => {
  beforeEach(reset);

  it('starts empty on subtraction and asks for the first list', () => {
    const id = useDocumentStore.getState().addBoolean('Boolean');
    const feature = booleanOf();
    expect(feature.op).toBe('subtract');
    expect(feature.bodyIds).toEqual([]);
    expect(feature.toolIds).toEqual([]);
    expect(feature.keepBodies).toBe(false);
    expect(feature.keepTools).toBe(false);
    expect(useUiStore.getState().pickingBooleanBodies).toBe(id);
    expect(useUiStore.getState().pickingBooleanTools).toBeNull();
  });

  it('starts from picked bodies and asks for the second list', () => {
    const id = useDocumentStore.getState().addBoolean('Boolean', { bodyIds: ['body_a'] });
    expect(booleanOf().bodyIds).toEqual(['body_a']);
    expect(useUiStore.getState().pickingBooleanBodies).toBeNull();
    expect(useUiStore.getState().pickingBooleanTools).toBe(id);
  });

  it('moves a body between the lists instead of keeping it in both', () => {
    useDocumentStore.getState().addBoolean('Boolean', { bodyIds: ['body_a'] });
    const id = booleanOf().id;
    useDocumentStore.getState().toggleBooleanBody(id, 'tools', 'body_a');
    expect(booleanOf().bodyIds).toEqual([]);
    expect(booleanOf().toolIds).toEqual(['body_a']);

    useDocumentStore.getState().toggleBooleanBody(id, 'bodies', 'body_a');
    expect(booleanOf().bodyIds).toEqual(['body_a']);
    expect(booleanOf().toolIds).toEqual([]);
  });

  it('drops a body from a list when it is picked again', () => {
    useDocumentStore.getState().addBoolean('Boolean', { bodyIds: ['body_a'] });
    const id = booleanOf().id;
    useDocumentStore.getState().toggleBooleanBody(id, 'bodies', 'body_a');
    expect(booleanOf().bodyIds).toEqual([]);
  });

  it('writes the operation and the Keep switches', () => {
    useDocumentStore.getState().addBoolean('Boolean', { bodyIds: ['body_a'] });
    const id = booleanOf().id;
    useDocumentStore.getState().setBooleanOp(id, 'union');
    useDocumentStore.getState().setBooleanKeep(id, 'bodies', true);
    useDocumentStore.getState().setBooleanKeep(id, 'tools', true);
    expect(booleanOf().op).toBe('union');
    expect(booleanOf().keepBodies).toBe(true);
    expect(booleanOf().keepTools).toBe(true);
  });

  it('discards a fresh operation that never got both lists', () => {
    useDocumentStore.getState().addBoolean('Boolean', { bodyIds: ['body_a'] });
    expect(
      modelOf(useDocumentStore.getState().project).features.some(
        (feature) => feature.type === 'boolean',
      ),
    ).toBe(true);
    useDocumentStore.getState().endFeatureEdit();
    expect(
      modelOf(useDocumentStore.getState().project).features.some(
        (feature) => feature.type === 'boolean',
      ),
    ).toBe(false);
  });

  it('keeps a fresh operation that has a body on each side', () => {
    useDocumentStore.getState().addBoolean('Boolean', { bodyIds: ['body_a'] });
    const id = booleanOf().id;
    useDocumentStore.getState().toggleBooleanBody(id, 'tools', 'body_b');
    useDocumentStore.getState().endFeatureEdit();
    expect(
      modelOf(useDocumentStore.getState().project).features.some(
        (feature) => feature.type === 'boolean',
      ),
    ).toBe(true);
  });
});
