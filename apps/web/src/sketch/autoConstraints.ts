import {
  createId,
  type SketchConstraint,
  type SketchConstraintRef,
  type SketchEntity,
} from '@icancad/model';
import type { SketchSnap, SketchSnapInput } from './snap';

const AXIS_TOLERANCE = (5 * Math.PI) / 180;
/** A magnet target counts as aligned only when it is on the axis, not near it. */
const EXACT_AXIS_EPSILON = 1e-9;

export interface AutoConstraintResult {
  constraints: SketchConstraint[];
  snapConstraints: SketchConstraint[];
  /** Horizontal or vertical constraints, which a fallback must not drop silently. */
  alignmentConstraints: SketchConstraint[];
  highlightIds: string[];
}

const CURVE_POINT_CONSTRAINTS: Partial<Record<SketchEntity['type'], SketchConstraint['type']>> = {
  line: 'point-on-line',
  circle: 'point-on-circle',
  arc: 'point-on-circle',
  ellipse: 'point-on-ellipse',
  'elliptical-arc': 'point-on-ellipse',
};

function snapConstraint(
  entity: SketchEntity,
  pointIndex: number,
  input: SketchSnapInput,
): SketchConstraint | null {
  const { snap, mode } = input;
  if (!snap || mode === 'none') return null;
  const ref: SketchConstraintRef = { entityId: entity.id, pointIndex };
  const targetPointRef = snap.pointSnap
    ? {
        entityId: snap.pointSnap.entityId,
        pointIndex: snap.pointSnap.pointIndex,
      }
    : null;

  if (snap.pointSnap && targetPointRef) {
    // A circle's rim handle is the radius, always drawn level with the centre.
    // A point the user aims at lies on the circle at its own angle, so it is
    // the point that is constrained onto the circle, not the handle.
    if (entity.type === 'circle' && pointIndex === 1) {
      return {
        id: createId('con'),
        auto: true,
        type: 'point-on-circle',
        refs: [targetPointRef, { entityId: entity.id }],
      };
    }
    return {
      id: createId('con'),
      auto: true,
      type: 'coincident',
      refs: [ref, targetPointRef],
    };
  }

  if (mode === 'free' && snap.midpointSnap) {
    return {
      id: createId('con'),
      auto: true,
      type: 'symmetric',
      refs: [
        { entityId: snap.midpointSnap.entityId, pointIndex: 0 },
        { entityId: snap.midpointSnap.entityId, pointIndex: 1 },
        ref,
      ],
    };
  }

  if (!snap.curveSnap) return null;
  if (mode === 'tangent') {
    if (entity.type !== 'circle' && entity.type !== 'arc') return null;
    const target = snap.curveSnap;
    if (target.type === 'line' || target.type === 'circle' || target.type === 'arc') {
      return {
        id: createId('con'),
        auto: true,
        type: 'tangent',
        refs: [{ entityId: entity.id }, { entityId: target.entityId }],
      };
    }
    return null;
  }
  const type = CURVE_POINT_CONSTRAINTS[snap.curveSnap.type];
  if (!type) return null;
  return {
    id: createId('con'),
    auto: true,
    type,
    refs: [ref, { entityId: snap.curveSnap.entityId }],
  };
}

export function snapHighlightIds(snap: SketchSnap | null): string[] {
  if (!snap) return [];
  if (snap.pointSnap) return [`${snap.pointSnap.entityId}#${snap.pointSnap.pointIndex}`];
  if (snap.midpointSnap) return [snap.midpointSnap.entityId];
  return snap.curveSnap ? [snap.curveSnap.entityId] : [];
}

export function axisOrientation(
  line: Extract<SketchEntity, { type: 'line' }>,
): 'horizontal' | 'vertical' | null {
  const angle = Math.abs(Math.atan2(line.y2 - line.y1, line.x2 - line.x1));
  if (angle <= AXIS_TOLERANCE || angle >= Math.PI - AXIS_TOLERANCE) return 'horizontal';
  if (Math.abs(angle - Math.PI / 2) <= AXIS_TOLERANCE) return 'vertical';
  return null;
}

export function orientationConstraint(
  line: Extract<SketchEntity, { type: 'line' }>,
): SketchConstraint | null {
  const orientation = axisOrientation(line);
  return orientation
    ? { id: createId('con'), auto: true, type: orientation, refs: [{ entityId: line.id }] }
    : null;
}

/**
 * The axis a line lies on exactly, without the drawing tolerance. An alignment
 * constraint may only accompany a magnet target this close: a target that is
 * merely near an axis cannot satisfy both the coincidence and the orientation,
 * and the sketch would keep only one of them.
 */
export function exactAxisOrientation(
  line: Extract<SketchEntity, { type: 'line' }>,
): 'horizontal' | 'vertical' | null {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const scale = Math.max(Math.abs(dx), Math.abs(dy));
  if (!(scale > 0)) return null;
  if (Math.abs(dy) <= EXACT_AXIS_EPSILON * scale) return 'horizontal';
  if (Math.abs(dx) <= EXACT_AXIS_EPSILON * scale) return 'vertical';
  return null;
}

export function isNearAxis(line: Extract<SketchEntity, { type: 'line' }>): boolean {
  return axisOrientation(line) !== null;
}

/** Whether a step took its point from a magnet target at all. */
export function hasMagnetTarget(input: SketchSnapInput | undefined): boolean {
  const snap = input?.snap;
  if (!snap || input?.mode === 'none') return false;
  return Boolean(snap.pointSnap || snap.curveSnap || snap.midpointSnap);
}

export function autoConstraintsForEntity(
  entity: SketchEntity,
  inputs: SketchSnapInput[],
): AutoConstraintResult {
  const snapConstraints: SketchConstraint[] = [];
  const alignmentConstraints: SketchConstraint[] = [];
  const highlightIds: string[] = [];
  inputs.forEach((input, index) => {
    const constraint = snapConstraint(entity, index, input);
    if (!constraint) return;
    snapConstraints.push(constraint);
    highlightIds.push(...snapHighlightIds(input.snap));
  });

  if (entity.type === 'line') {
    // The last step is the one that gives the line its direction; the first
    // point may carry the alignment of the segment before it.
    const last = inputs[inputs.length - 1];
    // A magnet target fixes the point exactly, so it can only be aligned when
    // the target itself lies on the axis. Inferring the axis from near-axis
    // geometry would create a constraint the coincidence cannot satisfy.
    const type = last?.alignment ?? (hasMagnetTarget(last) ? null : exactAxisOrientation(entity));
    if (type) {
      alignmentConstraints.push({
        id: createId('con'),
        auto: true,
        type,
        refs: [{ entityId: entity.id }],
      });
    }
  }
  const constraints = [...snapConstraints, ...alignmentConstraints];
  return {
    constraints,
    snapConstraints,
    alignmentConstraints,
    highlightIds: constraints.length > 0 ? [entity.id, ...highlightIds] : [],
  };
}
