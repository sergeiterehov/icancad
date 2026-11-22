import type { Constraint, SketchPrimitive } from '@salusoft89/planegcs';
import type {
  ParamValue,
  SketchConstraint,
  SketchConstraintRef,
  SketchEntity,
} from '@icancad/model';
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
import {
  axisCrossingOnCurve,
  canonicalLine,
  closestPointOnEntity,
  curveCurveGap,
  isCurveRef,
  isLineRef,
  isPointRef,
  refPointOf,
  type DistanceAxis,
} from './distance';
import type { SolverPin } from './protocol';

const pointId = (entityId: string, index: number): string => `${entityId}~p${index}`;

/** A focus of an ellipse, which sits on its longer axis, a quarter turn on when Y is longer. */
function ellipseFocusOf(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotationDegrees: number,
): Point2 {
  const major = Math.max(rx, ry);
  const minor = Math.min(rx, ry);
  const distance = Math.sqrt(Math.max(0, major * major - minor * minor));
  const angle = ((rotationDegrees + (rx >= ry ? 0 : 90)) * Math.PI) / 180;
  return [cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance];
}

function ellipseFocus(entity: Extract<SketchEntity, { type: 'ellipse' }>): Point2 {
  return ellipseFocusOf(entity.cx, entity.cy, entity.rx, entity.ry, entity.rotation);
}

/** How far the focus (major) axis is turned from the entity's own X axis. */
function ellipticalArcFocusShift(
  entity: Extract<SketchEntity, { type: 'elliptical-arc' }>,
): number {
  return entity.rx >= entity.ry ? 0 : Math.PI / 2;
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

export interface SolverPrimitives {
  primitives: SketchPrimitive[];
  entities: Map<string, SketchEntity>;
}

export function buildSolverPrimitives(
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  pinned: SolverPin[] = [],
  derived: Iterable<string> = [],
): SolverPrimitives {
  // Derived (projected) geometry is determined by its source, so the solver
  // never moves it: constraints pull the other side towards it.
  const derivedIds = new Set(derived);
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
        fixed: fixed.has(id) || derivedIds.has(entity.id),
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
          fixed: fixed.has(entity.id) || derivedIds.has(entity.id),
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
        // The radius handle is how a circle is resized and dragged; the solver
        // needs a real point there for a drag pin to keep it under the pointer.
        const handle = point(1);
        primitives.push({
          id: entity.id,
          type: 'circle',
          c_id: center,
          radius: entity.r,
        } as SketchPrimitive);
        primitives.push({
          id: `${entity.id}~radius-handle`,
          type: 'point_on_circle',
          p_id: handle,
          c_id: entity.id,
        } as Constraint);
        // Keep the handle level with the centre: it represents the radius, not
        // an arbitrary angle on the circle, and adds no degree of freedom.
        primitives.push({
          id: `${entity.id}~radius-axis`,
          type: 'horizontal_pp',
          p1_id: center,
          p2_id: handle,
        } as Constraint);
        break;
      }
      case 'arc': {
        const center = point(0);
        const start = point(1);
        const end = point(2);
        // planegcs arcs always run counter-clockwise from start to end. A
        // clockwise sketch arc is the same curve traversed the other way, so
        // the solver sees its endpoints swapped; otherwise arc length, angle
        // and point-on-arc would describe the complementary reflex arc.
        const reversed = entity.endAngle < entity.startAngle;
        primitives.push({
          id: entity.id,
          type: 'arc',
          c_id: center,
          radius: entity.r,
          start_angle: reversed ? entity.endAngle : entity.startAngle,
          end_angle: reversed ? entity.startAngle : entity.endAngle,
          start_id: reversed ? end : start,
          end_id: reversed ? start : end,
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
      case 'elliptical-arc': {
        const center = point(0);
        const major = point(1);
        const minor = point(2);
        const start = point(3);
        const end = point(4);
        const focus = ellipseFocusOf(entity.cx, entity.cy, entity.rx, entity.ry, entity.rotation);
        const focusId = pointId(entity.id, 5);
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
          id: `${entity.id}~axes`,
          type: 'perpendicular_ll',
          l1_id: majorLine,
          l2_id: minorLine,
        } as Constraint);
        // Both semi-axis handles are points on the ellipse, so coincidence,
        // fixation and dragging work without an arc-specific primitive.
        for (const [id, pointIdValue] of [
          ['~major-handle', major],
          ['~minor-handle', minor],
        ] as const) {
          primitives.push({
            id: `${entity.id}${id}`,
            type: 'point_on_ellipse',
            p_id: pointIdValue,
            e_id: entity.id,
          } as Constraint);
        }
        // The arc carries the two end points and the angle parameters the
        // sketch's angle constraint can drive. Its counter-clockwise pair
        // matches the ellipse primitive through the shared focus and radmin.
        const arcId = `${entity.id}~arc`;
        const angleShift = ellipticalArcFocusShift(entity);
        const arcStart = entity.startAngle - angleShift;
        const arcEnd = entity.endAngle - angleShift;
        const reversed = arcEnd < arcStart;
        primitives.push({
          id: arcId,
          type: 'arc_of_ellipse',
          c_id: center,
          focus1_id: focusId,
          radmin: Math.min(entity.rx, entity.ry),
          start_angle: reversed ? arcEnd : arcStart,
          end_angle: reversed ? arcStart : arcEnd,
          start_id: reversed ? end : start,
          end_id: reversed ? start : end,
        } as SketchPrimitive);
        primitives.push({
          id: `${entity.id}~arc-rules`,
          type: 'arc_of_ellipse_rules',
          a_id: arcId,
        } as Constraint);
        primitives.push({
          id: `${entity.id}~arc-radmin`,
          type: 'equal',
          param1: { o_id: arcId, prop: 'radmin' },
          param2: { o_id: entity.id, prop: 'radmin' },
        } as unknown as Constraint);
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
    const arcAngle = arcAnglePrimitives(constraint, entityMap);
    if (arcAngle) {
      primitives.push(...arcAngle);
      continue;
    }
    const signed = signedDistancePrimitives(constraint, entityMap);
    if (signed) {
      primitives.push(...signed);
      continue;
    }
    if (constraint.type === 'distance') {
      const shaped = curveDistancePrimitives(constraint, entityMap);
      if (shaped) {
        primitives.push(...shaped);
        continue;
      }
    }
    if (
      (constraint.type === 'horizontal-distance' || constraint.type === 'vertical-distance') &&
      constraint.refs.length === 2
    ) {
      const aligned = axisDistancePrimitives(constraint, entityMap);
      if (aligned) {
        primitives.push(...aligned);
        continue;
      }
    }
    const mapped = mapConstraint(constraint, entityMap);
    if (mapped) primitives.push(mapped);
  }
  primitives.push(...axisPins);
  return { primitives, entities: entityMap };
}

function valueOf(value: ParamValue | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function resolvedConstraintRefs(
  constraint: SketchConstraint,
  entityMap: Map<string, SketchEntity>,
): Array<{ ref: SketchConstraint['refs'][number]; entity: SketchEntity | undefined }> {
  return constraint.refs.map((ref) => ({ ref, entity: entityMap.get(ref.entityId) }));
}

function resolvedPointId(
  ref: SketchConstraint['refs'][number],
  entity: SketchEntity | undefined,
): string | null {
  return pointRefId(ref, entity);
}

function onCurveConstraint(id: string, entity: SketchEntity, pointId: string): Constraint {
  switch (entity.type) {
    case 'line':
      return { id, type: 'point_on_line_pl', p_id: pointId, l_id: entity.id } as Constraint;
    case 'circle':
      return { id, type: 'point_on_circle', p_id: pointId, c_id: entity.id } as Constraint;
    case 'arc':
      return { id, type: 'point_on_arc', p_id: pointId, a_id: entity.id } as Constraint;
    case 'ellipse':
    case 'elliptical-arc':
      return { id, type: 'point_on_ellipse', p_id: pointId, e_id: entity.id } as Constraint;
    default:
      return { id, type: 'point_on_line_pl', p_id: pointId, l_id: entity.id } as Constraint;
  }
}

function projectToLine(point: Point2, line: Extract<SketchEntity, { type: 'line' }>): Point2 {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const length2 = dx * dx + dy * dy;
  if (length2 === 0) return [line.x1, line.y1];
  const t = ((point[0] - line.x1) * dx + (point[1] - line.y1) * dy) / length2;
  return [line.x1 + dx * t, line.y1 + dy * t];
}

/**
 * A point-to-line or point-to-circle distance that remembers its side. The
 * unsigned planegcs primitives would happily let the point jump across the
 * line; an auxiliary foot and a signed angle keep it where it was created.
 */
function signedDistancePrimitives(
  constraint: SketchConstraint,
  entityMap: Map<string, SketchEntity>,
): SketchPrimitive[] | null {
  if (constraint.type !== 'distance' || constraint.side === undefined) return null;
  if (constraint.refs.length !== 2) return null;
  const resolved = resolvedConstraintRefs(constraint, entityMap);
  const points = resolved.filter((entry) => isPointRef(entry.ref, entry.entity));
  const lines = resolved.filter((entry) => isLineRef(entry.ref, entry.entity));
  const curves = resolved.filter((entry) => isCurveRef(entry.ref, entry.entity));
  const value = valueOf(constraint.value);

  if (points.length === 1 && lines.length === 1) {
    const pointRef = points[0]!;
    const lineRef = lines[0]!;
    const point = refPointOf(pointRef.ref, pointRef.entity);
    const pointId = resolvedPointId(pointRef.ref, pointRef.entity);
    const line = lineRef.entity as Extract<SketchEntity, { type: 'line' }>;
    if (!point || !pointId) return null;
    return signedPointLine(constraint, pointId, point, line, value);
  }

  if (lines.length === 2) {
    const first = lines[0]!.entity as Extract<SketchEntity, { type: 'line' }>;
    const second = lines[1]!.entity as Extract<SketchEntity, { type: 'line' }>;
    return signedPointLine(constraint, pointId(first.id, 0), [first.x1, first.y1], second, value);
  }

  if (points.length === 1 && curves.length === 1) {
    const curve = curves[0]!.entity;
    if (curve?.type !== 'circle' && curve?.type !== 'arc') return null;
    const point = refPointOf(points[0]!.ref, points[0]!.entity);
    const pointPrimitiveId = resolvedPointId(points[0]!.ref, points[0]!.entity);
    if (!point || !pointPrimitiveId) return null;
    const center: Point2 = [curve.cx, curve.cy];
    const dx = point[0] - center[0];
    const dy = point[1] - center[1];
    const radial = Math.hypot(dx, dy);
    if (radial < 1e-9) return null;
    const contact: Point2 = [
      center[0] + (dx / radial) * curve.r,
      center[1] + (dy / radial) * curve.r,
    ];
    const contactId = `${constraint.id}~contact`;
    const radialId = `${constraint.id}~radial`;
    const normalId = `${constraint.id}~normal`;
    return [
      {
        id: contactId,
        type: 'point',
        x: contact[0],
        y: contact[1],
        fixed: false,
      } as SketchPrimitive,
      {
        id: radialId,
        type: 'line',
        p1_id: pointId(curve.id, 0),
        p2_id: contactId,
      } as SketchPrimitive,
      {
        id: normalId,
        type: 'line',
        p1_id: contactId,
        p2_id: pointPrimitiveId,
      } as SketchPrimitive,
      onCurveConstraint(`${constraint.id}~on`, curve, contactId),
      {
        id: constraint.id,
        type: 'p2p_distance',
        p1_id: pointPrimitiveId,
        p2_id: contactId,
        distance: value,
      } as Constraint,
      {
        id: `${constraint.id}~side`,
        type: 'l2l_angle_ll',
        l1_id: radialId,
        l2_id: normalId,
        angle: (constraint.side ?? 1) > 0 ? 0 : Math.PI,
      } as Constraint,
    ];
  }
  return null;
}

function signedPointLine(
  constraint: SketchConstraint,
  pointPrimitiveId: string,
  point: Point2,
  line: Extract<SketchEntity, { type: 'line' }>,
  value: number,
): SketchPrimitive[] {
  const foot = projectToLine(point, line);
  const footId = `${constraint.id}~foot`;
  const normalId = `${constraint.id}~normal`;
  // The stored side is relative to the canonical direction, so a projection
  // that comes back with its endpoints swapped keeps the same physical side.
  const flip = canonicalLine(line).flipped ? -1 : 1;
  const angle = (constraint.side ?? 1) * flip * (Math.PI / 2);
  return [
    { id: footId, type: 'point', x: foot[0], y: foot[1], fixed: false } as SketchPrimitive,
    { id: normalId, type: 'line', p1_id: footId, p2_id: pointPrimitiveId } as SketchPrimitive,
    {
      id: `${constraint.id}~on`,
      type: 'point_on_line_pl',
      p_id: footId,
      l_id: line.id,
    } as Constraint,
    {
      id: constraint.id,
      type: 'p2p_distance',
      p1_id: footId,
      p2_id: pointPrimitiveId,
      distance: value,
    } as Constraint,
    {
      id: `${constraint.id}~side`,
      type: 'l2l_angle_ll',
      l1_id: line.id,
      l2_id: normalId,
      angle,
    } as Constraint,
  ];
}

/** Point-to-curve and curve-to-curve distances that need an auxiliary point. */
function curveDistancePrimitives(
  constraint: SketchConstraint,
  entityMap: Map<string, SketchEntity>,
): SketchPrimitive[] | null {
  if (constraint.refs.length !== 2) return null;
  const resolved = resolvedConstraintRefs(constraint, entityMap);
  const curveEntries = resolved.filter((entry) => isCurveRef(entry.ref, entry.entity));
  const value = valueOf(constraint.value);

  if (curveEntries.length === 2) {
    const first = curveEntries[0]!.entity!;
    const second = curveEntries[1]!.entity!;
    if (
      (first.type === 'circle' || first.type === 'arc') &&
      (second.type === 'circle' || second.type === 'arc')
    ) {
      const centers = Math.hypot(second.cx - first.cx, second.cy - first.cy);
      // The native primitive is exact for a positive outer gap. Nested,
      // concentric and intersecting pairs have no positive outer gap, so they
      // go through contact points: the distance between the nearest points is
      // the radial or inner gap, or zero when the curves cross.
      if (centers > first.r + second.r + 1e-9) {
        return [
          {
            id: constraint.id,
            type: 'c2cdistance',
            c1_id: first.id,
            c2_id: second.id,
            dist: value,
          } as Constraint,
        ];
      }
    }
    const contact = curveCurveGap(first, second);
    if (!contact) return null;
    const firstId = `${constraint.id}~contact1`;
    const secondId = `${constraint.id}~contact2`;
    return [
      {
        id: firstId,
        type: 'point',
        x: contact.first[0],
        y: contact.first[1],
        fixed: false,
      } as SketchPrimitive,
      {
        id: secondId,
        type: 'point',
        x: contact.second[0],
        y: contact.second[1],
        fixed: false,
      } as SketchPrimitive,
      onCurveConstraint(`${constraint.id}~on1`, first, firstId),
      onCurveConstraint(`${constraint.id}~on2`, second, secondId),
      {
        id: constraint.id,
        type: 'p2p_distance',
        p1_id: firstId,
        p2_id: secondId,
        distance: value,
      } as Constraint,
    ];
  }

  const pointEntry = resolved.find((entry) => isPointRef(entry.ref, entry.entity));
  const curveEntry = curveEntries[0];
  if (!pointEntry || !curveEntry) return null;
  const curve = curveEntry.entity!;
  const point = refPointOf(pointEntry.ref, pointEntry.entity);
  const pointId = resolvedPointId(pointEntry.ref, pointEntry.entity);
  if (!point || !pointId) return null;
  if (curve.type === 'circle' || curve.type === 'arc') {
    return [
      {
        id: constraint.id,
        type: 'p2cdistance',
        p_id: pointId,
        c_id: curve.id,
        distance: value,
      } as Constraint,
    ];
  }
  const closest = closestPointOnEntity(curve, point);
  if (!closest) return null;
  const contactId = `${constraint.id}~contact`;
  return [
    {
      id: contactId,
      type: 'point',
      x: closest.point[0],
      y: closest.point[1],
      fixed: false,
    } as SketchPrimitive,
    onCurveConstraint(`${constraint.id}~on`, curve, contactId),
    {
      id: constraint.id,
      type: 'p2p_distance',
      p1_id: pointId,
      p2_id: contactId,
      distance: value,
    } as Constraint,
  ];
}

/** Horizontal/vertical distance, including the axis crossing of a line or a curve. */
function axisDistancePrimitives(
  constraint: SketchConstraint,
  entityMap: Map<string, SketchEntity>,
): SketchPrimitive[] | null {
  const resolved = resolvedConstraintRefs(constraint, entityMap);
  const pointEntries = resolved.filter((entry) => isPointRef(entry.ref, entry.entity));
  const points = pointEntries
    .map((entry) => refPointOf(entry.ref, entry.entity))
    .filter((point): point is Point2 => point !== null);
  const ids = pointEntries
    .map((entry) => resolvedPointId(entry.ref, entry.entity))
    .filter((id): id is string => id !== null);
  const horizontal = constraint.type === 'horizontal-distance';
  const value = valueOf(constraint.value);

  if (points.length === 2 && ids.length === 2) {
    const [first, second] = points as [Point2, Point2];
    const [p1, p2] = ids as [string, string];
    const auxId = `${constraint.id}~aux`;
    return [
      {
        id: auxId,
        type: 'point',
        x: horizontal ? second[0] : first[0],
        y: horizontal ? first[1] : second[1],
        fixed: false,
      } as SketchPrimitive,
      {
        id: `${constraint.id}~align1`,
        type: horizontal ? 'horizontal_pp' : 'vertical_pp',
        p1_id: p1,
        p2_id: auxId,
      } as Constraint,
      {
        id: `${constraint.id}~align2`,
        type: horizontal ? 'vertical_pp' : 'horizontal_pp',
        p1_id: auxId,
        p2_id: p2,
      } as Constraint,
      {
        id: constraint.id,
        type: 'p2p_distance',
        p1_id: p1,
        p2_id: auxId,
        distance: value,
      } as Constraint,
    ];
  }

  if (points.length !== 1 || ids.length !== 1) return null;
  const point = points[0]!;
  const pointId = ids[0]!;
  const target =
    resolved.find((entry) => isLineRef(entry.ref, entry.entity))?.entity ??
    resolved.find((entry) => isCurveRef(entry.ref, entry.entity))?.entity;
  if (!target) return null;
  const axis: DistanceAxis = horizontal ? 0 : 1;
  const crossing = axisCrossingOnCurve(target, point, axis);
  if (!crossing) return null;
  const auxId = `${constraint.id}~aux`;
  const primitives: SketchPrimitive[] = [
    {
      id: auxId,
      type: 'point',
      x: crossing[0],
      y: crossing[1],
      fixed: false,
    } as SketchPrimitive,
    onCurveConstraint(`${constraint.id}~on`, target, auxId),
  ];
  if (constraint.side !== undefined) {
    const lineId = `${constraint.id}~axis`;
    primitives.push(
      { id: lineId, type: 'line', p1_id: auxId, p2_id: pointId } as SketchPrimitive,
      {
        id: constraint.id,
        type: 'p2p_distance',
        p1_id: auxId,
        p2_id: pointId,
        distance: value,
      } as Constraint,
      {
        id: `${constraint.id}~side`,
        type: 'l2l_angle_ll',
        l1_id: horizontal ? SKETCH_X_AXIS_ID : SKETCH_Y_AXIS_ID,
        l2_id: lineId,
        angle: (constraint.side ?? 1) > 0 ? 0 : Math.PI,
      } as Constraint,
    );
    return primitives;
  }
  primitives.push(
    {
      id: `${constraint.id}~align`,
      type: horizontal ? 'horizontal_pp' : 'vertical_pp',
      p1_id: pointId,
      p2_id: auxId,
    } as Constraint,
    {
      id: constraint.id,
      type: 'p2p_distance',
      p1_id: pointId,
      p2_id: auxId,
      distance: value,
    } as Constraint,
  );
  return primitives;
}

/** An arc angle is the directed angle between its two radii. */
function arcAnglePrimitives(
  constraint: SketchConstraint,
  entityMap: Map<string, SketchEntity>,
): SketchPrimitive[] | null {
  if (constraint.type !== 'angle' || constraint.refs.length !== 1) return null;
  const arc = entityMap.get(constraint.refs[0]!.entityId);
  if (arc?.type === 'elliptical-arc') {
    const magnitude = Math.abs((valueOf(constraint.value) * Math.PI) / 180);
    // The solver arc is built counter-clockwise, and `difference` measures
    // start minus end, so the sweep is its negation.
    return [
      {
        id: constraint.id,
        type: 'difference',
        param1: { o_id: `${arc.id}~arc`, prop: 'end_angle' },
        param2: { o_id: `${arc.id}~arc`, prop: 'start_angle' },
        difference: -magnitude,
      } as unknown as Constraint,
    ];
  }
  if (arc?.type !== 'arc') return null;
  const magnitude = Math.abs((valueOf(constraint.value) * Math.PI) / 180);
  // The sketch draws the signed sweep. planegcs measures the counter-clockwise
  // angle from the start radius, so a clockwise arc is the reflex angle there.
  const clockwise =
    constraint.side === -1 || (constraint.side === undefined && arc.endAngle < arc.startAngle);
  // A full turn is the same pair of radii as a zero angle; keep the turn.
  const angle = clockwise
    ? magnitude >= Math.PI * 2
      ? Math.PI * 2
      : Math.PI * 2 - magnitude
    : magnitude;
  const startRadiusId = `${constraint.id}~start-radius`;
  const endRadiusId = `${constraint.id}~end-radius`;
  return [
    {
      id: startRadiusId,
      type: 'line',
      p1_id: pointId(arc.id, 0),
      p2_id: pointId(arc.id, 1),
    } as SketchPrimitive,
    {
      id: endRadiusId,
      type: 'line',
      p1_id: pointId(arc.id, 0),
      p2_id: pointId(arc.id, 2),
    } as SketchPrimitive,
    {
      id: constraint.id,
      type: 'l2l_angle_ll',
      l1_id: startRadiusId,
      l2_id: endRadiusId,
      angle,
    } as Constraint,
  ];
}

function mapConstraint(
  constraint: SketchConstraint,
  entityMap: Map<string, SketchEntity>,
): Constraint | null {
  if (constraint.type === 'fix') return null;
  const refs = constraint.refs;
  const entity = (index: number) => entityMap.get(refs[index]!.entityId);
  const point = (index: number) => pointRefId(refs[index]!, entity(index));
  const value = valueOf(constraint.value);
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
      // The value is a magnitude in [0, 180]; the side says which way round the
      // second line goes. planegcs turns the first line onto the second by the
      // signed angle, so a magnitude alone would let it pick the mirror image.
      const magnitude = Math.abs(valueOf(constraint.value));
      const side = constraint.side === -1 ? -1 : 1;
      return {
        id,
        type: 'l2l_angle_ll',
        l1_id: refs[0]!.entityId,
        l2_id: refs[1]!.entityId,
        angle: (side * magnitude * Math.PI) / 180,
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
      if (refs.length === 2) {
        // A point and a line, or two parallel lines, measure the perpendicular
        // distance to the infinite line.
        const first = entity(0);
        const second = entity(1);
        const firstPoint = point(0);
        const secondPoint = point(1);
        const p2l = (p: string, l: string): Constraint =>
          ({ id, type: 'p2l_distance', p_id: p, l_id: l, distance: value }) as Constraint;
        if (firstPoint && second?.type === 'line') return p2l(firstPoint, second.id);
        if (secondPoint && first?.type === 'line') return p2l(secondPoint, first.id);
        if (first?.type === 'line' && second?.type === 'line') {
          const canonical = canonicalLine(first);
          return p2l(pointId(first.id, canonical.flipped ? 1 : 0), second.id);
        }
      }
      if (refs.length === 1) {
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
      }
      return null;
    }
    case 'arc-length': {
      const target = entity(0);
      if (target?.type !== 'arc') return null;
      return { id, type: 'arc_length', a_id: target.id, dist: value } as Constraint;
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
      // The point may be the centre of a circle or an arc, so the curve to lie
      // on is the other reference, not merely the first one of that kind.
      const circleRef = refs.find((ref) => {
        if (ref === pointRef) return false;
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
      const ellipseRef = refs.find((ref) => {
        const type = entityMap.get(ref.entityId)?.type;
        return ref !== pointRef && (type === 'ellipse' || type === 'elliptical-arc');
      });
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
        const axisX = point(pointId(entity.id, 1));
        const axisY = point(pointId(entity.id, 2));
        if (!center || !axisX || !axisY) return entity;
        // Both handles sit on the solved ellipse on perpendicular axes, so they
        // are its two semi-axes. Reading them back instead of the focus keeps
        // the authored frame, where the longer axis need not be the X one.
        const rx = Math.hypot(axisX[0] - center[0], axisX[1] - center[1]);
        const ry = Math.hypot(axisY[0] - center[0], axisY[1] - center[1]);
        if (!(rx > 1e-9) || !(ry > 1e-9)) return entity;
        return {
          ...entity,
          cx: center[0],
          cy: center[1],
          rx,
          ry,
          rotation: (Math.atan2(axisX[1] - center[1], axisX[0] - center[0]) * 180) / Math.PI,
        };
      }
      case 'elliptical-arc': {
        const center = point(pointId(entity.id, 0));
        const axisX = point(pointId(entity.id, 1));
        const axisY = point(pointId(entity.id, 2));
        const focus = point(pointId(entity.id, 5));
        if (!center || !axisX || !axisY || !focus) return entity;
        const rx = Math.hypot(axisX[0] - center[0], axisX[1] - center[1]);
        const ry = Math.hypot(axisY[0] - center[0], axisY[1] - center[1]);
        if (!(rx > 1e-9) || !(ry > 1e-9)) return entity;
        const rotation = Math.atan2(axisX[1] - center[1], axisX[0] - center[0]);
        // The arc primitive measures from the focus (major) axis; the entity
        // keeps the handle frame, which is a quarter turn away when the second
        // handle is the longer one.
        const focusRotation = Math.atan2(focus[1] - center[1], focus[0] - center[0]);
        const rawShift = focusRotation - rotation;
        const shift =
          Math.round(Math.atan2(Math.sin(rawShift), Math.cos(rawShift)) / (Math.PI / 2)) *
          (Math.PI / 2);
        const arc = map.get(`${entity.id}~arc`);
        const reversed = entity.endAngle < entity.startAngle;
        let startAngle = entity.startAngle;
        let endAngle = entity.endAngle;
        if (arc?.type === 'arc_of_ellipse') {
          const fromArc = reversed ? arc.end_angle : arc.start_angle;
          const toArc = reversed ? arc.start_angle : arc.end_angle;
          startAngle = unwrapAngle(fromArc + shift, entity.startAngle);
          endAngle = unwrapAngle(toArc + shift, entity.endAngle);
        }
        return {
          ...entity,
          cx: center[0],
          cy: center[1],
          rx,
          ry,
          rotation: (rotation * 180) / Math.PI,
          startAngle,
          endAngle,
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
