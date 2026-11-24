import type { SketchEntity } from '@icancad/model';
import { ellipseArcPoint, entityEndpoints, normalizeAngle, type Point2 } from './index';

/**
 * Продление: stretching one end of a curve along the course it already has.
 *
 * Only an end moves, and only outwards, so the shape of the curve is untouched:
 * a line keeps its direction, an arc its centre and radius, an elliptical arc
 * its own ellipse. Everything here works in the curve's own parameter — the
 * length along a line, the angle round a circle — so the new end is exact and
 * needs no solve.
 */

export type ExtendFailure = 'unsupported' | 'inside';

/** One end of a curve, stretched out to where the pointer asks for. */
export interface ExtendShape {
  /** The stretched curve; it keeps its id and its construction flag. */
  entity: SketchEntity;
  /** The end that moved. */
  end: 'start' | 'end';
  /** Where that end stood, and where it stands now. */
  from: Point2;
  to: Point2;
}

export type ExtendResult = { ok: true; shape: ExtendShape } | { ok: false; error: ExtendFailure };

const TAU = Math.PI * 2;
/** An arc is at most one turn: a second turn has nowhere new to go. */
const FULL_TURN = TAU - 1e-9;

/**
 * How far an angle stands from another, travelling in the sweep's direction:
 * the length of the way round the circle from `from` to `to`.
 */
function along(from: number, to: number, direction: 1 | -1): number {
  return direction > 0 ? normalizeAngle(to - from) : normalizeAngle(from - to);
}

/**
 * The parameter of a point on an ellipse: its angle in the ellipse's own frame.
 * The point need not lie on the ellipse — the pointer never does — so the angle
 * is read from the ray the point stands on, which is what "that way round"
 * means for a curve that is not a circle.
 */
function ellipseAngle(
  entity: Extract<SketchEntity, { type: 'elliptical-arc' }>,
  point: Point2,
): number {
  const rotation = (entity.rotation * Math.PI) / 180;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const dx = point[0] - entity.cx;
  const dy = point[1] - entity.cy;
  const x = (dx * cos + dy * sin) / (entity.rx || 1);
  const y = (-dx * sin + dy * cos) / (entity.ry || 1);
  return Math.atan2(y, x);
}

/** The point of an arc or an elliptical arc at one of its own angles. */
function anglePoint(entity: SketchEntity, angle: number): Point2 | null {
  if (entity.type === 'arc') {
    return [
      entity.cx + Math.cos(angle) * entity.r,
      entity.cy + Math.sin(angle) * entity.r,
    ];
  }
  if (entity.type === 'elliptical-arc') return ellipseArcPoint(entity, angle);
  return null;
}

/**
 * The curve with one end stretched out to the pointer.
 *
 * The end grows along the curve's own course, so the pointer only says how far
 * and which way: a pointer that stands before the start grows the start, one
 * past the end grows the end, and one over the curve itself asks for nothing.
 * A Bezier is refused — stretching one moves its control points, which is a
 * decision of its own.
 */
export function extendCurve(
  entity: SketchEntity,
  pointer: Point2,
  end?: 'start' | 'end',
): ExtendResult {
  switch (entity.type) {
    case 'line': {
      const dx = entity.x2 - entity.x1;
      const dy = entity.y2 - entity.y1;
      const length = Math.hypot(dx, dy);
      if (length < 1e-9) return { ok: false, error: 'unsupported' };
      const ux = dx / length;
      const uy = dy / length;
      // Where the pointer stands along the line's own course: before its start,
      // over it, or past its end.
      const reach = (pointer[0] - entity.x1) * ux + (pointer[1] - entity.y1) * uy;
      const at = (step: number): Point2 => [entity.x1 + ux * step, entity.y1 + uy * step];
      if (reach > length && end !== 'start') {
        const to = at(reach);
        return {
          ok: true,
          shape: {
            entity: { ...entity, x2: to[0], y2: to[1] },
            end: 'end',
            from: [entity.x2, entity.y2],
            to,
          },
        };
      }
      if (reach < 0 && end !== 'end') {
        const to = at(reach);
        return {
          ok: true,
          shape: {
            entity: { ...entity, x1: to[0], y1: to[1] },
            end: 'start',
            from: [entity.x1, entity.y1],
            to,
          },
        };
      }
      return { ok: false, error: 'inside' };
    }
    case 'arc':
    case 'elliptical-arc': {
      const sweep = entity.endAngle - entity.startAngle;
      const magnitude = Math.abs(sweep);
      if (magnitude < 1e-9) return { ok: false, error: 'unsupported' };
      // A whole turn has no room left, and an arc past one would draw over
      // itself.
      const room = FULL_TURN - magnitude;
      if (room <= 1e-9) return { ok: false, error: 'inside' };
      const direction: 1 | -1 = sweep >= 0 ? 1 : -1;
      const angle =
        entity.type === 'arc'
          ? Math.atan2(pointer[1] - entity.cy, pointer[0] - entity.cx)
          : ellipseAngle(entity, pointer);
      const ends = entityEndpoints(entity);
      if (!ends) return { ok: false, error: 'unsupported' };
      // How far the pointer stands round the sweep from the start. Past the end
      // and behind the start are the same place seen from either side: the
      // curve can grow one way or the other, and the shorter way is the one the
      // pointer means unless the gesture already named an end.
      const fromStart = along(entity.startAngle, angle, direction);
      if (fromStart <= magnitude + 1e-9) return { ok: false, error: 'inside' };
      const beyondEnd = fromStart - magnitude;
      const behindStart = TAU - fromStart;
      const stretched = end ?? (beyondEnd <= behindStart ? 'end' : 'start');
      if (stretched === 'end') {
        const extended = entity.endAngle + direction * Math.min(beyondEnd, room);
        const to = anglePoint(entity, extended);
        if (!to) return { ok: false, error: 'unsupported' };
        return {
          ok: true,
          shape: { entity: { ...entity, endAngle: extended }, end: 'end', from: ends[1], to },
        };
      }
      const extended = entity.startAngle - direction * Math.min(behindStart, room);
      const to = anglePoint(entity, extended);
      if (!to) return { ok: false, error: 'unsupported' };
      return {
        ok: true,
        shape: { entity: { ...entity, startAngle: extended }, end: 'start', from: ends[0], to },
      };
    }
    default:
      return { ok: false, error: 'unsupported' };
  }
}
