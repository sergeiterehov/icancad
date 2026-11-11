import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { firstUnclippedHit, isPointClipped, type ClipPlane } from '../src/viewport/sectionPick';

const cutX: ClipPlane = { normal: { x: 1, y: 0, z: 0 }, constant: 0 };

describe('section clipping of picks', () => {
  it('keeps points on the visible side of a plane', () => {
    expect(isPointClipped([cutX], [3, 0, 0])).toBe(false);
  });

  it('clips points the section removed', () => {
    expect(isPointClipped([cutX], [-3, 0, 0])).toBe(true);
  });

  it('keeps points lying on the plane itself', () => {
    expect(isPointClipped([cutX], [0, 5, -2])).toBe(false);
  });

  it('treats a point as clipped when any plane removes it', () => {
    const cutZ: ClipPlane = { normal: { x: 0, y: 0, z: 1 }, constant: 0 };
    expect(isPointClipped([cutX, cutZ], [1, 0, -1])).toBe(true);
    expect(isPointClipped([cutX, cutZ], [1, 0, 1])).toBe(false);
  });

  it('keeps every point when no section is active', () => {
    expect(isPointClipped([], [-3, 0, 0])).toBe(false);
  });
});

type Point = [number, number, number];

/** 0..10 block with a pocket open on the +x face, spanning x 8..10 by y,z 3..7. */
function pocketedBlock(): THREE.Mesh {
  const faces: [Point, Point, Point][] = [];
  const push = (a: Point, b: Point, c: Point, normal: Point) => {
    const ab = new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
    const ac = new THREE.Vector3(...c).sub(new THREE.Vector3(...a));
    // Keep the winding so the face is front facing for a ray hitting `normal`.
    faces.push(ab.cross(ac).dot(new THREE.Vector3(...normal)) > 0 ? [a, b, c] : [a, c, b]);
  };
  const quad = (a: Point, b: Point, c: Point, d: Point, normal: Point) => {
    push(a, b, c, normal);
    push(a, c, d, normal);
  };
  quad([0, 0, 0], [0, 10, 0], [0, 10, 10], [0, 0, 10], [-1, 0, 0]);
  quad([0, 0, 0], [10, 0, 0], [10, 0, 10], [0, 0, 10], [0, -1, 0]);
  quad([0, 10, 0], [0, 10, 10], [10, 10, 10], [10, 10, 0], [0, 1, 0]);
  quad([0, 0, 0], [0, 10, 0], [10, 10, 0], [10, 0, 0], [0, 0, -1]);
  quad([0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10], [0, 0, 1]);
  // +x face: the border around the pocket opening.
  quad([10, 0, 0], [10, 3, 0], [10, 3, 10], [10, 0, 10], [1, 0, 0]);
  quad([10, 7, 0], [10, 10, 0], [10, 10, 10], [10, 7, 10], [1, 0, 0]);
  quad([10, 3, 0], [10, 3, 3], [10, 7, 3], [10, 7, 0], [1, 0, 0]);
  quad([10, 3, 7], [10, 3, 10], [10, 7, 10], [10, 7, 7], [1, 0, 0]);
  // Pocket floor and walls, facing the opening.
  quad([8, 3, 3], [8, 3, 7], [8, 7, 7], [8, 7, 3], [1, 0, 0]);
  quad([8, 3, 3], [10, 3, 3], [10, 3, 7], [8, 3, 7], [0, 1, 0]);
  quad([8, 7, 3], [8, 7, 7], [10, 7, 7], [10, 7, 3], [0, -1, 0]);
  quad([8, 3, 3], [8, 7, 3], [10, 7, 3], [10, 3, 3], [0, 0, 1]);
  quad([8, 3, 7], [10, 3, 7], [10, 7, 7], [8, 7, 7], [0, 0, -1]);

  const positions: number[] = [];
  const indices: number[] = [];
  for (const triangle of faces) {
    const base = positions.length / 3;
    for (const point of triangle) positions.push(...point);
    indices.push(base, base + 1, base + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.updateMatrixWorld(true);
  return mesh;
}

function castAt(mesh: THREE.Mesh, origin: Point, direction: Point, planes: ClipPlane[]) {
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(...origin),
    new THREE.Vector3(...direction).normalize(),
  );
  return firstUnclippedHit(raycaster.intersectObject(mesh, false), planes);
}

// Keeps x <= 9, so the block loses the material in front of the cut.
const section: ClipPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(9, 0, 0),
);

describe('picking through a section', () => {
  it('hits the front face of an uncut body', () => {
    const hit = castAt(pocketedBlock(), [20, 1, 5], [-1, 0, 0], []);
    expect(hit?.point.toArray()).toEqual([10, 1, 5]);
  });

  it('ignores the front face the section removed', () => {
    expect(castAt(pocketedBlock(), [20, 1, 5], [-1, 0, 0], [section])).toBeUndefined();
  });

  it('reaches a cavity wall the section exposes', () => {
    const hit = castAt(pocketedBlock(), [20, 5, 5], [-1, 0, 0], [section]);
    expect(hit?.point.toArray()).toEqual([8, 5, 5]);
  });
});
