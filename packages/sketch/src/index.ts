import type {
  SketchConstraint,
  SketchConstraintRef,
  SketchEntity,
  SketchReference,
} from '@icancad/model';

export * from './frame';
export * from './fundamental';

export interface SketchDocument {
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  references: SketchReference[];
}

export type Point2 = [number, number];

/**
 * Picks the representation of an angle that is closest to a reference one.
 * Angles are stored as plain numbers, so an angle recomputed with `atan2` jumps
 * by 2π at the branch cut. For an arc that jump reverses its sweep direction,
 * turning it inside out, so the previous angle is used to stay on the same
 * branch.
 */
export function unwrapAngle(angle: number, reference: number): number {
  return angle + Math.round((reference - angle) / (2 * Math.PI)) * 2 * Math.PI;
}

export function createEmptySketch(): SketchDocument {
  return { entities: [], constraints: [], references: [] };
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

export function entityControlPoints(entity: SketchEntity): Point2[] {
  switch (entity.type) {
    case 'point':
      return [[entity.x, entity.y]];
    case 'line':
      return [
        [entity.x1, entity.y1],
        [entity.x2, entity.y2],
      ];
    case 'circle':
      return [
        [entity.cx, entity.cy],
        [entity.cx + entity.r, entity.cy],
      ];
    case 'arc':
      return [
        [entity.cx, entity.cy],
        [
          entity.cx + Math.cos(entity.startAngle) * entity.r,
          entity.cy + Math.sin(entity.startAngle) * entity.r,
        ],
        [
          entity.cx + Math.cos(entity.endAngle) * entity.r,
          entity.cy + Math.sin(entity.endAngle) * entity.r,
        ],
      ];
    case 'ellipse': {
      const angle = (entity.rotation * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return [
        [entity.cx, entity.cy],
        [entity.cx + cos * entity.rx, entity.cy + sin * entity.rx],
        [entity.cx - sin * entity.ry, entity.cy + cos * entity.ry],
      ];
    }
    case 'bezier':
      return entity.points;
  }
}

export function entityControlPointRefs(entity: SketchEntity): SketchConstraintRef[] {
  if (entity.type === 'point') return [{ entityId: entity.id, pointIndex: 0 }];
  return entityControlPoints(entity).map((_, index) => ({
    entityId: entity.id,
    pointIndex: index,
  }));
}

export function translateEntity(entity: SketchEntity, dx: number, dy: number): SketchEntity {
  switch (entity.type) {
    case 'point':
      return { ...entity, x: entity.x + dx, y: entity.y + dy };
    case 'line':
      return {
        ...entity,
        x1: entity.x1 + dx,
        y1: entity.y1 + dy,
        x2: entity.x2 + dx,
        y2: entity.y2 + dy,
      };
    case 'circle':
      return { ...entity, cx: entity.cx + dx, cy: entity.cy + dy };
    case 'arc':
      return { ...entity, cx: entity.cx + dx, cy: entity.cy + dy };
    case 'ellipse':
      return { ...entity, cx: entity.cx + dx, cy: entity.cy + dy };
    case 'bezier':
      return {
        ...entity,
        points: entity.points.map((point) => [point[0] + dx, point[1] + dy] as Point2),
      };
  }
}

export function moveEntityControlPoint(
  entity: SketchEntity,
  index: number,
  point: Point2,
): SketchEntity {
  switch (entity.type) {
    case 'point':
      return { ...entity, x: point[0], y: point[1] };
    case 'line':
      return index === 0
        ? { ...entity, x1: point[0], y1: point[1] }
        : { ...entity, x2: point[0], y2: point[1] };
    case 'circle':
      if (index === 0) return { ...entity, cx: point[0], cy: point[1] };
      return {
        ...entity,
        r: Math.hypot(point[0] - entity.cx, point[1] - entity.cy),
      };
    case 'arc': {
      if (index === 0) return { ...entity, cx: point[0], cy: point[1] };
      const reference = index === 1 ? entity.startAngle : entity.endAngle;
      const angle = unwrapAngle(Math.atan2(point[1] - entity.cy, point[0] - entity.cx), reference);
      const r = Math.hypot(point[0] - entity.cx, point[1] - entity.cy);
      return index === 1 ? { ...entity, r, startAngle: angle } : { ...entity, r, endAngle: angle };
    }
    case 'ellipse': {
      if (index === 0) return { ...entity, cx: point[0], cy: point[1] };
      const dx = point[0] - entity.cx;
      const dy = point[1] - entity.cy;
      if (index === 1) {
        const angle = Math.atan2(dy, dx);
        return {
          ...entity,
          rx: Math.max(Math.hypot(dx, dy), 1e-4),
          rotation: (angle * 180) / Math.PI,
        };
      }
      const angle = (entity.rotation * Math.PI) / 180;
      const localY = -Math.sin(angle) * dx + Math.cos(angle) * dy;
      return { ...entity, ry: Math.max(Math.abs(localY), 1e-4) };
    }
    case 'bezier':
      return {
        ...entity,
        points: entity.points.map((candidate, pointIndex) =>
          pointIndex === index ? ([point[0], point[1]] as Point2) : candidate,
        ),
      };
  }
}

export * from './topology';

export * from './profile';

export * from './projection';
