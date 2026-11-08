import type { SketchConstraint, SketchEntity } from '@icancad/model';

export * from './frame';

export interface SketchDocument {
  entities: SketchEntity[];
  constraints: SketchConstraint[];
}

export type Point2 = [number, number];

export function createEmptySketch(): SketchDocument {
  return { entities: [], constraints: [] };
}

function sampleBezier(points: Point2[], segments: number): Point2[] {
  const result: Point2[] = [];
  const degree = points.length - 1;
  const binomial = (n: number, k: number): number => {
    let value = 1;
    for (let i = 1; i <= k; i += 1) {
      value = (value * (n - k + i)) / i;
    }
    return value;
  };

  for (let step = 0; step <= segments; step += 1) {
    const t = step / segments;
    let x = 0;
    let y = 0;
    for (let i = 0; i <= degree; i += 1) {
      const weight = binomial(degree, i) * (1 - t) ** (degree - i) * t ** i;
      const point = points[i];
      if (!point) continue;
      x += point[0] * weight;
      y += point[1] * weight;
    }
    result.push([x, y]);
  }
  return result;
}

export function tessellateEntity(entity: SketchEntity, segments = 32): Point2[] {
  switch (entity.type) {
    case 'point':
      return [[entity.x, entity.y]];
    case 'line':
      return [
        [entity.x1, entity.y1],
        [entity.x2, entity.y2],
      ];
    case 'circle': {
      const points: Point2[] = [];
      for (let i = 0; i < segments; i += 1) {
        const angle = (i / segments) * Math.PI * 2;
        points.push([
          entity.cx + Math.cos(angle) * entity.r,
          entity.cy + Math.sin(angle) * entity.r,
        ]);
      }
      return points;
    }
    case 'arc': {
      const sweep = entity.endAngle - entity.startAngle;
      const points: Point2[] = [];
      for (let i = 0; i <= segments; i += 1) {
        const angle = entity.startAngle + (sweep * i) / segments;
        points.push([
          entity.cx + Math.cos(angle) * entity.r,
          entity.cy + Math.sin(angle) * entity.r,
        ]);
      }
      return points;
    }
    case 'ellipse': {
      const points: Point2[] = [];
      const rotation = (entity.rotation * Math.PI) / 180;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      for (let i = 0; i < segments; i += 1) {
        const angle = (i / segments) * Math.PI * 2;
        const x = Math.cos(angle) * entity.rx;
        const y = Math.sin(angle) * entity.ry;
        points.push([entity.cx + x * cos - y * sin, entity.cy + x * sin + y * cos]);
      }
      return points;
    }
    case 'bezier':
      return sampleBezier(entity.points, segments);
  }
}

export function entityEndpoints(entity: SketchEntity): [Point2, Point2] | null {
  switch (entity.type) {
    case 'line':
      return [
        [entity.x1, entity.y1],
        [entity.x2, entity.y2],
      ];
    case 'arc':
      return [
        [
          entity.cx + Math.cos(entity.startAngle) * entity.r,
          entity.cy + Math.sin(entity.startAngle) * entity.r,
        ],
        [
          entity.cx + Math.cos(entity.endAngle) * entity.r,
          entity.cy + Math.sin(entity.endAngle) * entity.r,
        ],
      ];
    case 'bezier': {
      const first = entity.points[0];
      const last = entity.points[entity.points.length - 1];
      if (!first || !last) return null;
      return [first, last];
    }
    default:
      return null;
  }
}
