import type { SketchConstraint, SketchEntity, SketchFeature, SketchMeasure } from '@icancad/model';
import { sketchEntityIndex, tessellateEntity, type Point2 } from '@icancad/sketch';
import { constraintEntityIds, refPoint } from './constraintModel';
import { measureInfo } from './measure';

export type NumericConstraintType =
  'distance' | 'horizontal-distance' | 'vertical-distance' | 'angle' | 'radius' | 'diameter';

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

function anchorPoint(
  constraint: SketchConstraint,
  entities: Map<string, SketchEntity>,
): Point2 | null {
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

function annotationText(constraint: SketchConstraint, locale: string): string {
  const value = formatValue(constraint.value ?? 0, locale);
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
      if (entity.type === 'bezier') {
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
    case 'rx':
      return entity.type === 'ellipse' ? [entity.cx + entity.rx, entity.cy] : null;
    case 'ry':
      return entity.type === 'ellipse' ? [entity.cx, entity.cy + entity.ry] : null;
  }
}

export function referenceAnnotations(
  feature: SketchFeature,
  locale: string,
  unit: string,
): ReferenceAnnotation[] {
  const entities = new Map(feature.entities.map((entity) => [entity.id, entity]));
  const annotations: ReferenceAnnotation[] = [];
  for (const reference of feature.references ?? []) {
    const entity = entities.get(reference.entityId);
    if (!entity) continue;
    const equivalent = EQUIVALENT_CONSTRAINTS[reference.measure];
    if (
      equivalent &&
      feature.constraints.some(
        (constraint) =>
          constraint.type === equivalent &&
          constraint.refs.some((ref) => ref.entityId === reference.entityId),
      )
    ) {
      continue;
    }
    const info = measureInfo(entity, reference.measure, locale, unit);
    const point = referenceAnchor(entity, reference.measure);
    if (!info || !point) continue;
    annotations.push({
      id: reference.id,
      text: info.text,
      point,
      offset: annotationOffset({ type: 'distance' } as SketchConstraint),
      entityId: reference.entityId,
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
