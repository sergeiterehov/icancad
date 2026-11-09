import {
  createId,
  type SketchConstraint,
  type SketchConstraintRef,
  type SketchEntity,
} from '@icancad/model';
import type { SketchSnap } from './snap';

const AXIS_TOLERANCE = (5 * Math.PI) / 180;

export interface AutoConstraintResult {
  constraints: SketchConstraint[];
  snapConstraints: SketchConstraint[];
  highlightIds: string[];
}

function snapConstraint(
  entityId: string,
  pointIndex: number,
  snap: SketchSnap | null,
): SketchConstraint | null {
  if (!snap) return null;
  const ref: SketchConstraintRef = { entityId, pointIndex };
  if (snap.pointSnap) {
    return {
      id: createId('con'),
      type: 'coincident',
      refs: [ref, { entityId: snap.pointSnap.entityId, pointIndex: snap.pointSnap.pointIndex }],
    };
  }
  if (!snap.curveSnap) return null;
  const type =
    snap.curveSnap.type === 'line'
      ? 'point-on-line'
      : snap.curveSnap.type === 'circle' || snap.curveSnap.type === 'arc'
        ? 'point-on-circle'
        : snap.curveSnap.type === 'ellipse'
          ? 'point-on-ellipse'
          : null;
  if (!type) return null;
  return {
    id: createId('con'),
    type,
    refs: [ref, { entityId: snap.curveSnap.entityId }],
  };
}

export function snapHighlightIds(snap: SketchSnap | null): string[] {
  if (!snap) return [];
  if (snap.pointSnap) {
    return [`${snap.pointSnap.entityId}#${snap.pointSnap.pointIndex}`];
  }
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
  snaps: (SketchSnap | null)[],
): AutoConstraintResult {
  const pointSnaps: (SketchSnap | null)[] =
    entity.type === 'circle'
      ? [snaps[0] ?? null]
      : entity.type === 'ellipse'
        ? [snaps[0] ?? null]
        : entity.type === 'point'
          ? [snaps[0] ?? null]
          : entity.type === 'line' || entity.type === 'arc' || entity.type === 'bezier'
            ? snaps
            : [];

  const snapConstraints: SketchConstraint[] = [];
  const highlightIds: string[] = [];
  pointSnaps.forEach((snap, index) => {
    const constraint = snapConstraint(entity.id, index, snap);
    if (constraint) {
      snapConstraints.push(constraint);
      highlightIds.push(...snapHighlightIds(snap));
    }
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
