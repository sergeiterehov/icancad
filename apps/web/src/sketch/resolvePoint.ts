import type { Point2 } from '@icancad/sketch';
import { axisOrientation, exactAxisOrientation } from './autoConstraints';
import type { SketchSnap, SketchSnapInput, SketchSnapMode } from './snap';
import type { SketchTool } from './tool';

/** Points are placed on a half-millimetre grid unless the magnet names one. */
const GRID_STEP = 0.5;

export function gridPoint(point: Point2): Point2 {
  return [
    Math.round(point[0] / GRID_STEP) * GRID_STEP,
    Math.round(point[1] / GRID_STEP) * GRID_STEP,
  ];
}

/**
 * The point a step of a tool may take from the magnet. A target is only
 * returned when that step can turn it into a constraint.
 */
export function snapTargetPoint(snap: SketchSnap | null, mode: SketchSnapMode): Point2 | null {
  if (!snap || mode === 'none') return null;
  if (snap.pointSnap) return snap.pointSnap.point;
  if (mode === 'free' && snap.midpointSnap) return snap.midpointSnap.point;
  if (mode === 'free') return snap.curveSnap?.point ?? null;
  // Tangency exists for lines, circles and arcs; an ellipse target would only
  // make the geometry stick without a constraint.
  if (mode === 'tangent' && snap.curveSnap && snap.curveSnap.type !== 'ellipse') {
    return snap.curveSnap.point;
  }
  return null;
}

/**
 * How a step reads the magnet: a free point takes every target, a radius takes
 * control points and tangency. An ellipse corner has no control point of its
 * own, so it does not snap instead of sticking without a constraint.
 */
export function snapModeFor(tool: SketchTool, draftLength: number): SketchSnapMode {
  if (tool === 'circle') return draftLength === 0 ? 'free' : 'tangent';
  // An arc takes its radius from the start point, so a target there belongs to
  // that point: a tangency would leave the point free to slide along the curve
  // and the solver would then move the whole arc.
  if (tool === 'arc') return 'free';
  if (tool === 'ellipse') return draftLength <= 1 ? 'free' : 'none';
  // The centre and the first corner are points of the polygon; the step that
  // counts its corners names an angle, not a point.
  if (tool === 'polygon') return draftLength < 2 ? 'free' : 'none';
  // The centre, the major half-axis and both ends are points of the finished
  // arc, so a target they land on becomes a constraint. The minor half-axis only
  // names a length across the major one, so nothing there could be constrained.
  if (tool === 'elliptical-arc') return draftLength === 2 ? 'none' : 'free';
  return 'free';
}

export interface SketchPointResolution {
  point: Point2;
  /** The grid point with the magnet ignored, used if the snap cannot be constrained. */
  fallback: Point2;
  input: SketchSnapInput;
}

interface ResolveOptions {
  raw: Point2;
  snap: SketchSnap | null;
  tool: SketchTool;
  mode: SketchSnapMode;
  magnet: boolean;
  /** The point the next one is measured from, for an axial line. */
  anchor?: Point2 | null;
}

/**
 * One place decides where a click, a stretch or its preview lands. The magnet
 * wins over everything, then an axial line is made exactly horizontal or
 * vertical, and only a free point is rounded to the grid. Rounding a magnet target would pull the
 * geometry off the thing it was snapped to.
 */
export function resolveSketchPoint({
  raw,
  snap,
  tool,
  mode,
  magnet,
  anchor,
}: ResolveOptions): SketchPointResolution {
  const fallback = gridPoint(raw);
  const orientationOf = (point: Point2) =>
    tool === 'line' && anchor
      ? axisOrientation({
          id: 'resolve',
          type: 'line',
          construction: false,
          x1: anchor[0],
          y1: anchor[1],
          x2: point[0],
          y2: point[1],
        })
      : null;
  const exactOrientationOf = (point: Point2) =>
    tool === 'line' && anchor
      ? exactAxisOrientation({
          id: 'resolve',
          type: 'line',
          construction: false,
          x1: anchor[0],
          y1: anchor[1],
          x2: point[0],
          y2: point[1],
        })
      : null;

  const target = magnet ? snapTargetPoint(snap, mode) : null;
  if (target) {
    // A magnet target is taken as it is, so it is aligned only when it lies on
    // the axis exactly. A target a few degrees off its axis cannot be both
    // coincident and vertical, and a promised alignment would be lost.
    const alignment = exactOrientationOf(target);
    return {
      point: target,
      fallback,
      input: { snap, mode, fallback, ...(alignment ? { alignment } : {}) },
    };
  }

  if (magnet && tool === 'line' && anchor) {
    const orientation = orientationOf(raw);
    if (orientation === 'horizontal') {
      return {
        point: [fallback[0], anchor[1]],
        fallback,
        input: { snap: null, mode, fallback, alignment: orientation },
      };
    }
    if (orientation === 'vertical') {
      return {
        point: [anchor[0], fallback[1]],
        fallback,
        input: { snap: null, mode, fallback, alignment: orientation },
      };
    }
  }

  return { point: fallback, fallback, input: { snap: null, mode, fallback } };
}
