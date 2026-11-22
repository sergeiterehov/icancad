import type { SketchEntity } from '@icancad/model';
import {
  entityControlPoints,
  isFundamentalEntityId,
  tessellateEntity,
  type Point2,
} from '@icancad/sketch';

export interface MarqueeRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Which way a marquee selects. Dragging left to right takes only what fits
 * inside the box; dragging right to left takes everything the box touches, the
 * convention every CAD program uses.
 */
export type MarqueeMode = 'window' | 'crossing';

const SEGMENTS = 64;
const EDGE = 1e-9;

export function marqueeMode(fromX: number, toX: number): MarqueeMode {
  return toX >= fromX ? 'window' : 'crossing';
}

export function marqueeRect(from: Point2, to: Point2): MarqueeRect {
  return {
    minX: Math.min(from[0], to[0]),
    minY: Math.min(from[1], to[1]),
    maxX: Math.max(from[0], to[0]),
    maxY: Math.max(from[1], to[1]),
  };
}

function inside(rect: MarqueeRect, point: Point2): boolean {
  return (
    point[0] >= rect.minX - EDGE &&
    point[0] <= rect.maxX + EDGE &&
    point[1] >= rect.minY - EDGE &&
    point[1] <= rect.maxY + EDGE
  );
}

/** Whether a segment crosses the rectangle or lies inside it. */
function segmentTouchesRect(rect: MarqueeRect, from: Point2, to: Point2): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < EDGE) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, from[0] - rect.minX) &&
    clip(dx, rect.maxX - from[0]) &&
    clip(-dy, from[1] - rect.minY) &&
    clip(dy, rect.maxY - from[1]) &&
    t0 <= t1
  );
}

function outline(entity: SketchEntity): Point2[] | null {
  if (entity.type === 'point') return [[entity.x, entity.y]];
  const points = tessellateEntity(entity, SEGMENTS);
  if (points.length === 0) return null;
  if (entity.type === 'circle' || entity.type === 'ellipse') points.push(points[0]!);
  return points;
}

function entityInMarquee(entity: SketchEntity, rect: MarqueeRect, mode: MarqueeMode): boolean {
  const points = outline(entity);
  if (!points) return false;
  if (mode === 'window') return points.every((point) => inside(rect, point));
  if (points.some((point) => inside(rect, point))) return true;
  for (let index = 0; index + 1 < points.length; index += 1) {
    if (segmentTouchesRect(rect, points[index]!, points[index + 1]!)) return true;
  }
  return false;
}

/**
 * Ids of the sketch geometry a marquee takes. The origin and the axes are
 * references, not geometry, so a box never selects them. A box also takes the
 * control points it covers, so a single end of a curve can be selected on its
 * own; an entity the box takes whole keeps only itself, because its points are
 * then part of it.
 */
export function entitiesInMarquee(
  entities: readonly SketchEntity[],
  rect: MarqueeRect,
  mode: MarqueeMode,
): string[] {
  if (rect.maxX - rect.minX <= EDGE && rect.maxY - rect.minY <= EDGE) return [];
  const taken: string[] = [];
  for (const entity of entities) {
    if (isFundamentalEntityId(entity.id)) continue;
    if (entityInMarquee(entity, rect, mode)) {
      taken.push(entity.id);
      continue;
    }
    if (entity.type === 'point') continue;
    entityControlPoints(entity).forEach((point, index) => {
      if (inside(rect, point)) taken.push(`${entity.id}#${index}`);
    });
  }
  return taken;
}
