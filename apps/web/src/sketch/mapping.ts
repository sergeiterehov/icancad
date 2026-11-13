import type { Constraint, SketchPrimitive } from '@salusoft89/planegcs';
import type { SketchConstraint, SketchConstraintRef, SketchEntity } from '@icancad/model';
import {
  entityControlPoints,
  fundamentalEntities,
  isFundamentalEntityId,
  SKETCH_ORIGIN_ID,
  SKETCH_X_AXIS_ID,
  SKETCH_Y_AXIS_ID,
  sketchEntityIndex,
  unwrapAngle,
  withFundamentalEntities,
  type Point2,
} from '@icancad/sketch';
import type { SolverPin } from './protocol';

const pointId = (entityId: string, index: number): string => `${entityId}~p${index}`;

function ellipseFocus(entity: Extract<SketchEntity, { type: 'ellipse' }>): Point2 {
  const major = Math.max(entity.rx, entity.ry);
  const minor = Math.min(entity.rx, entity.ry);
  const distance = Math.sqrt(Math.max(0, major * major - minor * minor));
  const angle = entity.rotation + (entity.rx >= entity.ry ? 0 : Math.PI / 2);
  return [entity.cx + Math.cos(angle) * distance, entity.cy + Math.sin(angle) * distance];
}

function refKey(ref: SketchConstraintRef): string {
  return `${ref.entityId}${ref.pointIndex === undefined ? '' : `#${ref.pointIndex}`}`;
}

function pointRefId(ref: SketchConstraintRef, entity: SketchEntity | undefined): string | null {
  if (ref.pointIndex !== undefined) {
    return entity?.type === 'point' ? entity.id : pointId(ref.entityId, ref.pointIndex);
  }
  if (entity?.type === 'point') return entity.id;
  return null;
}

function pointRefIds(ref: SketchConstraintRef, entity: SketchEntity | undefined): string[] {
  if (ref.pointIndex !== undefined) {
    const id = pointRefId(ref, entity);
    return id ? [id] : [];
  }
  if (entity?.type === 'point') return [entity.id];
  if (!entity) return [];
  return entityControlPoints(entity).map((_, index) => pointId(entity.id, index));
}

function refPoint(ref: SketchConstraintRef, entity: SketchEntity | undefined): Point2 | null {
  if (!entity) return null;
  if (entity.type === 'point') return [entity.x, entity.y];
  return entityControlPoints(entity)[ref.pointIndex ?? 0] ?? null;
}

export interface SolverPrimitives {
  primitives: SketchPrimitive[];
  entities: Map<string, SketchEntity>;
}

export function buildSolverPrimitives(
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  pinned: SolverPin[] = [],
): SolverPrimitives {
  const fixed = new Set<string>();
  const anchors = new Map<string, Point2>();
  const axisPins: Constraint[] = [];
  const entityMap = sketchEntityIndex(entities);
  // Fundamental geometry is a priori fixed: the solver never moves it.
  for (const entity of fundamentalEntities()) {
    for (const id of pointRefIds({ entityId: entity.id }, entity)) fixed.add(id);
  }
  for (const constraint of constraints) {
    if (constraint.type !== 'fix') continue;
    for (const ref of constraint.refs) {
      if (isFundamentalEntityId(ref.entityId)) continue;
      for (const id of pointRefIds(ref, entityMap.get(ref.entityId))) {
        fixed.add(id);
        if (
          constraint.refs.length === 1 &&
          constraint.x !== undefined &&
          constraint.y !== undefined
        ) {
          anchors.set(id, [constraint.x, constraint.y]);
        }
      }
    }
  }
  for (const ref of pinned) {
    if (isFundamentalEntityId(ref.entityId)) continue;
    const entity = entityMap.get(ref.entityId);
    const ids = pointRefIds(ref, entity);
    if (!ref.axis || ref.pointIndex === undefined) {
      for (const id of ids) fixed.add(id);
      continue;
    }
    const value = entity
      ? entityControlPoints(entity)[ref.pointIndex]?.[ref.axis === 'x' ? 0 : 1]
      : undefined;
    if (value === undefined) continue;
    for (const id of ids) {
      axisPins.push({
        id: `${id}~pin-${ref.axis}`,
        type: ref.axis === 'x' ? 'coordinate_x' : 'coordinate_y',
        p_id: id,
        [ref.axis]: value,
      } as unknown as Constraint);
    }
  }

  const primitives: SketchPrimitive[] = [];
  for (const entity of withFundamentalEntities(entities)) {
    const points = entityControlPoints(entity);
    const point = (index: number, fallback?: Point2): string => {
      const id = pointId(entity.id, index);
      const anchor = anchors.get(id);
      primitives.push({
        id,
        type: 'point',
        x: anchor?.[0] ?? points[index]?.[0] ?? fallback?.[0] ?? 0,
        y: anchor?.[1] ?? points[index]?.[1] ?? fallback?.[1] ?? 0,
        fixed: fixed.has(id),
      } as SketchPrimitive);
      return id;
    };

    switch (entity.type) {
      case 'point': {
        const anchor = anchors.get(entity.id);
        primitives.push({
          id: entity.id,
          type: 'point',
          x: anchor?.[0] ?? entity.x,
          y: anchor?.[1] ?? entity.y,
          fixed: fixed.has(entity.id),
        } as SketchPrimitive);
        break;
      }
      case 'line': {
        const p1 = point(0);
        const p2 = point(1);
        primitives.push({ id: entity.id, type: 'line', p1_id: p1, p2_id: p2 } as SketchPrimitive);
        break;
      }
      case 'circle': {
        const center = point(0);
        primitives.push({
          id: entity.id,
          type: 'circle',
          c_id: center,
          radius: entity.r,
        } as SketchPrimitive);
        break;
      }
      case 'arc': {
        const center = point(0);
        const start = point(1);
        const end = point(2);
        primitives.push({
          id: entity.id,
          type: 'arc',
          c_id: center,
          radius: entity.r,
          start_angle: entity.startAngle,
          end_angle: entity.endAngle,
          start_id: start,
          end_id: end,
        } as SketchPrimitive);
        primitives.push({
          id: `${entity.id}~arc`,
          type: 'arc_rules',
          a_id: entity.id,
        } as SketchPrimitive);
        break;
      }
      case 'ellipse': {
        const center = point(0);
        const major = point(1);
        const minor = point(2);
        const focus = ellipseFocus(entity);
        const focusId = pointId(entity.id, 3);
        const focusAnchor = anchors.get(focusId);
        primitives.push({
          id: focusId,
          type: 'point',
          x: focusAnchor?.[0] ?? focus[0],
          y: focusAnchor?.[1] ?? focus[1],
          fixed: fixed.has(focusId),
        } as SketchPrimitive);
        primitives.push({
          id: entity.id,
          type: 'ellipse',
          c_id: center,
          focus1_id: focusId,
          radmin: Math.min(entity.rx, entity.ry),
        } as SketchPrimitive);
        const majorLine = `${entity.id}~major-line`;
        const minorLine = `${entity.id}~minor-line`;
        primitives.push({
          id: majorLine,
          type: 'line',
          p1_id: center,
          p2_id: major,
        } as SketchPrimitive);
        primitives.push({
          id: minorLine,
          type: 'line',
          p1_id: center,
          p2_id: minor,
        } as SketchPrimitive);
        primitives.push({
          id: `${entity.id}~major-handle`,
          type: 'point_on_ellipse',
          p_id: major,
          e_id: entity.id,
        } as Constraint);
        primitives.push({
          id: `${entity.id}~minor-handle`,
          type: 'point_on_ellipse',
          p_id: minor,
          e_id: entity.id,
        } as Constraint);
        primitives.push({
          id: `${entity.id}~axes`,
          type: 'perpendicular_ll',
          l1_id: majorLine,
          l2_id: minorLine,
        } as Constraint);
        break;
      }
      case 'bezier': {
        const poles = entity.points.map((_, index) => point(index));
        const degree = Math.max(1, poles.length - 1);
        primitives.push({
          id: entity.id,
          type: 'bspline',
          pole_ids: poles,
          weights: poles.map(() => 1),
          knots: [0, 1],
          mult: [degree + 1, degree + 1],
          degree,
          periodic: false,
        } as SketchPrimitive);
        break;
      }
    }
  }

  for (const constraint of constraints) {
    if (
      (constraint.type === 'horizontal-distance' || constraint.type === 'vertical-distance') &&
      constraint.refs.length === 2
    ) {
      const first = refPoint(constraint.refs[0]!, entityMap.get(constraint.refs[0]!.entityId));
      const second = refPoint(constraint.refs[1]!, entityMap.get(constraint.refs[1]!.entityId));
      const p1 = pointRefId(constraint.refs[0]!, entityMap.get(constraint.refs[0]!.entityId));
      const p2 = pointRefId(constraint.refs[1]!, entityMap.get(constraint.refs[1]!.entityId));
      if (first && second && p1 && p2) {
        const horizontal = constraint.type === 'horizontal-distance';
        const auxId = `${constraint.id}~aux`;
        primitives.push({
          id: auxId,
          type: 'point',
          x: horizontal ? second[0] : first[0],
          y: horizontal ? first[1] : second[1],
          fixed: false,
        } as SketchPrimitive);
        primitives.push({
          id: `${constraint.id}~align1`,
          type: horizontal ? 'horizontal_pp' : 'vertical_pp',
          p1_id: p1,
          p2_id: auxId,
        } as Constraint);
        primitives.push({
          id: `${constraint.id}~align2`,
          type: horizontal ? 'vertical_pp' : 'horizontal_pp',
          p1_id: auxId,
          p2_id: p2,
        } as Constraint);
        primitives.push({
          id: constraint.id,
          type: 'p2p_distance',
          p1_id: p1,
          p2_id: auxId,
          distance: constraint.value ?? 0,
        } as Constraint);
        continue;
      }
    }
    const mapped = mapConstraint(constraint, entityMap);
    if (mapped) primitives.push(mapped);
  }
  primitives.push(...axisPins);
  return { primitives, entities: entityMap };
}

function mapConstraint(
  constraint: SketchConstraint,
  entityMap: Map<string, SketchEntity>,
): Constraint | null {
  if (constraint.type === 'fix') return null;
  const refs = constraint.refs;
  const entity = (index: number) => entityMap.get(refs[index]!.entityId);
  const point = (index: number) => pointRefId(refs[index]!, entity(index));
  const value = constraint.value ?? 0;
  const id = constraint.id;

  switch (constraint.type) {
    case 'coincident':
      if (refs.length !== 2) return null;
      return {
        id,
        type: 'p2p_coincident',
        p1_id: point(0)!,
        p2_id: point(1)!,
      } as Constraint;
    case 'horizontal':
      if (entity(0)?.type === 'line') {
        return { id, type: 'horizontal_l', l_id: refs[0]!.entityId } as Constraint;
      }
      if (refs.length === 2) {
        return { id, type: 'horizontal_pp', p1_id: point(0)!, p2_id: point(1)! } as Constraint;
      }
      return null;
    case 'vertical':
      if (entity(0)?.type === 'line') {
        return { id, type: 'vertical_l', l_id: refs[0]!.entityId } as Constraint;
      }
      if (refs.length === 2) {
        return { id, type: 'vertical_pp', p1_id: point(0)!, p2_id: point(1)! } as Constraint;
      }
      return null;
    case 'angle': {
      if (entity(0)?.type !== 'line' || entity(1)?.type !== 'line') return null;
      return {
        id,
        type: 'l2l_angle_ll',
        l1_id: refs[0]!.entityId,
        l2_id: refs[1]!.entityId,
        angle: ((constraint.value ?? 0) * Math.PI) / 180,
      } as Constraint;
    }
    case 'parallel':
      if (entity(0)?.type !== 'line' || entity(1)?.type !== 'line') return null;
      return {
        id,
        type: 'parallel',
        l1_id: refs[0]!.entityId,
        l2_id: refs[1]!.entityId,
      } as Constraint;
    case 'perpendicular':
      if (entity(0)?.type !== 'line' || entity(1)?.type !== 'line') return null;
      return {
        id,
        type: 'perpendicular_ll',
        l1_id: refs[0]!.entityId,
        l2_id: refs[1]!.entityId,
      } as Constraint;
    case 'distance': {
      if (refs.length === 2 && point(0) && point(1)) {
        return {
          id,
          type: 'p2p_distance',
          p1_id: point(0)!,
          p2_id: point(1)!,
          distance: value,
        } as Constraint;
      }
      const line = entity(0);
      if (line?.type === 'line') {
        return {
          id,
          type: 'p2p_distance',
          p1_id: pointId(line.id, 0),
          p2_id: pointId(line.id, 1),
          distance: value,
        } as Constraint;
      }
      return null;
    }
    case 'radius':
    case 'diameter': {
      const target = entity(0);
      if (target?.type === 'circle') {
        return {
          id,
          type: constraint.type === 'radius' ? 'circle_radius' : 'circle_diameter',
          c_id: target.id,
          [constraint.type === 'radius' ? 'radius' : 'diameter']: value,
        } as unknown as Constraint;
      }
      if (target?.type === 'arc') {
        return {
          id,
          type: constraint.type === 'radius' ? 'arc_radius' : 'arc_diameter',
          a_id: target.id,
          [constraint.type === 'radius' ? 'radius' : 'diameter']: value,
        } as unknown as Constraint;
      }
      return null;
    }
    case 'equal': {
      const first = entity(0);
      const second = entity(1);
      if (first?.type === 'line' && second?.type === 'line') {
        return { id, type: 'equal_length', l1_id: first.id, l2_id: second.id } as Constraint;
      }
      if (first?.type === 'circle' && second?.type === 'circle') {
        return { id, type: 'equal_radius_cc', c1_id: first.id, c2_id: second.id } as Constraint;
      }
      if (first?.type === 'arc' && second?.type === 'arc') {
        return { id, type: 'equal_radius_aa', a1_id: first.id, a2_id: second.id } as Constraint;
      }
      if (first?.type === 'circle' && second?.type === 'arc') {
        return { id, type: 'equal_radius_ca', c1_id: first.id, a2_id: second.id } as Constraint;
      }
      if (first?.type === 'arc' && second?.type === 'circle') {
        return { id, type: 'equal_radius_ca', c1_id: second.id, a2_id: first.id } as Constraint;
      }
      return null;
    }
    case 'point-on-line': {
      const pointRef = refs.find((ref) => pointRefId(ref, entityMap.get(ref.entityId)));
      // A line endpoint is itself typed as a line, so only a ref without a
      // point index designates the line to lie on.
      const lineRef = refs.find(
        (ref) => ref.pointIndex === undefined && entityMap.get(ref.entityId)?.type === 'line',
      );
      if (!pointRef || !lineRef) return null;
      const p = pointRefId(pointRef, entityMap.get(pointRef.entityId))!;
      // A point on an axis is the same as it sharing a coordinate with the
      // origin. Aligning with the fixed origin point keeps the solve clean,
      // whereas `point_on_line_pl` against an already fixed line makes the
      // solver report spurious redundants and a wrong DoF.
      if (lineRef.entityId === SKETCH_X_AXIS_ID) {
        return { id, type: 'horizontal_pp', p1_id: p, p2_id: SKETCH_ORIGIN_ID } as Constraint;
      }
      if (lineRef.entityId === SKETCH_Y_AXIS_ID) {
        return { id, type: 'vertical_pp', p1_id: p, p2_id: SKETCH_ORIGIN_ID } as Constraint;
      }
      return {
        id,
        type: 'point_on_line_pl',
        p_id: p,
        l_id: lineRef.entityId,
      } as Constraint;
    }
    case 'point-on-circle': {
      const pointRef = refs.find((ref) => pointRefId(ref, entityMap.get(ref.entityId)));
      const circleRef = refs.find((ref) => {
        const type = entityMap.get(ref.entityId)?.type;
        return type === 'circle' || type === 'arc';
      });
      if (!pointRef || !circleRef) return null;
      const target = entityMap.get(circleRef.entityId);
      return {
        id,
        type: target?.type === 'arc' ? 'point_on_arc' : 'point_on_circle',
        p_id: pointRefId(pointRef, entityMap.get(pointRef.entityId))!,
        [target?.type === 'arc' ? 'a_id' : 'c_id']: circleRef.entityId,
      } as unknown as Constraint;
    }
    case 'point-on-ellipse': {
      const pointRef = refs.find((ref) => pointRefId(ref, entityMap.get(ref.entityId)));
      const ellipseRef = refs.find((ref) => entityMap.get(ref.entityId)?.type === 'ellipse');
      if (!pointRef || !ellipseRef) return null;
      return {
        id,
        type: 'point_on_ellipse',
        p_id: pointRefId(pointRef, entityMap.get(pointRef.entityId))!,
        e_id: ellipseRef.entityId,
      } as Constraint;
    }
    case 'tangent': {
      const first = entity(0);
      const second = entity(1);
      if (!first || !second) return null;
      if (first.type === 'line' && second.type === 'circle') {
        return { id, type: 'tangent_lc', l_id: first.id, c_id: second.id } as Constraint;
      }
      if (first.type === 'line' && second.type === 'arc') {
        return { id, type: 'tangent_la', l_id: first.id, a_id: second.id } as Constraint;
      }
      if (first.type === 'line' && second.type === 'ellipse') {
        return { id, type: 'tangent_le', l_id: first.id, e_id: second.id } as Constraint;
      }
      if (first.type === 'ellipse' && second.type === 'line') {
        return { id, type: 'tangent_le', l_id: second.id, e_id: first.id } as Constraint;
      }
      if (first.type === 'circle' && second.type === 'line') {
        return { id, type: 'tangent_lc', l_id: second.id, c_id: first.id } as Constraint;
      }
      if (first.type === 'arc' && second.type === 'line') {
        return { id, type: 'tangent_la', l_id: second.id, a_id: first.id } as Constraint;
      }
      if (first.type === 'circle' && second.type === 'circle') {
        return { id, type: 'tangent_cc', c1_id: first.id, c2_id: second.id } as Constraint;
      }
      if (first.type === 'arc' && second.type === 'arc') {
        return { id, type: 'tangent_aa', a1_id: first.id, a2_id: second.id } as Constraint;
      }
      if (first.type === 'circle' && second.type === 'arc') {
        return { id, type: 'tangent_ca', c_id: first.id, a_id: second.id } as Constraint;
      }
      if (first.type === 'arc' && second.type === 'circle') {
        return { id, type: 'tangent_ca', c_id: second.id, a_id: first.id } as Constraint;
      }
      return null;
    }
    case 'symmetric': {
      if (refs.length !== 3) return null;
      const lineRef = refs.find(
        (ref) => ref.pointIndex === undefined && entityMap.get(ref.entityId)?.type === 'line',
      );
      if (lineRef) {
        const pointRefs = refs.filter((ref) => ref !== lineRef);
        if (pointRefs.length !== 2) return null;
        return {
          id,
          type: 'p2p_symmetric_ppl',
          p1_id: pointRefId(pointRefs[0]!, entityMap.get(pointRefs[0]!.entityId))!,
          p2_id: pointRefId(pointRefs[1]!, entityMap.get(pointRefs[1]!.entityId))!,
          l_id: lineRef.entityId,
        } as Constraint;
      }
      const first = point(0);
      const second = point(1);
      const center = point(2);
      if (!first || !second || !center) return null;
      return {
        id,
        type: 'p2p_symmetric_ppp',
        p1_id: first,
        p2_id: second,
        p_id: center,
      } as Constraint;
    }
    default:
      return null;
  }
}

export function applySolverSolution(
  entities: SketchEntity[],
  primitives: SketchPrimitive[],
): SketchEntity[] {
  const map = new Map(primitives.map((primitive) => [primitive.id, primitive]));
  const point = (id: string): Point2 | null => {
    const primitive = map.get(id);
    if (!primitive || primitive.type !== 'point') return null;
    return [primitive.x, primitive.y];
  };
  return entities.map((entity) => {
    switch (entity.type) {
      case 'point': {
        const p = point(entity.id);
        return p ? { ...entity, x: p[0], y: p[1] } : entity;
      }
      case 'line': {
        const p1 = point(pointId(entity.id, 0));
        const p2 = point(pointId(entity.id, 1));
        return p1 && p2 ? { ...entity, x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] } : entity;
      }
      case 'circle': {
        const p = point(pointId(entity.id, 0));
        const primitive = map.get(entity.id);
        return p && primitive?.type === 'circle'
          ? { ...entity, cx: p[0], cy: p[1], r: primitive.radius }
          : entity;
      }
      case 'arc': {
        const center = point(pointId(entity.id, 0));
        const start = point(pointId(entity.id, 1));
        const end = point(pointId(entity.id, 2));
        const primitive = map.get(entity.id);
        if (!center || !start || !end || primitive?.type !== 'arc') return entity;
        const startAngle = unwrapAngle(
          Math.atan2(start[1] - center[1], start[0] - center[0]),
          entity.startAngle,
        );
        const endAngle = unwrapAngle(
          Math.atan2(end[1] - center[1], end[0] - center[0]),
          entity.endAngle,
        );
        return {
          ...entity,
          cx: center[0],
          cy: center[1],
          r: primitive.radius,
          startAngle,
          endAngle,
        };
      }
      case 'ellipse': {
        const center = point(pointId(entity.id, 0));
        const focus = point(pointId(entity.id, 3));
        const primitive = map.get(entity.id);
        if (!center || !focus || primitive?.type !== 'ellipse') return entity;
        const distance = Math.hypot(focus[0] - center[0], focus[1] - center[1]);
        const major = Math.sqrt(distance * distance + primitive.radmin * primitive.radmin);
        return {
          ...entity,
          cx: center[0],
          cy: center[1],
          rx: major,
          ry: primitive.radmin,
          rotation: (Math.atan2(focus[1] - center[1], focus[0] - center[0]) * 180) / Math.PI,
        };
      }
      case 'bezier': {
        const points = entity.points.map((_, index) => point(pointId(entity.id, index)));
        if (points.some((candidate) => candidate === null)) return entity;
        return { ...entity, points: points as Point2[] };
      }
    }
  });
}

export { refKey };
