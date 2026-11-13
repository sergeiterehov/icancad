import { describe, expect, it } from 'vitest';
import type { SketchFeature } from '@icancad/model';
import {
  bodyEdgeAxisRef,
  resolveRevolveAxis,
  revolveAngles,
  straightPolylineAxis,
} from '../src/sketch/revolveAxis';
import { edgedCube } from './edgedCube';

function sketch(entities: SketchFeature['entities']): SketchFeature {
  return {
    id: 'sketch',
    name: 'Sketch',
    suppressed: false,
    type: 'sketch',
    plane: { type: 'datum', plane: 'XY', offset: 0 },
    entities,
    constraints: [],
    references: [],
  };
}

const meshes = { body: edgedCube(20) };

describe('revolve axis', () => {
  it('resolves a world axis through the origin', () => {
    expect(resolveRevolveAxis({ kind: 'world', axis: 'y' }, { meshes, sketches: [] })).toEqual({
      origin: [0, 0, 0],
      direction: [0, 1, 0],
      attached: true,
    });
  });

  it('reads a straight body edge from the current mesh', () => {
    const edge = meshes.body.edges![0]!;
    const resolved = resolveRevolveAxis(
      { kind: 'body-edge', bodyId: 'body', edgeId: edge.id, start: [0, 0, 0], end: [1, 0, 0] },
      { meshes, sketches: [] },
    );
    expect(resolved?.attached).toBe(true);
    expect(resolved?.origin).toEqual([edge.points[0], edge.points[1], edge.points[2]]);
    expect(
      Math.abs(
        resolved!.direction[0] * (edge.points[3]! - edge.points[0]!) +
          resolved!.direction[1] * (edge.points[4]! - edge.points[1]!) +
          resolved!.direction[2] * (edge.points[5]! - edge.points[2]!),
      ),
    ).toBeCloseTo(20, 5);
  });

  it('keeps the picked pose when the edge is gone', () => {
    const resolved = resolveRevolveAxis(
      {
        kind: 'body-edge',
        bodyId: 'body',
        edgeId: 'missing',
        start: [1, 2, 3],
        end: [1, 12, 3],
      },
      { meshes, sketches: [] },
    );
    expect(resolved).toEqual({ origin: [1, 2, 3], direction: [0, 1, 0], attached: false });
  });

  it('falls back to the picked pose when the edge has become curved', () => {
    const curved = {
      ...edgedCube(20),
      edges: [
        {
          id: 'curved',
          faceIds: [0, 1],
          points: [0, 0, 0, 5, 2, 0, 10, 0, 0],
          closed: false,
        },
      ],
    };
    expect(straightPolylineAxis(curved.edges[0]!.points)).toBeNull();
    const resolved = resolveRevolveAxis(
      { kind: 'body-edge', bodyId: 'body', edgeId: 'curved', start: [0, 0, 0], end: [10, 0, 0] },
      { meshes: { body: curved }, sketches: [] },
    );
    expect(resolved).toEqual({ origin: [0, 0, 0], direction: [1, 0, 0], attached: false });
  });

  it('turns a sketch line into a world axis', () => {
    const feature = sketch([
      { id: 'line', type: 'line', construction: false, x1: 10, y1: 0, x2: 10, y2: 5 },
    ]);
    const resolved = resolveRevolveAxis(
      { kind: 'sketch-edge', sketchId: 'sketch', entityId: 'line' },
      { meshes: {}, sketches: [feature] },
    );
    expect(resolved).toEqual({ origin: [10, 0, 0], direction: [0, 1, 0], attached: true });
  });

  it('rejects a sketch curve that is not a line', () => {
    const feature = sketch([
      { id: 'circle', type: 'circle', construction: false, cx: 0, cy: 0, r: 5 },
    ]);
    expect(
      resolveRevolveAxis(
        { kind: 'sketch-edge', sketchId: 'sketch', entityId: 'circle' },
        { meshes: {}, sketches: [feature] },
      ),
    ).toBeNull();
    expect(
      resolveRevolveAxis(
        { kind: 'sketch-edge', sketchId: 'missing', entityId: 'line' },
        { meshes: {}, sketches: [feature] },
      ),
    ).toBeNull();
  });

  it('builds a body edge ref only for a straight edge', () => {
    const edge = meshes.body.edges![0]!;
    expect(bodyEdgeAxisRef(meshes.body, 'body', edge.id)).toEqual({
      kind: 'body-edge',
      bodyId: 'body',
      edgeId: edge.id,
      start: [edge.points[0], edge.points[1], edge.points[2]],
      end: [edge.points[3], edge.points[4], edge.points[5]],
    });
    const curved = {
      ...meshes.body,
      edges: [
        { id: 'curved', faceIds: [0, 1], points: [0, 0, 0, 5, 2, 0, 10, 0, 0], closed: false },
      ],
    };
    expect(bodyEdgeAxisRef(curved, 'body', 'curved')).toBeNull();
  });

  it('mirrors both angles when the sweep is inverted', () => {
    expect(
      revolveAngles({ axis: { kind: 'world', axis: 'z' }, start: 30, end: 120, inverted: true }),
    ).toEqual({ start: -30, end: -120 });
    expect(
      revolveAngles({ axis: { kind: 'world', axis: 'z' }, start: 30, end: 120, inverted: false }),
    ).toEqual({ start: 30, end: 120 });
  });
});
