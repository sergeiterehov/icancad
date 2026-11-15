import { describe, expect, it } from 'vitest';
import { facesPlane, sketchTurnMode, SKETCH_FACING_DEGREES } from '../src/viewport/sketchView';

/** The angles `alignSketch` gives a camera that looks along this normal. */
function aligned(normal: [number, number, number]): { azimuth: number; polar: number } {
  const length = Math.hypot(...normal);
  return {
    azimuth: Math.atan2(normal[1] / length, normal[0] / length),
    polar: Math.acos(normal[2] / length),
  };
}

describe('a camera facing a sketch plane', () => {
  it('faces the plane it was aligned to, whichever way the plane stands', () => {
    const normals: Array<[number, number, number]> = [
      [0, 0, 1],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, -1],
      [1, 1, 1],
    ];
    for (const normal of normals) {
      const view = aligned(normal);
      expect(facesPlane(view.azimuth, view.polar, normal)).toBe(true);
    }
  });

  it('keeps facing through a tilt smaller than the tolerance', () => {
    const tilt = ((SKETCH_FACING_DEGREES - 0.5) * Math.PI) / 180;
    expect(facesPlane(0, tilt, [0, 0, 1])).toBe(true);
  });

  it('stops facing once the view is turned off the plane', () => {
    const tilt = ((SKETCH_FACING_DEGREES + 1) * Math.PI) / 180;
    expect(facesPlane(0, tilt, [0, 0, 1])).toBe(false);
    // A quarter turn is the side view of the sketch.
    expect(facesPlane(0, Math.PI / 2, [0, 0, 1])).toBe(false);
    // The nav cube takes the view to an isometric pose, which is off the plane.
    expect(facesPlane(-Math.PI / 4, Math.PI / 3, [0, 0, 1])).toBe(false);
  });

  it('never faces a plane without a normal', () => {
    expect(facesPlane(0, 0, [0, 0, 0])).toBe(false);
  });
});

describe('a turn of the camera in a sketch', () => {
  it('pans while the view faces the plane', () => {
    expect(sketchTurnMode(true)).toBe('pan');
  });

  it('turns once the view is off the plane', () => {
    expect(sketchTurnMode(false)).toBe('orbit');
  });
});
