import { describe, expect, it } from 'vitest';
import { sketchPlaneFromSelection } from '../src/sketch/facePlane';
import { cubeMesh } from './cubeMesh';

const meshes = { 'body-1': cubeMesh() };

describe('sketch plane from the selection', () => {
  it('takes the plane of the single selected planar face', () => {
    const plane = sketchPlaneFromSelection([{ kind: 'body-face', id: 'body-1#1' }], meshes);
    expect(plane).toMatchObject({ bodyId: 'body-1', faceId: '1' });
    expect(plane?.frame.origin[0]).toBeCloseTo(20);
    expect(plane?.frame.origin[1]).toBeCloseTo(10);
    expect(plane?.frame.origin[2]).toBeCloseTo(10);
    expect(plane?.frame.normal).toEqual([1, 0, 0]);
  });

  it('needs exactly one face of a known body', () => {
    expect(sketchPlaneFromSelection([], meshes)).toBeNull();
    expect(sketchPlaneFromSelection([{ kind: 'body', id: 'body-1' }], meshes)).toBeNull();
    expect(
      sketchPlaneFromSelection(
        [
          { kind: 'body-face', id: 'body-1#1' },
          { kind: 'body-face', id: 'body-1#3' },
        ],
        meshes,
      ),
    ).toBeNull();
    expect(
      sketchPlaneFromSelection([{ kind: 'body-face', id: 'body-1#1' }], {}),
    ).toBeNull();
  });
});
