import type { SketchFrame } from '@icancad/model';
import type { Point2 } from './index';

export type DatumPlane = 'XY' | 'XZ' | 'YZ';

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
