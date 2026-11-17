import type { SketchEntity, SketchMeasure } from '@icancad/model';
import {
  Angle,
  Diameter,
  MoveDiagonal,
  MoveHorizontal,
  MoveVertical,
  Radius,
  Spline,
} from 'lucide-react';
import type { ComponentType } from 'react';

interface ReferenceInfo {
  icon: ComponentType<{ size?: number }>;
  labelKey: string;
}

/** Icon and name of a measured reference, alongside the constraint catalog. */
export const REFERENCE_CATALOG: Record<SketchMeasure, ReferenceInfo> = {
  length: { icon: MoveDiagonal, labelKey: 'sketch.measure_length' },
  angle: { icon: Angle, labelKey: 'sketch.measure_angle' },
  radius: { icon: Radius, labelKey: 'sketch.measure_radius' },
  diameter: { icon: Diameter, labelKey: 'sketch.measure_diameter' },
  x: { icon: MoveHorizontal, labelKey: 'sketch.measure_x' },
  y: { icon: MoveVertical, labelKey: 'sketch.measure_y' },
  rx: { icon: MoveHorizontal, labelKey: 'sketch.measure_rx' },
  ry: { icon: MoveVertical, labelKey: 'sketch.measure_ry' },
};

/** A reference follows the geometry: an arc length wears the arc-length icon. */
export function referenceIcon(entity: SketchEntity | undefined, measure: SketchMeasure) {
  if (measure === 'length' && entity?.type === 'arc') return Spline;
  return REFERENCE_CATALOG[measure].icon;
}

export function referenceLabelKey(measure: SketchMeasure): string {
  return REFERENCE_CATALOG[measure].labelKey;
}
