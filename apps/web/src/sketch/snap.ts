import type { SketchEntity } from '@icancad/model';
import type { Point2 } from '@icancad/sketch';

export interface SketchPointSnap {
  entityId: string;
  pointIndex: number;
  point: Point2;
}

export interface SketchCurveSnap {
  entityId: string;
  type: SketchEntity['type'];
  point: Point2;
}

export interface SketchSnap {
  point: Point2;
  pointSnap: SketchPointSnap | null;
  curveSnap: SketchCurveSnap | null;
}
