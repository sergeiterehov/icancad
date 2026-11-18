import { describe, expect, it } from 'vitest';
import {
  facesPlane,
  sketchTurnMode,
  sketchViewRoll,
  SKETCH_FACING_DEGREES,
} from '../src/viewport/sketchView';

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

describe('the roll of an aligned sketch view', () => {
  /** The turntable up of a view, before the roll is applied. */
  function baseUp(azimuth: number, polar: number): [number, number, number] {
    const eye: [number, number, number] = [
      Math.sin(polar) * Math.cos(azimuth),
      Math.sin(polar) * Math.sin(azimuth),
      Math.cos(polar),
    ];
    const upHint: [number, number, number] =
      Math.abs(Math.cos(polar)) > 0.999 ? [0, 1, 0] : [0, 0, 1];
    const right: [number, number, number] = [
      upHint[1] * eye[2] - upHint[2] * eye[1],
      upHint[2] * eye[0] - upHint[0] * eye[2],
      upHint[0] * eye[1] - upHint[1] * eye[0],
    ];
    const up: [number, number, number] = [
      eye[1] * right[2] - eye[2] * right[1],
      eye[2] * right[0] - eye[0] * right[2],
      eye[0] * right[1] - eye[1] * right[0],
    ];
    const length = Math.hypot(...up) || 1;
    return [up[0] / length, up[1] / length, up[2] / length];
  }

  /** Rotates a vector around a unit axis by a right-handed angle. */
  function turn(
    vector: [number, number, number],
    axis: [number, number, number],
    angle: number,
  ): [number, number, number] {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const along = vector[0] * axis[0] + vector[1] * axis[1] + vector[2] * axis[2];
    const cross: [number, number, number] = [
      axis[1] * vector[2] - axis[2] * vector[1],
      axis[2] * vector[0] - axis[0] * vector[2],
      axis[0] * vector[1] - axis[1] * vector[0],
    ];
    return [
      vector[0] * cos + cross[0] * sin + axis[0] * along * (1 - cos),
      vector[1] * cos + cross[1] * sin + axis[1] * along * (1 - cos),
      vector[2] * cos + cross[2] * sin + axis[2] * along * (1 - cos),
    ];
  }

  it('leaves an untouched XY sketch level', () => {
    const view = aligned([0, 0, 1]);
    expect(sketchViewRoll(view.azimuth, view.polar, [0, 1, 0])).toBeCloseTo(0, 6);
  });

  it('turns the view so the sketch Y axis points up', () => {
    const view = aligned([0, 0, 1]);
    const yAxis: [number, number, number] = [-1, 0, 0];
    const roll = sketchViewRoll(view.azimuth, view.polar, yAxis);
    expect(roll).toBeCloseTo(Math.PI / 2, 6);
    const eye: [number, number, number] = [
      Math.sin(view.polar) * Math.cos(view.azimuth),
      Math.sin(view.polar) * Math.sin(view.azimuth),
      Math.cos(view.polar),
    ];
    const up = turn(baseUp(view.azimuth, view.polar), eye, roll);
    for (let index = 0; index < 3; index += 1) {
      expect(up[index]!).toBeCloseTo(yAxis[index]!, 6);
    }
  });

  it('follows a tilted plane as well', () => {
    const normal: [number, number, number] = [1, 1, 1];
    const view = aligned(normal);
    // A Y axis perpendicular to the normal, as the sketch frame provides.
    const yAxis: [number, number, number] = [-1, 1, 0];
    const roll = sketchViewRoll(view.azimuth, view.polar, yAxis);
    const eye: [number, number, number] = [
      Math.sin(view.polar) * Math.cos(view.azimuth),
      Math.sin(view.polar) * Math.sin(view.azimuth),
      Math.cos(view.polar),
    ];
    const up = turn(baseUp(view.azimuth, view.polar), eye, roll);
    for (let index = 0; index < 3; index += 1) {
      expect(up[index]!).toBeCloseTo(yAxis[index]! / Math.hypot(...yAxis), 6);
    }
  });
});
