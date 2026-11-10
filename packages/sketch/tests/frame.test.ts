import { describe, expect, it } from 'vitest';
import { datumFrame } from '../src/frame';

function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
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
