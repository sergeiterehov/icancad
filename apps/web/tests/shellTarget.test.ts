import { beforeEach, describe, expect, it } from 'vitest';
import type { TessellationResult } from '@icancad/kernel';
import type { Model, Project, ShellFeature } from '@icancad/model';
import { resolveFaceRef } from '../src/kernel/faceLookup';
import { resolveShellFaceRef, shellFaceRef, shellInputFromSelection } from '../src/quick/shell';
import { useDocumentStore } from '../src/stores/documentStore';
import { cubeMesh } from './cubeMesh';
import { modelOf, modelProject } from './modelFixture';

const BODY = 'body-1';

function project(): Project {
  return modelProject(
    {
      features: [
        {
          id: 'box',
          name: 'Box',
          suppressed: false,
          type: 'primitive',
          kind: 'box',
          params: { dx: 20, dy: 20, dz: 20 },
          transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
        },
      ],
      bodies: [{ id: BODY, createdBy: 'box' }],
    },
    'Shell',
  );
}

describe('shell input', () => {
  const mesh = cubeMesh();

  it('takes selected bodies', () => {
    expect(
      shellInputFromSelection(modelOf(project()), [{ kind: 'body', id: BODY }], { [BODY]: mesh }),
    ).toEqual({ bodyIds: [BODY], faceRefs: [] });
  });

  it('takes selected faces and makes their body a target', () => {
    const input = shellInputFromSelection(
      modelOf(project()),
      [{ kind: 'body-face', id: `${BODY}#5` }],
      { [BODY]: mesh },
    );
    expect(input?.bodyIds).toEqual([BODY]);
    expect(input?.faceRefs).toHaveLength(1);
    const ref = input!.faceRefs![0]!;
    expect(ref.faceId).toBe('5');
    expect(ref.normal).toEqual([0, 0, 1]);
    expect(ref.origin[2]).toBeCloseTo(20, 6);
    expect(
      resolveFaceRef(
        {
          bodyShapes: new Map([[BODY, 'shape-1']]),
          meshes: { [BODY]: mesh },
          bodyStats: { [BODY]: { faces: 6, edges: 12, solids: 1 } },
        },
        ref,
      ),
    ).toEqual({ bodyId: BODY, faceId: 5 });
  });

  it('ignores meshes and empty selections', () => {
    expect(shellInputFromSelection(modelOf(project()), [], {})).toBeNull();
    const withMesh: Model = {
      ...modelOf(project()),
      bodies: [...modelOf(project()).bodies, { id: 'mesh-1', createdBy: 'import', kind: 'mesh' }],
    };
    expect(shellInputFromSelection(withMesh, [{ kind: 'mesh', id: 'mesh-1' }], {})).toBeNull();
  });

  it('keeps a face ref readable after the body is swapped by a rebuild', () => {
    expect(shellFaceRef(mesh, BODY, 'bad')).toBeNull();
    const ref = shellFaceRef(mesh, BODY, '5')!;
    expect(ref.normal).toEqual([0, 0, 1]);
  });

  it('opens a curved face that has no single normal', () => {
    // Two equal triangles with opposite windings: their area-weighted normal
    // cancels, which is what a full cylindrical face looks like.
    const curved: TessellationResult = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0]),
      normals: new Float32Array(18),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      faceIds: new Uint32Array([0, 0]),
      triangleCount: 2,
      vertexCount: 6,
      bbox: { min: [0, 0, 0], max: [1, 1, 0] },
      edges: [],
    };
    const ref = shellFaceRef(curved, BODY, '0')!;
    expect(Number.isFinite(ref.normal[0])).toBe(true);
    expect(ref.origin[0]).toBeCloseTo(1 / 3, 6);
    const context = {
      bodyShapes: new Map([[BODY, 'shape-1']]),
      meshes: { [BODY]: curved },
      bodyStats: { [BODY]: { faces: 1, edges: 0, solids: 1 } },
    };
    expect(resolveFaceRef(context, ref)).toBeNull();
    expect(resolveShellFaceRef(context, ref)).toEqual({ bodyId: BODY, faceId: 0 });
  });
});

describe('shell document actions', () => {
  beforeEach(() => {
    useDocumentStore.getState().hydrate(project());
  });

  const shell = (): ShellFeature | undefined => {
    const store = useDocumentStore.getState();
    return modelOf(store.project).features.find(
      (feature): feature is ShellFeature => feature.type === 'shell',
    );
  };

  it('creates the operation from the selection and adds a picked face body', () => {
    const mesh = cubeMesh();
    const input = shellInputFromSelection(
      modelOf(useDocumentStore.getState().project),
      [{ kind: 'body-face', id: `${BODY}#5` }],
      { [BODY]: mesh },
    )!;
    const id = useDocumentStore.getState().addShell('Shell', input);
    expect(id).toBeTruthy();
    expect(shell()).toMatchObject({
      type: 'shell',
      bodyIds: [BODY],
      thickness: 2,
      offset: 0,
      direction: 'inward',
    });
    expect(shell()?.removeFaces).toHaveLength(1);
  });

  it('drops the body and its openings together', () => {
    const input = shellInputFromSelection(
      modelOf(useDocumentStore.getState().project),
      [{ kind: 'body-face', id: `${BODY}#5` }],
      { [BODY]: cubeMesh() },
    )!;
    const id = useDocumentStore.getState().addShell('Shell', input)!;
    useDocumentStore.getState().toggleShellBody(id, BODY);
    expect(shell()?.bodyIds).toEqual([]);
    expect(shell()?.removeFaces).toEqual([]);
  });

  it('keeps the body when only an opening is removed', () => {
    const input = shellInputFromSelection(
      modelOf(useDocumentStore.getState().project),
      [{ kind: 'body-face', id: `${BODY}#5` }],
      { [BODY]: cubeMesh() },
    )!;
    const id = useDocumentStore.getState().addShell('Shell', input)!;
    const ref = shell()!.removeFaces[0]!;
    useDocumentStore.getState().toggleShellFace(id, ref);
    expect(shell()?.bodyIds).toEqual([BODY]);
    expect(shell()?.removeFaces).toEqual([]);
  });
});
