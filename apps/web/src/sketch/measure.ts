import type { SketchEntity, SketchMeasure } from '@icancad/model';
import { tessellateEntity, type Point2 } from '@icancad/sketch';

export interface MeasureInfo {
  measure: SketchMeasure;
  labelKey: string;
  value: number;
  text: string;
}

export function measuresForEntity(entity: SketchEntity): SketchMeasure[] {
  switch (entity.type) {
    case 'point':
      return ['x', 'y'];
    case 'line':
      return ['length', 'angle'];
    case 'circle':
      return ['radius', 'diameter'];
    case 'arc':
      return ['radius', 'diameter', 'angle'];
    case 'ellipse':
      return ['rx', 'ry'];
    case 'bezier':
      return ['length'];
  }
}

function polylineLength(points: Point2[]): number {
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    total += Math.hypot(
      points[index + 1]![0] - points[index]![0],
      points[index + 1]![1] - points[index]![1],
    );
  }
  return total;
}

export function measureValue(entity: SketchEntity, measure: SketchMeasure): number | null {
  switch (measure) {
    case 'length':
      if (entity.type === 'line') {
        return Math.hypot(entity.x2 - entity.x1, entity.y2 - entity.y1);
      }
      if (entity.type === 'bezier') return polylineLength(tessellateEntity(entity, 64));
      return null;
    case 'angle':
      if (entity.type === 'line') {
        let degrees = (Math.atan2(entity.y2 - entity.y1, entity.x2 - entity.x1) * 180) / Math.PI;
        // A line is undirected, so report the angle in (-90, 90].
        while (degrees > 90) degrees -= 180;
        while (degrees <= -90) degrees += 180;
        return Math.round(degrees * 100) / 100;
      }
      if (entity.type === 'arc') {
        let sweep = entity.endAngle - entity.startAngle;
        while (sweep <= 0) sweep += Math.PI * 2;
        return Math.round(((sweep * 180) / Math.PI) * 100) / 100;
      }
      return null;
    case 'radius':
      return entity.type === 'circle' || entity.type === 'arc' ? entity.r : null;
    case 'diameter':
      return entity.type === 'circle' || entity.type === 'arc' ? entity.r * 2 : null;
    case 'x':
      return entity.type === 'point' ? entity.x : null;
    case 'y':
      return entity.type === 'point' ? entity.y : null;
    case 'rx':
      return entity.type === 'ellipse' ? entity.rx : null;
    case 'ry':
      return entity.type === 'ellipse' ? entity.ry : null;
  }
}

export function formatMeasure(
  measure: SketchMeasure,
  value: number,
  locale: string,
  unit: string,
): string {
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  switch (measure) {
    case 'angle':
      return `${formatted}°`;
    case 'radius':
      return `R ${formatted} ${unit}`;
    case 'diameter':
      return `Ø ${formatted} ${unit}`;
    case 'x':
      return `X ${formatted} ${unit}`;
    case 'y':
      return `Y ${formatted} ${unit}`;
    case 'rx':
      return `rx ${formatted} ${unit}`;
    case 'ry':
      return `ry ${formatted} ${unit}`;
    default:
      return `${formatted} ${unit}`;
  }
}

/** Measures shown next to the cursor while the geometry is being drawn. */
export function liveMeasures(entity: SketchEntity): SketchMeasure[] {
  switch (entity.type) {
    case 'line':
      return ['length'];
    case 'circle':
      return ['radius'];
    case 'arc':
      return ['radius', 'angle'];
    case 'bezier':
      return ['length'];
    default:
      return [];
  }
}

export function measureInfo(
  entity: SketchEntity,
  measure: SketchMeasure,
  locale: string,
  unit: string,
): MeasureInfo | null {
  const value = measureValue(entity, measure);
  if (value === null) return null;
  return {
    measure,
    labelKey: `sketch.measure_${measure}`,
    value,
    text: formatMeasure(measure, value, locale, unit),
  };
}
