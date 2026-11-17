import { describe, expect, it } from 'vitest';
import type { BodyEdge, TessellationResult } from '@icancad/kernel';
import type { BodyEdgeRef } from '@icancad/model';
import { resolveEdgeRef } from '../src/kernel/edgeLookup';

const BODY = 'body_1';
const SHAPE = 'shape_1';
const EDGE = '17';

function meshWith(edges: BodyEdge[]): TessellationResult {
  return {
    positions: new Float32Array(),
    normals: new Float32Array(),
    indices: new Uint32Array(),
    faceIds: new Uint32Array(),
    triangleCount: 0,
    vertexCount: 0,
    bbox: { min: [0, 0, 0], max: [0, 0, 0] },
    edges,
  };
}

/** A rim of the given radius, centred at `center`, as a closed polyline. */
function circleEdge(center: [number, number, number], radius: number, id = EDGE): BodyEdge {
  const points: number[] = [];
  const segments = 16;
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    points.push(
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius,
      center[2],
    );
  }
  return { id, faceIds: [5, 8], points, closed: true };
}

/** An open arc around `center`, as a polyline with a vertex at its middle. */
function arcEdge(
  center: [number, number, number],
  radius: number,
  span: number,
  id: string,
): BodyEdge {
  const points: number[] = [];
  const segments = 8;
  for (let index = 0; index <= segments; index += 1) {
    const angle = -span / 2 + (index / segments) * span;
    points.push(center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius, center[2]);
  }
  return { id, faceIds: [12, 24], points, closed: false };
}

function refOf(edge: BodyEdge): BodyEdgeRef {
  const [start, mid, end] = [
    [edge.points[0]!, edge.points[1]!, edge.points[2]!],
    [edge.points[3]!, edge.points[4]!, edge.points[5]!],
    [edge.points[edge.points.length - 3]!, edge.points[edge.points.length - 2]!, edge.points[edge.points.length - 1]!],
  ] as [number, number, number][];
  let length = 0;
  for (let index = 0; index + 5 < edge.points.length; index += 3) {
    length += Math.hypot(
      edge.points[index + 3]! - edge.points[index]!,
      edge.points[index + 4]! - edge.points[index + 1]!,
      edge.points[index + 5]! - edge.points[index + 2]!,
    );
  }
  return {
    bodyId: BODY,
    edgeId: edge.id,
    faceIds: [...edge.faceIds],
    start: start!,
    mid: mid!,
    end: end!,
    length,
    closed: edge.closed,
    bisector: [0, 0, 1],
  };
}

function contextFor(edge: BodyEdge) {
  return {
    bodyShapes: new Map([[BODY, SHAPE]]),
    meshes: { [BODY]: meshWith([edge]) },
  };
}

describe('resolveEdgeRef', () => {
  it('follows an edge whose geometry only moved', () => {
    const ref = refOf(circleEdge([10, 0, 0], 2));
    const moved = circleEdge([12, 0, 0], 2);

    // The pose is gone, so only the stable id and the length can say it is the
    // same rim after the sketch circle was dragged sideways.
    expect(resolveEdgeRef(contextFor(moved), ref)).toEqual({ bodyId: BODY, edgeId: EDGE });
  });

  it('follows a round edge when only its radius changed', () => {
    const ref = refOf(circleEdge([10, 0, 0], 2));
    const bigger = circleEdge([10, 0, 0], 5, '99');

    // The rim keeps its centre while the hole grows, so the reference is still
    // the same rim even though its id and length changed.
    expect(resolveEdgeRef(contextFor(bigger), ref)).toEqual({ bodyId: BODY, edgeId: '99' });
  });

  it('follows an arc whose ends moved while its middle stayed', () => {
    const ref = refOf(arcEdge([0, 10, 0], 5, 1.2, '17'));
    ref.mid = [5, 10, 0];
    const shorter = arcEdge([0, 10, 0], 5, 0.6, '99');

    expect(resolveEdgeRef(contextFor(shorter), ref)).toEqual({ bodyId: BODY, edgeId: '99' });
  });

  it('does not follow an edge that was reshaped', () => {
    const ref = refOf(circleEdge([10, 0, 0], 2));
    const widened = circleEdge([20, 0, 0], 5);

    expect(resolveEdgeRef(contextFor(widened), ref)).toBeNull();
  });
});
