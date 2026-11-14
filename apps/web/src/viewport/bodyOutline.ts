import type { BodyEdge } from '@icancad/kernel';

/** Faces that meet at a sharper angle than this are drawn as a crease. */
export const OUTLINE_CREASE_RADIANS = (20 * Math.PI) / 180;

export interface BodyOutline {
  /** Edges whose faces meet at a crease. */
  sharp: Float32Array;
  /** Edges where a fillet blends into a face, drawn faintly. */
  tangent: Float32Array;
}

/**
 * Line segments along the edges of a body. A tessellated face says nothing
 * about the edge it smooths over, so lines derived from its triangles drop
 * stray creases across every radius; the B-rep edges are exact instead.
 */
export function outlineSegments(edges: readonly BodyEdge[]): BodyOutline {
  const sharp: number[] = [];
  const tangent: number[] = [];
  for (const edge of edges) {
    const smooth = edge.wedge !== undefined && Math.PI - edge.wedge < OUTLINE_CREASE_RADIANS;
    const positions = smooth ? tangent : sharp;
    const points = edge.points;
    for (let index = 3; index + 2 < points.length; index += 3) {
      positions.push(
        points[index - 3]!,
        points[index - 2]!,
        points[index - 1]!,
        points[index]!,
        points[index + 1]!,
        points[index + 2]!,
      );
    }
  }
  return { sharp: new Float32Array(sharp), tangent: new Float32Array(tangent) };
}
