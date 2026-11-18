import { describe, expect, it } from 'vitest';
import { datumFrame, faceFrame, rotateFrame, rotateVector } from '../src/frame';

function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
}

function expectClose(actual: readonly number[], expected: readonly number[]): void {
  for (let index = 0; index < 3; index += 1) {
    expect(actual[index]!).toBeCloseTo(expected[index]!, 6);
  }
}

describe('datum frames', () => {
  it.each(['XY', 'XZ', 'YZ'] as const)('keeps %s right-handed', (plane) => {
    const frame = datumFrame(plane, 7);
    expect(cross(frame.xAxis, frame.yAxis)).toEqual(frame.normal);
    expect(frame.origin).toEqual([
      plane === 'YZ' ? 7 : 0,
      plane === 'XZ' ? 7 : 0,
      plane === 'XY' ? 7 : 0,
    ]);
  });
});

describe('face frames', () => {
  it.each([
    [0, 0, 1],
    [0, 0, -1],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0.5, 0.5, 0.7071067811865476],
  ] as const)('builds a right-handed frame for normal %j', (...normal) => {
    const frame = faceFrame([1, 2, 3], normal);
    expectClose(cross(frame.xAxis, frame.yAxis), frame.normal);
    expect(frame.origin).toEqual([1, 2, 3]);
    expect(Math.hypot(...frame.xAxis)).toBeCloseTo(1, 6);
    expect(Math.hypot(...frame.yAxis)).toBeCloseTo(1, 6);
  });

  it('keeps the world X axis on a plane facing Z', () => {
    const frame = faceFrame([0, 0, 10], [0, 0, 1]);
    expect(frame.xAxis).toEqual([1, 0, 0]);
    expect(frame.yAxis[2]).toBeCloseTo(0, 6);
  });
});

describe('rotated frames', () => {
  const base = datumFrame('XY', 5);

  it('keeps the frame when every angle is zero', () => {
    expect(rotateFrame(base, [0, 0, 0])).toBe(base);
  });

  it('turns around the origin and stays right-handed', () => {
    const frame = rotateFrame(base, [30, -20, 45]);
    expect(frame.origin).toEqual([0, 0, 5]);
    expectClose(cross(frame.xAxis, frame.yAxis), frame.normal);
    expect(Math.hypot(...frame.xAxis)).toBeCloseTo(1, 6);
    expect(Math.hypot(...frame.yAxis)).toBeCloseTo(1, 6);
  });

  it('tilts the plane around X and spins it around Z', () => {
    const tilted = rotateFrame(base, [90, 0, 0]);
    expectClose(tilted.xAxis, [1, 0, 0]);
    expectClose(tilted.yAxis, [0, 0, 1]);
    expectClose(tilted.normal, [0, -1, 0]);

    const spun = rotateFrame(base, [0, 0, 90]);
    expectClose(spun.xAxis, [0, 1, 0]);
    expectClose(spun.yAxis, [-1, 0, 0]);
    expectClose(spun.normal, [0, 0, 1]);
  });

  it('applies the angles as intrinsic turns X, then Y, then Z', () => {
    // Rx(90) · Ry(90): the frame leans so its X axis points along world Y.
    const frame = rotateFrame(base, [90, 90, 0]);
    expectClose(frame.xAxis, [0, 1, 0]);
    expectClose(frame.yAxis, [0, 0, 1]);
    expectClose(frame.normal, [1, 0, 0]);
  });

  it('turns a vector around an axis by a right-handed angle', () => {
    const quarter = rotateVector([1, 0, 0], [0, 0, 1], Math.PI / 2);
    expectClose(quarter, [0, 1, 0]);
    expect(Math.hypot(...rotateVector([3, 4, 5], [0, 0, 1], 0.7))).toBeCloseTo(
      Math.hypot(3, 4, 5),
      6,
    );
  });
});
