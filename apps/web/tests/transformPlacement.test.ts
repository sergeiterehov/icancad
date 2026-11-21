import type { SketchEntity, SketchFrame, Vec3 } from '@icancad/model';
import { sketchPointToWorld } from '@icancad/sketch';
import { describe, expect, it } from 'vitest';
import {
  boundsCentre,
  scaleSketchEntity,
  sketchBounds,
  transformMatrix,
  transformPivot,
  transformPoint,
  transformRotation,
  transformSketchGeometry,
  type TargetBounds,
} from '../src/kernel/transformPlacement';

interface Placement {
  translation: [number, number, number];
  rotation: [number, number, number];
  scale: number;
}

const still: Placement = { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };

function placed(patch: Partial<Placement> = {}): Placement {
  return { ...still, ...patch };
}

function near(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 9));
}

const XY: SketchFrame = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
};

describe('transform placement', () => {
  it('leaves points where they are when nothing is set', () => {
    near(transformPoint(transformMatrix(still, [0, 0, 0]), [3, -4, 5]), [3, -4, 5]);
  });

  it('moves by the translation', () => {
    const matrix = transformMatrix(placed({ translation: [10, -2, 0.5] }), [0, 0, 0]);
    near(transformPoint(matrix, [1, 1, 1]), [11, -1, 1.5]);
  });

  it('moves along the turned axes', () => {
    // The offset is authored in the object's frame: a turn about Z sends the
    // position X of 10 into world Y.
    const matrix = transformMatrix(
      placed({ rotation: [0, 0, 90], translation: [10, 0, 0] }),
      [0, 0, 0],
    );
    near(transformPoint(matrix, [0, 0, 0]), [0, 10, 0]);
    near(transformPoint(matrix, [1, 0, 0]), [0, 11, 0]);
  });

  it('turns a quarter around Z', () => {
    const matrix = transformMatrix(placed({ rotation: [0, 0, 90] }), [0, 0, 0]);
    near(transformPoint(matrix, [1, 0, 0]), [0, 1, 0]);
  });

  it('meets Z first and X last, like the sketch plane rotation', () => {
    // The angles are intrinsic: Z turns the vector first, then Y, then X. With
    // X and Y at 90, +Z ends on +X and +X ends on +Y.
    const matrix = transformMatrix(placed({ rotation: [90, 90, 0] }), [0, 0, 0]);
    near(transformPoint(matrix, [0, 0, 1]), [1, 0, 0]);
    near(transformPoint(matrix, [1, 0, 0]), [0, 1, 0]);
  });

  it('keeps the pivot in place while scaling', () => {
    const matrix = transformMatrix(placed({ scale: 2 }), [10, 0, 0]);
    near(transformPoint(matrix, [10, 0, 0]), [10, 0, 0]);
    near(transformPoint(matrix, [20, 0, 0]), [30, 0, 0]);
  });

  it('keeps the pivot in place while turning', () => {
    const matrix = transformMatrix(placed({ rotation: [0, 0, 90] }), [5, 5, 0]);
    near(transformPoint(matrix, [5, 5, 0]), [5, 5, 0]);
    near(transformPoint(matrix, [6, 5, 0]), [5, 6, 0]);
  });

  it('takes the centre of everything the operation moves', () => {
    const bounds: TargetBounds[] = [
      { min: [0, 0, 0], max: [10, 10, 10] },
      { min: [20, 0, 0], max: [100, 10, 10] },
    ];
    near(transformPivot(bounds)!.origin, [50, 5, 5]);
    near(boundsCentre(bounds)!, [50, 5, 5]);
    expect(transformPivot(bounds)!.radius).toBeCloseTo(Math.hypot(100, 10, 10) / 2, 9);
    expect(transformPivot([])).toBeNull();
  });

  it('measures a sketch by its geometry in the world', () => {
    const line: SketchEntity = {
      id: 'l',
      type: 'line',
      construction: false,
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 5,
    };
    const bounds = sketchBounds(XY, [line])!;
    near(bounds.min, [0, 0, 0]);
    near(bounds.max, [10, 5, 0]);
    expect(sketchBounds(XY, [])).toBeNull();
  });

  it('scales every kind of geometry about the sketch origin', () => {
    const entities: SketchEntity[] = [
      { id: 'p', type: 'point', construction: false, x: 2, y: -3 },
      { id: 'l', type: 'line', construction: false, x1: 1, y1: 2, x2: 3, y2: 4 },
      { id: 'c', type: 'circle', construction: false, cx: 5, cy: 5, r: 2 },
      { id: 'a', type: 'arc', construction: false, cx: 1, cy: 1, r: 2, startAngle: 0, endAngle: 1 },
      { id: 'e', type: 'ellipse', construction: false, cx: 1, cy: 1, rx: 2, ry: 3, rotation: 45 },
      {
        id: 'b',
        type: 'bezier',
        construction: false,
        points: [
          [1, 1],
          [2, 4],
        ],
      },
    ];
    const scaled = entities.map((entity) => scaleSketchEntity(entity, 2));
    expect(scaled[0]).toMatchObject({ x: 4, y: -6 });
    expect(scaled[1]).toMatchObject({ x1: 2, y1: 4, x2: 6, y2: 8 });
    expect(scaled[2]).toMatchObject({ cx: 10, cy: 10, r: 4 });
    expect(scaled[3]).toMatchObject({ cx: 2, cy: 2, r: 4, startAngle: 0, endAngle: 1 });
    expect(scaled[4]).toMatchObject({ cx: 2, cy: 2, rx: 4, ry: 6, rotation: 45 });
    expect(scaled[5]).toMatchObject({
      points: [
        [2, 2],
        [4, 8],
      ],
    });
  });

  it('turns a sketch into exactly the affine of every point it holds', () => {
    // A plane that is not a datum, so the origin offsets of the frame are part
    // of what the transform has to move.
    const frame: SketchFrame = {
      origin: [1, 2, 3],
      xAxis: [0, 1, 0],
      yAxis: [0, 0, 1],
      normal: [1, 0, 0],
    };
    const transform = placed({ translation: [3, -4, 5], rotation: [10, 20, 30], scale: 1.5 });
    const pivot: Vec3 = [4, 5, 6];
    const matrix = transformMatrix(transform, pivot);
    const rotation = transformRotation(transform.rotation);
    const line: SketchEntity = {
      id: 'l',
      type: 'line',
      construction: false,
      x1: 5,
      y1: 0,
      x2: 15,
      y2: 7,
    };
    const result = transformSketchGeometry(frame, [line], transform.scale, rotation, matrix);
    const moved = result.entities[0] as Extract<SketchEntity, { type: 'line' }>;
    const pairs: Array<[[number, number], [number, number]]> = [
      [
        [5, 0],
        [moved.x1, moved.y1],
      ],
      [
        [15, 7],
        [moved.x2, moved.y2],
      ],
    ];
    for (const [before, after] of pairs) {
      const world = sketchPointToWorld(frame, before);
      near(sketchPointToWorld(result.frame, after), transformPoint(matrix, world));
    }
    // The plane keeps a right-handed orthonormal basis.
    const [x, y, n] = [result.frame.xAxis, result.frame.yAxis, result.frame.normal];
    expect(Math.hypot(...x)).toBeCloseTo(1, 9);
    expect(Math.hypot(...y)).toBeCloseTo(1, 9);
    expect(Math.hypot(...n)).toBeCloseTo(1, 9);
    expect(x[0] * n[0] + x[1] * n[1] + x[2] * n[2]).toBeCloseTo(0, 9);
  });
});
