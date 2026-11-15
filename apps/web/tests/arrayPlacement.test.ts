import { describe, expect, it } from 'vitest';
import type { ArrayDirection, SketchFeature, SketchFrame, Vec3 } from '@icancad/model';
import {
  chainPolyline,
  directionMatrices,
  MAX_ARRAY_COPIES,
  type ArrayPlacementContext,
} from '../src/kernel/arrayPlacement';

const frame: SketchFrame = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
};

function sketchWith(lines: [number, number, number, number][]): SketchFeature {
  return {
    id: 'feat_sketch',
    name: 'Sketch',
    suppressed: false,
    type: 'sketch',
    plane: { type: 'datum', plane: 'XY', offset: 0 },
    entities: lines.map(([x1, y1, x2, y2], index) => ({
      id: `line_${index}`,
      type: 'line' as const,
      construction: false,
      x1,
      y1,
      x2,
      y2,
    })),
    constraints: [],
    references: [],
  };
}

function pathOf(index: number) {
  return { kind: 'sketch-edge' as const, sketchId: 'feat_sketch', entityId: `line_${index}` };
}

function context(sketch: SketchFeature): ArrayPlacementContext {
  return { meshes: {}, sketches: [sketch], frames: { [sketch.id]: frame } };
}

/** Where a placement puts the point given, as a rounded triple. */
function move(matrix: readonly number[], point: Vec3): Vec3 {
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return [
    round(matrix[0]! * point[0] + matrix[1]! * point[1] + matrix[2]! * point[2] + matrix[3]!),
    round(matrix[4]! * point[0] + matrix[5]! * point[1] + matrix[6]! * point[2] + matrix[7]!),
    round(matrix[8]! * point[0] + matrix[9]! * point[1] + matrix[10]! * point[2] + matrix[11]!),
  ];
}

describe('array placements', () => {
  it('spreads a rotation over the whole angle it stores', () => {
    const direction: ArrayDirection = {
      kind: 'rotation',
      axis: { kind: 'world', axis: 'z' },
      angle: 90,
      count: 3,
    };
    const matrices = directionMatrices(direction, { meshes: {}, sketches: [] });
    expect(matrices).toHaveLength(3);
    expect(move(matrices[0]!, [10, 0, 0])).toEqual([10, 0, 0]);
    expect(move(matrices[1]!, [10, 0, 0])).toEqual([7.071, 7.071, 0]);
    expect(move(matrices[2]!, [10, 0, 0])).toEqual([0, 10, 0]);
  });

  it('divides a full turn by the count, so two copies sit opposite', () => {
    const direction: ArrayDirection = {
      kind: 'rotation',
      axis: { kind: 'world', axis: 'z' },
      angle: 360,
      count: 2,
    };
    const matrices = directionMatrices(direction, { meshes: {}, sketches: [] });
    expect(matrices).toHaveLength(2);
    expect(move(matrices[0]!, [10, 0, 0])).toEqual([10, 0, 0]);
    // 360° over two copies is half a circle apart, not a copy on top of itself.
    expect(move(matrices[1]!, [10, 0, 0])).toEqual([-10, 0, 0]);
  });

  it('spreads three copies of a full turn a third apart', () => {
    const direction: ArrayDirection = {
      kind: 'rotation',
      axis: { kind: 'world', axis: 'z' },
      angle: 360,
      count: 3,
    };
    const matrices = directionMatrices(direction, { meshes: {}, sketches: [] });
    expect(move(matrices[1]!, [10, 0, 0])).toEqual([-5, 8.66, 0]);
    expect(move(matrices[2]!, [10, 0, 0])).toEqual([-5, -8.66, 0]);
  });

  it('turns around a world axis through the centre of the model', () => {
    const direction: ArrayDirection = {
      kind: 'rotation',
      axis: { kind: 'world', axis: 'z' },
      angle: 90,
      count: 2,
    };
    const matrices = directionMatrices(direction, { meshes: {}, sketches: [] });
    // The copies swing around the world centre, wherever they are: a point
    // 10 mm out lands a quarter turn further on.
    expect(move(matrices[0]!, [10, 0, 0])).toEqual([10, 0, 0]);
    expect(move(matrices[1]!, [10, 0, 0])).toEqual([0, 10, 0]);
  });

  it('turns around the centre of a picked arc, in its own plane', () => {
    const sketch: SketchFeature = {
      ...sketchWith([]),
      entities: [{ id: 'arc_0', type: 'circle', construction: false, cx: 5, cy: 0, r: 2 }],
    };
    const direction: ArrayDirection = {
      kind: 'rotation',
      axis: { kind: 'arc', sketchId: sketch.id, entityId: 'arc_0' },
      angle: 180,
      count: 2,
    };
    const matrices = directionMatrices(direction, context(sketch));
    // The centre of the circle is the centre of the turn.
    expect(move(matrices[1]!, [5, 0, 0])).toEqual([5, 0, 0]);
    expect(move(matrices[1]!, [15, 0, 0])).toEqual([-5, 0, 0]);
  });

  it('turns the other way round when the direction is inverted', () => {
    const direction: ArrayDirection = {
      kind: 'rotation',
      axis: { kind: 'world', axis: 'z' },
      angle: 90,
      inverted: true,
      count: 2,
    };
    const matrices = directionMatrices(direction, { meshes: {}, sketches: [] });
    // The same quarter turn, the other way round: down instead of up.
    expect(move(matrices[1]!, [20, 0, 0])).toEqual([0, -20, 0]);
  });

  it('tilts a straight direction, so rows can meet at an angle', () => {
    const direction: ArrayDirection = {
      kind: 'linear',
      direction: [0, 1, 0],
      spacing: 10,
      angle: 30,
      count: 2,
    };
    const matrices = directionMatrices(direction, { meshes: {}, sketches: [] });
    // A horizontal row lies in the horizontal plane, so Y at 30° leans towards
    // −X: the second copy sits up and to the left of the seed.
    expect(move(matrices[0]!, [0, 0, 0])).toEqual([0, 0, 0]);
    expect(move(matrices[1]!, [0, 0, 0])).toEqual([-5, 8.66, 0]);
  });

  it('joins the curves of a path end to end, in any order', () => {
    const sketch = sketchWith([
      [10, 0, 10, 10],
      [0, 0, 10, 0],
    ]);
    const chain = chainPolyline([pathOf(0), pathOf(1)], context(sketch));
    expect(chain).not.toBeNull();
    expect(chain!.points[0]).toEqual([0, 0, 0]);
    expect(chain!.points[chain!.points.length - 1]).toEqual([10, 10, 0]);
    expect(chain!.closed).toBe(false);
  });

  it('places the copies along the path', () => {
    const sketch = sketchWith([
      [0, 0, 10, 0],
      [10, 0, 10, 10],
    ]);
    const direction: ArrayDirection = {
      kind: 'path',
      paths: [pathOf(0), pathOf(1)],
      count: 3,
    };
    const matrices = directionMatrices(direction, context(sketch));
    const corner: Vec3 = [0, 0, 0];
    expect(move(matrices[0]!, corner)).toEqual([0, 0, 0]);
    expect(move(matrices[1]!, corner)).toEqual([10, 0, 0]);
    expect(move(matrices[2]!, corner)).toEqual([10, 10, 0]);
  });

  it('refuses a path whose curves do not meet', () => {
    const sketch = sketchWith([
      [0, 0, 10, 0],
      [30, 0, 40, 0],
    ]);
    expect(chainPolyline([pathOf(0), pathOf(1)], context(sketch))).toBeNull();
    expect(() =>
      directionMatrices({ kind: 'path', paths: [pathOf(0), pathOf(1)], count: 3 }, context(sketch)),
    ).toThrow('ARRAY_PATH_BROKEN');
  });

  it('follows an edge of a body', () => {
    const edge = { id: 'edge_0', faceIds: [0], points: [0, 0, 0, 0, 0, 20], closed: false };
    const mesh = {
      positions: new Float32Array(),
      normals: new Float32Array(),
      indices: new Uint32Array(),
      faceIds: new Uint32Array(),
      triangleCount: 0,
      vertexCount: 0,
      bbox: { min: [0, 0, 0] as Vec3, max: [0, 0, 0] as Vec3 },
      edges: [edge],
    };
    const matrices = directionMatrices(
      { kind: 'path', paths: [{ kind: 'body-edge', bodyId: 'body_1', edgeId: 'edge_0' }], count: 2 },
      { meshes: { body_1: mesh }, sketches: [] },
    );
    expect(move(matrices[1]!, [0, 0, 0])).toEqual([0, 0, 20]);
  });

  it('never makes more copies than the ceiling allows', () => {
    const direction: ArrayDirection = {
      kind: 'linear',
      direction: [1, 0, 0],
      spacing: 5,
      count: 5000,
    };
    expect(directionMatrices(direction, { meshes: {}, sketches: [] })).toHaveLength(
      MAX_ARRAY_COPIES,
    );
  });
});
