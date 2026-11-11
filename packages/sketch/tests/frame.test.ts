import { describe, expect, it } from 'vitest';
import { datumFrame, faceFrame } from '../src/frame';

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
