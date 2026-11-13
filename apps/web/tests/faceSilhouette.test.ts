import type { TessellationResult } from '@icancad/kernel';
import { describe, expect, it } from 'vitest';
import { faceSilhouettes } from '../src/sketch/silhouette';

/** A tube around the Z axis, meshed the way the kernel meshes a face. */
function tube(radius: number, height: number, segments: number, rows = 4): TessellationResult {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const faceIds: number[] = [];
  const at = (segment: number, row: number): number => {
    const angle = (segment / segments) * Math.PI * 2;
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, (row / rows) * height);
    normals.push(Math.cos(angle), Math.sin(angle), 0);
    return positions.length / 3 - 1;
  };
  for (let row = 0; row < rows; row += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a = at(segment, row);
      const b = at(segment + 1, row);
      const c = at(segment + 1, row + 1);
      const d = at(segment, row + 1);
      indices.push(a, b, c, a, c, d);
      faceIds.push(0, 0);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    faceIds: new Uint32Array(faceIds),
    triangleCount: faceIds.length,
    vertexCount: positions.length / 3,
    bbox: { min: [-radius, -radius, 0], max: [radius, radius, height] },
  };
}

describe('face silhouettes', () => {
  it('finds the two sides of a tube seen from the front', () => {
    const curves = faceSilhouettes(tube(5, 10, 16), 0, [0, 1, 0]);
    expect(curves).toHaveLength(2);
    const spans = curves.map((curve) => {
      const xs = curve.points.map((point) => point[0]);
      const zs = curve.points.map((point) => point[2]);
      return {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        z: [Math.min(...zs), Math.max(...zs)],
      };
    });
    expect(spans.map((span) => Math.round(span.x)).sort()).toEqual([-5, 5]);
    for (const span of spans) {
      expect(span.z[0]).toBeCloseTo(0, 6);
      expect(span.z[1]).toBeCloseTo(10, 6);
    }
  });

  it('has no silhouette for a face seen edge-on', () => {
    // Looking down the tube's own axis: every normal is perpendicular to the
    // view, which is noise rather than an outline.
    expect(faceSilhouettes(tube(5, 10, 16), 0, [0, 0, 1])).toHaveLength(0);
  });

  it('ignores edges that belong to another face', () => {
    expect(faceSilhouettes(tube(5, 10, 16), 7, [0, 1, 0])).toHaveLength(0);
  });
});
