import type {
  ParamValue,
  SketchConstraint,
  SketchEntity,
  SketchFeature,
  SketchMeasure,
} from '@icancad/model';
import { sketchEntityIndex, tessellateEntity, type Point2 } from '@icancad/sketch';
import { constraintEntityIds, refPoint } from './constraintModel';
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
import { referenceText } from './measure';

export type NumericConstraintType =
  | 'distance'
  | 'horizontal-distance'
  | 'vertical-distance'
  | 'angle'
  | 'arc-length'
  | 'radius'
  | 'diameter';

export interface DimensionAnnotation {
  id: string;
  text: string;
  point: Point2;
  offset: { x: number; y: number };
  entityIds: Set<string>;
  constraint: SketchConstraint;
}

const NUMERIC_TYPES = new Set<SketchConstraint['type']>([
  'distance',
  'horizontal-distance',
  'vertical-distance',
  'angle',
  'arc-length',
  'radius',
  'diameter',
]);

export function isNumericConstraint(constraint: SketchConstraint): boolean {
  return NUMERIC_TYPES.has(constraint.type);
}

function formatValue(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

function mid(a: Point2, b: Point2): Point2 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function lineIntersection(
  first: Extract<SketchEntity, { type: 'line' }>,
  second: Extract<SketchEntity, { type: 'line' }>,
): Point2 | null {
  const rx = first.x2 - first.x1;
  const ry = first.y2 - first.y1;
  const sx = second.x2 - second.x1;
  const sy = second.y2 - second.y1;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-9) return null;
  const dx = second.x1 - first.x1;
  const dy = second.y1 - first.y1;
  const t = (dx * sy - dy * sx) / denominator;
  return [first.x1 + t * rx, first.y1 + t * ry];
}

type SketchLine = Extract<SketchEntity, { type: 'line' }>;

/** The point of the line closest to `point`. */
function footOnLine(point: Point2, line: SketchLine): Point2 | null {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const length2 = dx * dx + dy * dy;
  if (length2 === 0) return null;
  const t = ((point[0] - line.x1) * dx + (point[1] - line.y1) * dy) / length2;
  return [line.x1 + dx * t, line.y1 + dy * t];
}

/** Halfway along the perpendicular from a point to a line. */
function perpendicularAnchor(point: Point2, line: SketchLine): Point2 | null {
  const foot = footOnLine(point, line);
  return foot ? mid(point, foot) : null;
}

function resolvedRefs(constraint: SketchConstraint, entities: Map<string, SketchEntity>) {
  return constraint.refs.map((ref) => ({ ref, entity: entities.get(ref.entityId) }));
}

/** Where a distance sits: on the shortest segment between the two targets. */
function distanceAnchor(
  constraint: SketchConstraint,
  entities: Map<string, SketchEntity>,
): Point2 | null {
  if (constraint.type !== 'distance' || constraint.refs.length !== 2) return null;
  const resolved = resolvedRefs(constraint, entities);
  const points = resolved
    .filter((entry) => isPointRef(entry.ref, entry.entity))
    .map((entry) => refPointOf(entry.ref, entry.entity))
    .filter((point): point is Point2 => point !== null);
  const lines = resolved.filter((entry) => isLineRef(entry.ref, entry.entity));
  const curves = resolved.filter((entry) => isCurveRef(entry.ref, entry.entity));
  if (points.length === 1 && lines.length === 1) {
    return perpendicularAnchor(points[0]!, lines[0]!.entity as SketchLine);
  }
  if (lines.length === 2) {
    const first = lines[0]!.entity as SketchLine;
    return perpendicularAnchor(canonicalLine(first).start, lines[1]!.entity as SketchLine);
  }
  if (points.length === 1 && curves.length === 1) {
    const closest = closestPointOnEntity(curves[0]!.entity!, points[0]!);
    return closest ? mid(points[0]!, closest.point) : null;
  }
  if (curves.length === 2) {
    const gap = curveCurveGap(curves[0]!.entity!, curves[1]!.entity!);
    return gap ? mid(gap.first, gap.second) : null;
  }
  return null;
}

/** Where a horizontal or vertical distance to a line or a curve sits. */
function axisAnchor(
  constraint: SketchConstraint,
  entities: Map<string, SketchEntity>,
  axis: DistanceAxis,
): Point2 | null {
  if (constraint.refs.length !== 2) return null;
  const resolved = resolvedRefs(constraint, entities);
  const points = resolved
    .filter((entry) => isPointRef(entry.ref, entry.entity))
    .map((entry) => refPointOf(entry.ref, entry.entity))
    .filter((point): point is Point2 => point !== null);
  if (points.length !== 1) return null;
  const target =
    resolved.find((entry) => isLineRef(entry.ref, entry.entity))?.entity ??
    resolved.find((entry) => isCurveRef(entry.ref, entry.entity))?.entity;
  if (!target) return null;
  const crossing = axisCrossingOnCurve(target, points[0]!, axis);
  return crossing ? mid(points[0]!, crossing) : null;
}

function arcMidpoint(entity: Extract<SketchEntity, { type: 'arc' }>): Point2 {
  const angle = entity.startAngle + (entity.endAngle - entity.startAngle) / 2;
  return [entity.cx + Math.cos(angle) * entity.r, entity.cy + Math.sin(angle) * entity.r];
}

function anchorPoint(
  constraint: SketchConstraint,
  entities: Map<string, SketchEntity>,
): Point2 | null {
  if (constraint.type === 'distance') {
    const anchored = distanceAnchor(constraint, entities);
    if (anchored) return anchored;
  }
  if (constraint.type === 'horizontal-distance' || constraint.type === 'vertical-distance') {
    const axis: DistanceAxis = constraint.type === 'horizontal-distance' ? 0 : 1;
    const anchored = axisAnchor(constraint, entities, axis);
    if (anchored) return anchored;
  }
  if (
    constraint.type === 'distance' ||
    constraint.type === 'horizontal-distance' ||
    constraint.type === 'vertical-distance'
  ) {
    if (constraint.refs.length === 1) {
      const entity = entities.get(constraint.refs[0]!.entityId);
      return entity?.type === 'line' ? mid([entity.x1, entity.y1], [entity.x2, entity.y2]) : null;
    }
    const first = constraint.refs[0] ? refPoint(constraint.refs[0], entities) : null;
    const second = constraint.refs[1] ? refPoint(constraint.refs[1], entities) : null;
    return first && second ? mid(first, second) : null;
  }
  if (constraint.type === 'arc-length') {
    const entity = entities.get(constraint.refs[0]?.entityId ?? '');
    return entity?.type === 'arc' ? arcMidpoint(entity) : null;
  }
  if (constraint.type === 'angle' && constraint.refs.length === 1) {
    const entity = entities.get(constraint.refs[0]!.entityId);
    if (entity?.type === 'arc') return arcMidpoint(entity);
    if (entity?.type === 'elliptical-arc') {
      const curve = tessellateEntity(entity, 32);
      return curve[Math.floor(curve.length / 2)] ?? null;
    }
    return null;
  }
  if (constraint.type === 'angle') {
    const lines = constraint.refs
      .map((ref) => entities.get(ref.entityId))
      .filter(
        (entity): entity is Extract<SketchEntity, { type: 'line' }> => entity?.type === 'line',
      );
    if (lines.length !== 2) return null;
    return (
      lineIntersection(lines[0]!, lines[1]!) ??
      mid(
        mid([lines[0]!.x1, lines[0]!.y1], [lines[0]!.x2, lines[0]!.y2]),
        mid([lines[1]!.x1, lines[1]!.y1], [lines[1]!.x2, lines[1]!.y2]),
      )
    );
  }
  if (constraint.type === 'radius' || constraint.type === 'diameter') {
    const entity = entities.get(constraint.refs[0]!.entityId);
    if (entity?.type === 'circle') {
      const angle = Math.PI / 4;
      return [entity.cx + Math.cos(angle) * entity.r, entity.cy + Math.sin(angle) * entity.r];
    }
    if (entity?.type === 'arc') {
      const angle = entity.startAngle + (entity.endAngle - entity.startAngle) / 2;
      return [entity.cx + Math.cos(angle) * entity.r, entity.cy + Math.sin(angle) * entity.r];
    }
  }
  return null;
}

function valueOf(value: ParamValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function annotationText(constraint: SketchConstraint, locale: string): string {
  const number = valueOf(constraint.value);
  if (number === undefined) return '—';
  const value = formatValue(number, locale);
  switch (constraint.type) {
    case 'angle':
      return `${value}°`;
    case 'radius':
      return `R ${value} mm`;
    case 'diameter':
      return `Ø ${value} mm`;
    default:
      return `${value} mm`;
  }
}

function annotationOffset(constraint: SketchConstraint): { x: number; y: number } {
  switch (constraint.type) {
    case 'vertical-distance':
      return { x: 30, y: 0 };
    case 'radius':
    case 'diameter':
      return { x: 20, y: -18 };
    case 'angle':
      return { x: 0, y: -26 };
    default:
      return { x: 0, y: -22 };
  }
}

export interface ReferenceAnnotation {
  id: string;
  text: string;
  point: Point2;
  offset: { x: number; y: number };
  entityId: string;
  measure: SketchMeasure;
}

const EQUIVALENT_CONSTRAINTS: Partial<Record<SketchMeasure, SketchConstraint['type']>> = {
  length: 'distance',
  radius: 'radius',
  diameter: 'diameter',
};

function referenceAnchor(entity: SketchEntity, measure: SketchMeasure): Point2 | null {
  switch (measure) {
    case 'x':
    case 'y':
      return entity.type === 'point' ? [entity.x, entity.y] : null;
    case 'length':
      if (entity.type === 'line') return mid([entity.x1, entity.y1], [entity.x2, entity.y2]);
      if (entity.type === 'arc') return arcMidpoint(entity);
      if (entity.type === 'bezier' || entity.type === 'elliptical-arc') {
        const curve = tessellateEntity(entity, 32);
        return curve[Math.floor(curve.length / 2)] ?? null;
      }
      return null;
    case 'angle':
      if (entity.type === 'line') return mid([entity.x1, entity.y1], [entity.x2, entity.y2]);
      if (entity.type === 'arc') {
        const angle = entity.startAngle + (entity.endAngle - entity.startAngle) / 2;
        return [entity.cx + Math.cos(angle) * entity.r, entity.cy + Math.sin(angle) * entity.r];
      }
      if (entity.type === 'elliptical-arc') {
        const curve = tessellateEntity(entity, 32);
        return curve[Math.floor(curve.length / 2)] ?? null;
      }
      return null;
    case 'radius':
    case 'diameter':
      if (entity.type === 'circle') {
        const angle = Math.PI / 4;
        return [entity.cx + Math.cos(angle) * entity.r, entity.cy + Math.sin(angle) * entity.r];
      }
      if (entity.type === 'arc') {
        const angle = entity.startAngle + (entity.endAngle - entity.startAngle) / 2;
        return [entity.cx + Math.cos(angle) * entity.r, entity.cy + Math.sin(angle) * entity.r];
      }
      return null;
    case 'rx': {
      if (entity.type === 'ellipse') return [entity.cx + entity.rx, entity.cy];
      if (entity.type !== 'elliptical-arc') return null;
      const angle = (entity.rotation * Math.PI) / 180;
      return [entity.cx + Math.cos(angle) * entity.rx, entity.cy + Math.sin(angle) * entity.rx];
    }
    case 'ry': {
      if (entity.type === 'ellipse') return [entity.cx, entity.cy + entity.ry];
      if (entity.type !== 'elliptical-arc') return null;
      const angle = (entity.rotation * Math.PI) / 180;
      return [entity.cx - Math.sin(angle) * entity.ry, entity.cy + Math.cos(angle) * entity.ry];
    }
  }
}

export function referenceAnnotations(
  feature: SketchFeature,
  locale: string,
  unit: string,
): ReferenceAnnotation[] {
  const entities = new Map(feature.entities.map((entity) => [entity.id, entity]));
  const annotations: ReferenceAnnotation[] = [];
  const order: SketchMeasure[] = ['angle', 'length', 'radius', 'diameter', 'x', 'y', 'rx', 'ry'];
  const references = [...(feature.references ?? [])].sort(
    (a, b) => order.indexOf(a.measure) - order.indexOf(b.measure),
  );
  for (const reference of references) {
    const entity = entities.get(reference.entityId);
    if (!entity) continue;
    const equivalents: SketchConstraint['type'][] =
      entity.type === 'arc' && reference.measure === 'length'
        ? ['arc-length']
        : entity.type === 'arc' && reference.measure === 'angle'
          ? ['angle']
          : EQUIVALENT_CONSTRAINTS[reference.measure]
            ? [EQUIVALENT_CONSTRAINTS[reference.measure]!]
            : [];
    if (
      equivalents.some((equivalent) =>
        feature.constraints.some(
          (constraint) =>
            constraint.type === equivalent &&
            constraint.refs.some((ref) => ref.entityId === reference.entityId),
        ),
      )
    ) {
      continue;
    }
    const text = referenceText(entity, reference.measure, locale, unit);
    const point = referenceAnchor(entity, reference.measure);
    if (!text || !point) continue;
    annotations.push({
      id: reference.id,
      text,
      point,
      offset: annotationOffset({ type: 'distance' } as SketchConstraint),
      entityId: reference.entityId,
      measure: reference.measure,
    });
  }
  return annotations;
}

export function dimensionAnnotations(
  feature: SketchFeature,
  locale: string,
): DimensionAnnotation[] {
  const entities = sketchEntityIndex(feature.entities);
  const annotations: DimensionAnnotation[] = [];
  for (const constraint of feature.constraints) {
    if (!isNumericConstraint(constraint)) continue;
    const point = anchorPoint(constraint, entities);
    if (!point) continue;
    annotations.push({
      id: constraint.id,
      text: annotationText(constraint, locale),
      point,
      offset: annotationOffset(constraint),
      entityIds: constraintEntityIds(constraint),
      constraint,
    });
  }
  return annotations;
}
