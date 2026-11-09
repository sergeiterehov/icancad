import {
  createId,
  type SketchConstraint,
  type SketchConstraintRef,
  type SketchEntity,
} from '@icancad/model';
import type { SketchSnap, SketchSnapInput } from './snap';

const AXIS_TOLERANCE = (5 * Math.PI) / 180;

export interface AutoConstraintResult {
  constraints: SketchConstraint[];
  snapConstraints: SketchConstraint[];
  highlightIds: string[];
}

const CURVE_POINT_CONSTRAINTS: Partial<Record<SketchEntity['type'], SketchConstraint['type']>> = {
  line: 'point-on-line',
  circle: 'point-on-circle',
  arc: 'point-on-circle',
  ellipse: 'point-on-ellipse',
};

function snapConstraint(
  entity: SketchEntity,
  pointIndex: number,
  input: SketchSnapInput,
): SketchConstraint | null {
  const { snap, mode } = input;
  if (!snap || mode === 'none') return null;
  const ref: SketchConstraintRef = { entityId: entity.id, pointIndex };

  if (mode === 'curve-only') {
    if (entity.type !== 'circle' && entity.type !== 'arc') return null;
    const target = snap.curveSnap;
    if (!target) return null;
    if (target.type === 'line' || target.type === 'circle' || target.type === 'arc') {
      return {
        id: createId('con'),
        type: 'tangent',
        refs: [{ entityId: entity.id }, { entityId: target.entityId }],
      };
    }
    return null;
  }

  if (snap.pointSnap) {
    return {
      id: createId('con'),
      type: 'coincident',
      refs: [ref, { entityId: snap.pointSnap.entityId, pointIndex: snap.pointSnap.pointIndex }],
    };
  }
  if (snap.midpointSnap) {
    return {
      id: createId('con'),
      type: 'symmetric',
      refs: [
        { entityId: snap.midpointSnap.entityId, pointIndex: 0 },
        { entityId: snap.midpointSnap.entityId, pointIndex: 1 },
        ref,
      ],
    };
  }
  if (!snap.curveSnap) return null;
  const type = CURVE_POINT_CONSTRAINTS[snap.curveSnap.type];
  if (!type) return null;
  return {
    id: createId('con'),
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

function axisOrientation(
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
    ? { id: createId('con'), type: orientation, refs: [{ entityId: line.id }] }
    : null;
}

export function isNearAxis(line: Extract<SketchEntity, { type: 'line' }>): boolean {
  return axisOrientation(line) !== null;
}

export function autoConstraintsForEntity(
  entity: SketchEntity,
  inputs: SketchSnapInput[],
): AutoConstraintResult {
  const snapConstraints: SketchConstraint[] = [];
  const highlightIds: string[] = [];
  inputs.forEach((input, index) => {
    const constraint = snapConstraint(entity, index, input);
    if (!constraint) return;
    snapConstraints.push(constraint);
    highlightIds.push(...snapHighlightIds(input.snap));
  });

  const constraints = [...snapConstraints];
  if (entity.type === 'line') {
    const orientation = orientationConstraint(entity);
    if (orientation) constraints.push(orientation);
  }
  return {
    constraints,
    snapConstraints,
    highlightIds: constraints.length > 0 ? [entity.id, ...highlightIds] : [],
  };
}
