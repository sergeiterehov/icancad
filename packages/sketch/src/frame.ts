import type { SketchFrame, Vec3 } from '@icancad/model';
import type { Point2 } from './index';

export type DatumPlane = 'XY' | 'XZ' | 'YZ';

function unit(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

// A right-handed frame on a planar face. The sketch X axis follows the world X
// axis projected onto the plane (world Y for steep faces), so a face looks like
// the datum plane it is most parallel to.
export function faceFrame(origin: Vec3, normal: Vec3): SketchFrame {
  const n = unit(normal);
  const reference: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const along = reference[0] * n[0] + reference[1] * n[1] + reference[2] * n[2];
  const xAxis = unit([
    reference[0] - n[0] * along,
    reference[1] - n[1] * along,
    reference[2] - n[2] * along,
  ]);
  const yAxis: Vec3 = [
    n[1] * xAxis[2] - n[2] * xAxis[1],
    n[2] * xAxis[0] - n[0] * xAxis[2],
    n[0] * xAxis[1] - n[1] * xAxis[0],
  ];
  return {
    origin: [origin[0], origin[1], origin[2]],
    xAxis,
    yAxis,
    normal: n,
  };
}

export function datumFrame(plane: DatumPlane, offset = 0): SketchFrame {
  switch (plane) {
    case 'XY':
      return {
        origin: [0, 0, offset],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        normal: [0, 0, 1],
      };
    case 'XZ':
      // The normal is the cross product of the axes so extrusions along it match
      // the view the sketch is drawn from.
      return {
        origin: [0, offset, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 0, 1],
        normal: [0, -1, 0],
      };
    case 'YZ':
      return {
        origin: [offset, 0, 0],
        xAxis: [0, 1, 0],
        yAxis: [0, 0, 1],
        normal: [1, 0, 0],
      };
  }
}

export function sketchPointToWorld(frame: SketchFrame, point: Point2): [number, number, number] {
  return [
    frame.origin[0] + frame.xAxis[0] * point[0] + frame.yAxis[0] * point[1],
    frame.origin[1] + frame.xAxis[1] * point[0] + frame.yAxis[1] * point[1],
    frame.origin[2] + frame.xAxis[2] * point[0] + frame.yAxis[2] * point[1],
  ];
}

export function worldToSketchPoint(frame: SketchFrame, world: readonly number[]): Point2 {
  const dx = (world[0] ?? 0) - frame.origin[0];
  const dy = (world[1] ?? 0) - frame.origin[1];
  const dz = (world[2] ?? 0) - frame.origin[2];
  return [
    dx * frame.xAxis[0] + dy * frame.xAxis[1] + dz * frame.xAxis[2],
    dx * frame.yAxis[0] + dy * frame.yAxis[1] + dz * frame.yAxis[2],
  ];
}
