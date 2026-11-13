import {
  createId,
  type ConstraintType,
  type SketchConstraint,
  type SketchConstraintRef,
  type SketchEntity,
  type SketchFeature,
} from '@icancad/model';
import {
  entityControlPoints,
  isFundamentalEntityId,
  sketchEntityIndex,
  type Point2,
} from '@icancad/sketch';
import { useUiStore } from '../stores/uiStore';
import { solveSketch } from './client';

export interface ConstraintAction {
  key: string;
  type: ConstraintType;
  refs: SketchConstraintRef[];
  value?: number;
}

export class ConstraintSolveError extends Error {
  constructor(readonly code: 'conflict' | 'failed') {
    super(code);
  }
}

const LABEL_KEYS: Partial<Record<ConstraintType, string>> = {
  fix: 'constraint.fix',
  coincident: 'constraint.coincident',
  horizontal: 'constraint.horizontal',
  vertical: 'constraint.vertical',
  parallel: 'constraint.parallel',
  perpendicular: 'constraint.perpendicular',
  distance: 'constraint.distance',
  'horizontal-distance': 'constraint.horizontalDistance',
  'vertical-distance': 'constraint.verticalDistance',
  angle: 'constraint.angle',
  radius: 'constraint.radius',
  diameter: 'constraint.diameter',
  equal: 'constraint.equal',
  concentric: 'constraint.concentric',
  midpoint: 'constraint.midpoint',
  'point-on-line': 'constraint.pointOnLine',
  'point-on-circle': 'constraint.pointOnCircle',
  'point-on-ellipse': 'constraint.pointOnEllipse',
  tangent: 'constraint.tangent',
  symmetric: 'constraint.symmetric',
};

export function constraintLabel(t: (key: string) => string, type: ConstraintType): string {
  return t(LABEL_KEYS[type] ?? type);
}

export function constraintEntityIds(constraint: SketchConstraint): Set<string> {
  return new Set(constraint.refs.map((ref) => ref.entityId));
}

export function refPoint(
  ref: SketchConstraintRef,
  entities: Map<string, SketchEntity>,
): Point2 | null {
  const entity = entities.get(ref.entityId);
  if (!entity) return null;
  if (entity.type === 'point') return [entity.x, entity.y];
  return entityControlPoints(entity)[ref.pointIndex ?? 0] ?? null;
}

function distanceBetween(
  a: SketchConstraintRef,
  b: SketchConstraintRef,
  entities: Map<string, SketchEntity>,
): number | undefined {
  const first = refPoint(a, entities);
  const second = refPoint(b, entities);
  if (!first || !second) return undefined;
  return Math.hypot(second[0] - first[0], second[1] - first[1]);
}

function lineAngle(entities: SketchEntity[], refs: SketchConstraintRef[]): number | undefined {
  const lines = refs
    .map((ref) => entities.find((entity) => entity.id === ref.entityId))
    .filter((entity): entity is Extract<SketchEntity, { type: 'line' }> => entity?.type === 'line')
    .slice(0, 2);
  if (lines.length !== 2) return undefined;
  const [first, second] = lines as [
    Extract<SketchEntity, { type: 'line' }>,
    Extract<SketchEntity, { type: 'line' }>,
  ];
  const a = [first.x2 - first.x1, first.y2 - first.y1] as const;
  const b = [second.x2 - second.x1, second.y2 - second.y1] as const;
  const denominator = Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1]);
  if (denominator === 0) return undefined;
  const cosine = Math.min(1, Math.max(-1, (a[0] * b[0] + a[1] * b[1]) / denominator));
  return (Math.acos(cosine) * 180) / Math.PI;
}

export function selectionRefs(
  selectionKeys: string[],
  entities: Map<string, SketchEntity>,
): SketchConstraintRef[] {
  const refs: SketchConstraintRef[] = [];
  for (const key of selectionKeys) {
    const [entityId, index] = key.split('#');
    if (!entityId) continue;
    const entity = entities.get(entityId);
    if (!entity) continue;
    if (index !== undefined) refs.push({ entityId, pointIndex: Number(index) });
    else if (entity.type === 'point') refs.push({ entityId, pointIndex: 0 });
    else refs.push({ entityId });
  }
  return refs;
}

export function buildConstraintActions(
  feature: SketchFeature,
  selectionKeys: string[],
): ConstraintAction[] {
  const entities = sketchEntityIndex(feature.entities);
  const refs = selectionRefs(selectionKeys, entities);
  const pointRefs = refs.filter((ref) => ref.pointIndex !== undefined);
  const entityRefs = refs.filter((ref) => ref.pointIndex === undefined);
  const selectedEntities = entityRefs
    .map((ref) => entities.get(ref.entityId))
    .filter((entity): entity is SketchEntity => Boolean(entity));
  // The origin and the axes are a priori fixed, so they cannot be fixed or
  // measured like ordinary geometry, but they are valid constraint targets.
  const ownRefs = refs.filter((ref) => !isFundamentalEntityId(ref.entityId));
  const ownEntities = selectedEntities.filter((entity) => !isFundamentalEntityId(entity.id));
  const lines = selectedEntities.filter((entity) => entity.type === 'line');
  const ownLines = ownEntities.filter((entity) => entity.type === 'line');
  const circles = ownEntities.filter((entity) => entity.type === 'circle' || entity.type === 'arc');
  const ellipses = ownEntities.filter((entity) => entity.type === 'ellipse');
  const actions: ConstraintAction[] = [];
  const push = (type: ConstraintType, actionRefs: SketchConstraintRef[], value?: number) => {
    actions.push({ key: `${type}-${actions.length}`, type, refs: actionRefs, value });
  };

  if (ownRefs.length > 0) push('fix', refs);
  if (refs.length === 2 && pointRefs.length === 2) {
    const first = refPoint(pointRefs[0]!, entities);
    const second = refPoint(pointRefs[1]!, entities);
    const current = distanceBetween(pointRefs[0]!, pointRefs[1]!, entities);
    push('coincident', refs);
    if (current !== undefined) push('distance', refs, current);
    if (first && second) {
      push('horizontal-distance', refs, Math.abs(second[0] - first[0]));
      push('vertical-distance', refs, Math.abs(second[1] - first[1]));
    }
    push('horizontal', refs);
    push('vertical', refs);
  }
  if (ownEntities.length === 1 && ownLines.length === 1 && refs.length === 1) {
    const line = ownLines[0] as Extract<SketchEntity, { type: 'line' }>;
    push('horizontal', entityRefs);
    push('vertical', entityRefs);
    push('distance', entityRefs, Math.hypot(line.x2 - line.x1, line.y2 - line.y1));
  }
  if (lines.length === 2) {
    push('parallel', entityRefs);
    push('perpendicular', entityRefs);
    const angle = lineAngle(selectedEntities, entityRefs);
    if (angle !== undefined) push('angle', entityRefs, Math.round(angle * 100) / 100);
    if (ownLines.length === 2) push('equal', entityRefs);
  }
  if (circles.length === 1 && entityRefs.length === 1) {
    const circle = circles[0] as Extract<SketchEntity, { type: 'circle' | 'arc' }>;
    push('radius', entityRefs, circle.r);
    push('diameter', entityRefs, circle.r * 2);
  }
  if (circles.length === 2) {
    push('equal', entityRefs);
    push('tangent', entityRefs);
  }
  if (pointRefs.length === 1 && lines.length === 1) push('point-on-line', refs);
  if (pointRefs.length === 1 && circles.length === 1) push('point-on-circle', refs);
  if (lines.length === 1 && circles.length === 1) push('tangent', refs);
  if (lines.length === 1 && ellipses.length === 1) push('tangent', refs);
  if (pointRefs.length === 2 && lines.length === 1 && refs.length === 3) push('symmetric', refs);
  if (pointRefs.length === 3 && refs.length === 3) push('symmetric', refs);
  if (pointRefs.length === 1 && selectedEntities.some((entity) => entity.type === 'ellipse')) {
    push('point-on-ellipse', refs);
  }
  return actions;
}

function constraintsForAction(
  action: ConstraintAction,
  entities: Map<string, SketchEntity>,
): SketchConstraint[] {
  if (action.type !== 'fix') {
    return [
      {
        id: createId('con'),
        type: action.type,
        refs: action.refs,
        value: action.value,
      },
    ];
  }

  const constraints: SketchConstraint[] = [];
  for (const ref of action.refs) {
    if (isFundamentalEntityId(ref.entityId)) continue;
    const entity = entities.get(ref.entityId);
    if (!entity) continue;
    if (entity.type === 'circle') {
      if (ref.pointIndex === undefined || ref.pointIndex === 0) {
        constraints.push({
          id: createId('con'),
          type: 'fix',
          refs: [{ entityId: ref.entityId, pointIndex: 0 }],
          x: entity.cx,
          y: entity.cy,
        });
      }
      if (ref.pointIndex === undefined || ref.pointIndex === 1) {
        constraints.push({
          id: createId('con'),
          type: 'radius',
          refs: [{ entityId: ref.entityId }],
          value: entity.r,
        });
      }
      continue;
    }
    const points =
      ref.pointIndex !== undefined || entity.type === 'point'
        ? [{ pointIndex: ref.pointIndex ?? 0, point: refPoint(ref, entities) }]
        : entityControlPoints(entity).map((point, pointIndex) => ({ pointIndex, point }));
    for (const entry of points) {
      if (!entry.point) continue;
      constraints.push({
        id: createId('con'),
        type: 'fix',
        refs: [{ entityId: ref.entityId, pointIndex: entry.pointIndex }],
        x: entry.point[0],
        y: entry.point[1],
      });
    }
  }
  return constraints;
}

async function solveWithConstraints(
  feature: SketchFeature,
  constraints: SketchConstraint[],
): Promise<SketchFeature> {
  let result;
  try {
    result = await solveSketch(feature.entities, constraints, [], { diagnose: true });
  } catch {
    throw new ConstraintSolveError('failed');
  }
  if (result.conflicting.length > 0) {
    throw new ConstraintSolveError('conflict');
  }
  useUiStore.getState().setSketchFrozen(result.frozenEntityIds);
  useUiStore
    .getState()
    .setSketchProblems([...new Set([...result.conflicting, ...result.redundant])]);
  return { ...feature, constraints, entities: result.entities };
}

export function applyConstraintAction(
  feature: SketchFeature,
  action: ConstraintAction,
): Promise<SketchFeature> {
  const entities = sketchEntityIndex(feature.entities);
  const constraints = constraintsForAction(action, entities);
  if (constraints.length === 0) return Promise.reject(new ConstraintSolveError('failed'));
  return solveWithConstraints(feature, [...feature.constraints, ...constraints]);
}

export async function diagnoseSketch(feature: SketchFeature): Promise<void> {
  if (feature.constraints.length === 0) {
    useUiStore.getState().setSketchFrozen([]);
    useUiStore.getState().setSketchProblems([]);
    return;
  }
  try {
    const result = await solveSketch(feature.entities, feature.constraints, [], { diagnose: true });
    useUiStore.getState().setSketchFrozen(result.frozenEntityIds);
    useUiStore
      .getState()
      .setSketchProblems([...new Set([...result.conflicting, ...result.redundant])]);
  } catch {
    useUiStore.getState().setSketchFrozen([]);
    useUiStore.getState().setSketchProblems([]);
  }
}

export function removeSketchEntities(
  feature: SketchFeature,
  entityIds: Iterable<string>,
): SketchFeature {
  const removed = new Set([...entityIds].filter((id) => !isFundamentalEntityId(id)));
  return {
    ...feature,
    entities: feature.entities.filter((entity) => !removed.has(entity.id)),
    constraints: feature.constraints.filter(
      (constraint) => !constraint.refs.some((ref) => removed.has(ref.entityId)),
    ),
    references: (feature.references ?? []).filter((reference) => !removed.has(reference.entityId)),
  };
}

export function applyConstraintValue(
  feature: SketchFeature,
  constraintId: string,
  value: number,
): Promise<SketchFeature> {
  return solveWithConstraints(
    feature,
    feature.constraints.map((constraint) =>
      constraint.id === constraintId ? { ...constraint, value } : constraint,
    ),
  );
}
