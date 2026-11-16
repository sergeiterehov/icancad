import { activeModel, type Feature, type Model } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { extrudeInputFromSelection } from '../src/quick/extrude';
import { useDocumentStore } from '../src/stores/documentStore';
import { useKernelStore } from '../src/stores/kernelStore';
import { cubeMesh } from './cubeMesh';
import { modelOf, modelProject } from './modelFixture';

const BODY = 'body-1';

function sketch(id: string): Feature {
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

function box(): Feature {
  return {
    id: 'box',
    name: 'Box',
    suppressed: false,
    type: 'primitive',
    kind: 'box',
    params: { dx: 20, dy: 20, dz: 20 },
    transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
  };
}

function model(patch: Partial<Model> = {}): Model {
  return modelOf(
    modelProject({
      features: [sketch('s'), sketch('s2'), box()],
      bodies: [{ id: BODY, createdBy: 'box' }],
      ...patch,
    }),
  );
}

const meshes = { [BODY]: cubeMesh() };

describe('extrude input from the selection', () => {
  it('takes a whole sketch', () => {
    expect(extrudeInputFromSelection(model(), [{ kind: 'sketch', id: 's' }], {})).toEqual({
      sketchId: 's',
    });
  });

  it('takes the regions picked inside one sketch', () => {
    expect(
      extrudeInputFromSelection(
        model(),
        [
          { kind: 'face', id: 's#f1' },
          { kind: 'face', id: 's#f2' },
        ],
        {},
      ),
    ).toEqual({ sketchId: 's', regions: ['f1', 'f2'] });
  });

  it('refuses profiles of two sketches', () => {
    expect(
      extrudeInputFromSelection(
        model(),
        [
          { kind: 'face', id: 's#f1' },
          { kind: 'face', id: 's2#f1' },
        ],
        {},
      ),
    ).toBeNull();
    expect(
      extrudeInputFromSelection(
        model(),
        [
          { kind: 'sketch', id: 's' },
          { kind: 'sketch', id: 's2' },
        ],
        {},
      ),
    ).toBeNull();
  });

  it('takes a face of a body with the pose it has now', () => {
    const input = extrudeInputFromSelection(
      model(),
      [{ kind: 'body-face', id: `${BODY}#5` }],
      meshes,
    );
    expect(input?.faceRefs).toHaveLength(1);
    const ref = input!.faceRefs![0]!;
    expect(ref.bodyId).toBe(BODY);
    expect(ref.faceId).toBe('5');
    // The +Z face of the cube: its normal points out of the material.
    expect(ref.normal[2]).toBeCloseTo(1, 9);
    expect(ref.origin[0]).toBeCloseTo(10, 6);
    expect(ref.origin[1]).toBeCloseTo(10, 6);
    expect(ref.origin[2]).toBeCloseTo(20, 6);
  });

  it('keeps the order the faces were picked in', () => {
    const input = extrudeInputFromSelection(
      model(),
      [
        { kind: 'body-face', id: `${BODY}#5` },
        { kind: 'body-face', id: `${BODY}#2` },
      ],
      meshes,
    );
    expect(input?.faceRefs?.map((ref) => ref.faceId)).toEqual(['5', '2']);
  });

  it('takes a sketch and a body face as one operation', () => {
    expect(
      extrudeInputFromSelection(
        model(),
        [
          { kind: 'sketch', id: 's' },
          { kind: 'body-face', id: `${BODY}#5` },
        ],
        meshes,
      ),
    ).toMatchObject({ sketchId: 's', faceRefs: [{ faceId: '5' }] });
  });

  it('leaves out a face it cannot turn into a profile', () => {
    // A face that is not in the tessellation, a face of a mesh body and a
    // reference to a body that is not there say nothing a solid can grow from.
    expect(
      extrudeInputFromSelection(model(), [{ kind: 'body-face', id: `${BODY}#9` }], meshes),
    ).toBeNull();
    const meshed = model({
      bodies: [
        { id: BODY, createdBy: 'box' },
        { id: 'mesh-1', createdBy: 'box', kind: 'mesh' },
      ],
    });
    expect(
      extrudeInputFromSelection(meshed, [{ kind: 'body-face', id: 'mesh-1#0' }], {
        'mesh-1': cubeMesh(),
      }),
    ).toBeNull();
    expect(
      extrudeInputFromSelection(model(), [{ kind: 'body-face', id: 'gone#0' }], meshes),
    ).toBeNull();
  });

  it('leaves out what the cursor has rolled past', () => {
    // The sketch comes before the cursor, the box does not, so a new operation
    // cannot be built on the face of that body.
    expect(
      extrudeInputFromSelection(
        model({ historyEnd: 's' }),
        [{ kind: 'body-face', id: `${BODY}#5` }],
        meshes,
      ),
    ).toBeNull();
  });

  it('has nothing to take from edges or bodies', () => {
    expect(
      extrudeInputFromSelection(
        model(),
        [
          { kind: 'edge', id: `${BODY}#1` },
          { kind: 'body', id: BODY },
        ],
        meshes,
      ),
    ).toBeNull();
  });

  it('is empty for an empty selection', () => {
    expect(extrudeInputFromSelection(model(), [], meshes)).toBeNull();
  });
});

describe('an extrude opened on body faces', () => {
  it('holds the picked faces and keeps them after the visit', () => {
    useKernelStore.setState({ featureErrors: {} });
    useDocumentStore
      .getState()
      .hydrate(modelProject({ features: [box()], bodies: [{ id: BODY, createdBy: 'box' }] }));
    const id = useDocumentStore.getState().addExtrude('Extrude', {
      faceRefs: [{ bodyId: BODY, faceId: '5', normal: [0, 0, 1], origin: [10, 10, 20] }],
    });
    expect(id).toBeTruthy();
    const feature = activeModel(useDocumentStore.getState().project).features.find(
      (candidate) => candidate.id === id,
    );
    expect(feature).toMatchObject({
      type: 'extrude',
      faceRefs: [{ bodyId: BODY, faceId: '5' }],
      objectOrder: [`b:${BODY}#5`],
      scope: 'all',
    });

    // A tool that was given something to work on leaves a step behind.
    useDocumentStore.getState().endFeatureEdit();
    expect(
      activeModel(useDocumentStore.getState().project).features.some(
        (candidate) => candidate.id === id,
      ),
    ).toBe(true);
  });

  it('lists sketch profiles before faces', () => {
    useKernelStore.setState({ featureErrors: {} });
    useDocumentStore
      .getState()
      .hydrate(
        modelProject({ features: [sketch('s'), box()], bodies: [{ id: BODY, createdBy: 'box' }] }),
      );
    const id = useDocumentStore.getState().addExtrude('Extrude', {
      sketchId: 's',
      regions: ['f1'],
      faceRefs: [{ bodyId: BODY, faceId: '5', normal: [0, 0, 1], origin: [10, 10, 20] }],
    })!;
    expect(
      activeModel(useDocumentStore.getState().project).features.find(
        (candidate) => candidate.id === id,
      ),
    ).toMatchObject({ objectOrder: ['s:s#f1', `b:${BODY}#5`], scope: 'selected' });
  });
});
