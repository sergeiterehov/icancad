import type { Point2 } from '@icancad/sketch';
import { axisOrientation } from './autoConstraints';
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
  if (tool === 'arc') return draftLength === 0 ? 'free' : draftLength === 1 ? 'tangent' : 'free';
  if (tool === 'ellipse') return draftLength === 0 ? 'free' : 'none';
  return 'free';
}

export interface SketchPointResolution {
  point: Point2;
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
  const target = magnet ? snapTargetPoint(snap, mode) : null;
  if (target) return { point: target, input: { snap, mode } };

  if (magnet && tool === 'line' && anchor) {
    const orientation = axisOrientation({
      id: 'resolve',
      type: 'line',
      construction: false,
      x1: anchor[0],
      y1: anchor[1],
      x2: raw[0],
      y2: raw[1],
    });
    if (orientation === 'horizontal') {
      return { point: [gridPoint(raw)[0], anchor[1]], input: { snap: null, mode } };
    }
    if (orientation === 'vertical') {
      return { point: [anchor[0], gridPoint(raw)[1]], input: { snap: null, mode } };
    }
  }

  return { point: gridPoint(raw), input: { snap: null, mode } };
}
