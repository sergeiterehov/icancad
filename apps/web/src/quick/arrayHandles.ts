import {
  activeModel,
  isDriven,
  type ArrayDirection,
  type ArrayFeature,
  type Model,
  type Project,
  type Resolved,
  type ResolvedFeature,
  type SketchFeature,
  type Vec3,
} from '@icancad/model';
import {
  chainPolyline,
  isFullTurn,
  pointAlongPath,
  polylineLength,
  rotationAxisOf,
  rotationSpan,
  rotationStepDegrees,
  MAX_ARRAY_ANGLE,
  MAX_ARRAY_COPIES,
  type ArrayPlacementContext,
} from '../kernel/arrayPlacement';
import { previewArrayCopies } from '../kernel/rebuild';
import { useDocumentStore } from '../stores/documentStore';
import { liveProject, useLiveEditStore } from '../stores/liveEditStore';
import { resolvedFeatureFor } from '../stores/formulaStore';
import { useKernelStore } from '../stores/kernelStore';
import { snapLength } from './handleDrag';
import {
  resolvedFeature,
  type OperationHandle,
  type OperationHandleContext,
  type OperationHandleDrag,
} from './operationHandles';

/** What a grip of an array direction changes. */
type ArrayGrip = 'spacing' | 'count' | 'angle' | 'rotationCount' | 'pathCount';

/** The meshes and sketches a direction is read from, as the panel sees them. */
function placementContext(context: OperationHandleContext): ArrayPlacementContext {
  const allowed = new Set(context.project.features.map((feature) => feature.id));
  const sketches = context.resolvedProject
    ? context.resolvedProject.features.filter(
        (feature): feature is Extract<ResolvedFeature, { type: 'sketch' }> =>
          feature.type === 'sketch' && allowed.has(feature.id),
      )
    : context.project.features
        .filter((feature): feature is SketchFeature => feature.type === 'sketch')
        .map((feature) => resolvedFeatureFor(feature))
        .filter((feature): feature is NonNullable<typeof feature> => Boolean(feature));
  return {
    meshes: context.meshes,
    sketches,
    frames: context.sketchFrames,
  };
}

function unit(vector: Vec3): Vec3 | null {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length < 1e-9) return null;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** A perpendicular of `direction`, for the arc of an axis through the seed. */
function perpendicular(direction: Vec3): Vec3 {
  const helper: Vec3 = Math.abs(direction[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  return unit(cross(direction, helper)) ?? [1, 0, 0];
}

/**
 * The dial the rotation grips of one direction ride on. It is the circle the
 * copies themselves travel: its centre is the point of the axis nearest the
 * volume the array repeats, which is the centre of the array, and its radius is
 * the distance from there to the seed. Both grips then sit exactly on the ring
 * of copies instead of floating beside the seed.
 */
function rotationArc(
  axis: { origin: Vec3; direction: Vec3 },
  seed: Vec3,
): { axis: Vec3; center: Vec3; reference: Vec3; radius: number } {
  const offset: Vec3 = [
    seed[0] - axis.origin[0],
    seed[1] - axis.origin[1],
    seed[2] - axis.origin[2],
  ];
  const along =
    offset[0] * axis.direction[0] + offset[1] * axis.direction[1] + offset[2] * axis.direction[2];
  const radial: Vec3 = [
    offset[0] - axis.direction[0] * along,
    offset[1] - axis.direction[1] * along,
    offset[2] - axis.direction[2] * along,
  ];
  const distance = Math.hypot(radial[0], radial[1], radial[2]);
  return {
    axis: axis.direction,
    // The centre of the array: the axis point the seed turns around.
    center: [
      axis.origin[0] + axis.direction[0] * along,
      axis.origin[1] + axis.direction[1] * along,
      axis.origin[2] + axis.direction[2] * along,
    ],
    reference: unit(radial) ?? perpendicular(axis.direction),
    // A seed on the axis has no ring to ride; a small one keeps the grips apart.
    radius: distance > 1e-6 ? distance : 4,
  };
}

/** The point of an arc at `angle` radians from its reference direction. */
function arcPoint(
  arc: { axis: Vec3; center: Vec3; reference: Vec3; radius: number },
  angle: number,
): Vec3 {
  const tangent = cross(arc.axis, arc.reference);
  return [
    arc.center[0] +
      (arc.reference[0] * Math.cos(angle) + tangent[0] * Math.sin(angle)) * arc.radius,
    arc.center[1] +
      (arc.reference[1] * Math.cos(angle) + tangent[1] * Math.sin(angle)) * arc.radius,
    arc.center[2] +
      (arc.reference[2] * Math.cos(angle) + tangent[2] * Math.sin(angle)) * arc.radius,
  ];
}

/** The direction the arc runs in where the grip sits. */
function arcTangent(
  arc: { axis: Vec3; center: Vec3; reference: Vec3; radius: number },
  angle: number,
): Vec3 {
  const point = arcPoint(arc, angle);
  const radial: Vec3 = [
    point[0] - arc.center[0],
    point[1] - arc.center[1],
    point[2] - arc.center[2],
  ];
  return unit(cross(arc.axis, radial)) ?? arc.axis;
}

/**
 * The grips of every direction of the array. Each one starts at the volume the
 * copies repeat, so the grip is next to what it changes.
 */
export function arrayHandles(context: OperationHandleContext): OperationHandle[] {
  if (context.selection.length !== 1 || context.selection[0]?.kind !== 'feature') return [];
  const feature = context.project.features.find(
    (candidate) => candidate.id === context.selection[0]?.id,
  );
  if (!feature || feature.type !== 'array' || feature.suppressed) return [];
  const geometry = resolvedFeature(feature);
  if (!geometry) return [];
  const seed = context.arraySeed?.featureId === feature.id ? context.arraySeed.origin : null;
  if (!seed) return [];
  const placements = placementContext(context);
  const driven = (index: number, field: 'spacing' | 'count' | 'angle') =>
    isDriven(feature, `directions.${index}.${field}`);

  const handles: OperationHandle[] = [];
  geometry.directions.forEach((direction, index) => {
    const count = Math.max(1, Math.min(MAX_ARRAY_COPIES, Math.floor(direction.count)));
    if (direction.kind === 'linear') {
      const axis = unit(direction.direction);
      if (!axis) return;
      const spacing = direction.spacing;
      handles.push({
        id: `array:${feature.id}:${index}:step`,
        origin: seed,
        direction: axis,
        value: spacing,
        enabled: !driven(index, 'spacing'),
        thickness: 1.2,
        tooltip: context.labels.arraySpacing,
        beginDrag: () =>
          startDrag(feature.id, index, 'spacing', {
            step: 0,
            name: context.labels.arraySpacing,
          }),
      });
      // Without a step the grip cannot move: one step is what a copy is away.
      if (Math.abs(spacing) < 1e-6) return;
      handles.push({
        id: `array:${feature.id}:${index}:count`,
        origin: seed,
        direction: axis,
        value: spacing * (count - 1),
        enabled: !driven(index, 'count'),
        thickness: 1.2,
        kind: 'ball',
        tipOnly: true,
        tooltip: context.labels.arrayCount,
        beginDrag: () =>
          startDrag(feature.id, index, 'count', {
            step: spacing,
            name: context.labels.arrayCount,
          }),
      });
      return;
    }

    if (direction.kind === 'rotation') {
      const axis = rotationAxisOf(direction);
      if (!axis) return;
      const arc = rotationArc(axis, seed);
      // The copies turn by the span, which is the field's angle signed by
      // `inverted`; the dial is drawn the way the copies actually go.
      const turn = rotationSpan(direction);
      const span = (turn * Math.PI) / 180;
      // The count grip sits on the first copy: the angle between it and the
      // start is the step, so a smaller one packs more copies into the span.
      const step = (rotationStepDegrees(turn, count) * Math.PI) / 180;
      const firstCopy = arcPoint(arc, step);
      // The arrow ends where the last copy turns to: dragging it spans the
      // whole angle of the copies.
      handles.push({
        id: `array:${feature.id}:${index}:angle`,
        origin: arcPoint(arc, span),
        direction: arcTangent(arc, span),
        value: direction.angle,
        enabled: !driven(index, 'angle'),
        thickness: 1.2,
        tooltip: context.labels.arrayAngle,
        arc: { ...arc, angle: span },
        beginDrag: () =>
          startDrag(feature.id, index, 'angle', {
            step: 0,
            name: context.labels.arrayAngle,
            span: turn,
          }),
      });
      handles.push({
        id: `array:${feature.id}:${index}:count`,
        origin: firstCopy,
        direction: arcTangent(arc, step),
        value: count,
        enabled: !driven(index, 'count'),
        thickness: 1.2,
        tooltip: context.labels.arrayCount,
        orbit: { ...arc, angle: step },
        beginDrag: () =>
          startDrag(feature.id, index, 'rotationCount', {
            step: 0,
            name: context.labels.arrayCount,
            span: turn,
          }),
      });
      return;
    }

    // A path places its copies along the curves, so the count grip sits on the
    // first copy and the distance it is dragged to is the step.
    if (direction.paths.length === 0) return;
    let path;
    try {
      path = chainPolyline(direction.paths, placements);
    } catch {
      return;
    }
    if (!path) return;
    const total = polylineLength(path.points);
    if (total < 1e-6) return;
    // A closed run has no copy where it closes, so its copies divide the whole
    // of it; an open one puts its last copy on the far end.
    const gaps = path.closed ? count : Math.max(1, count - 1);
    const t = count > 1 ? 1 / gaps : 0;
    const start = path.points[0]!;
    const { tangent } = pointAlongPath(path, t);
    // The grip rides the shape of the run, drawn at the volume the array
    // repeats: the pointer is read where it meets that shape, so the count
    // follows the curve without the grip sitting out on the sketch it came
    // from. `value` is the length of the run up to the first copy.
    const trail: [number, number, number][] = path.points.map((point) => [
      point[0] - start[0] + seed[0],
      point[1] - start[1] + seed[1],
      point[2] - start[2] + seed[2],
    ]);
    handles.push({
      id: `array:${feature.id}:${index}:count`,
      origin: seed,
      direction: tangent,
      value: total * t,
      enabled: !driven(index, 'count'),
      thickness: 1.2,
      kind: 'ball',
      tipOnly: true,
      tooltip: context.labels.arrayCount,
      trail,
      beginDrag: () =>
        startDrag(feature.id, index, 'pathCount', {
          step: 0,
          name: context.labels.arrayCount,
          length: total,
          closed: path.closed,
        }),
    });
  });
  return handles.filter((handle) => handle.enabled);
}

function startDrag(
  featureId: string,
  index: number,
  grip: ArrayGrip,
  options: {
    step: number;
    name: string;
    span?: number;
    length?: number;
    scale?: number;
    closed?: boolean;
  },
): OperationHandleDrag {
  const drag = new ArrayDrag(featureId, index, grip, options);
  drag.start();
  return drag;
}

/**
 * Dragging one array grip: a step grows along the direction, an angle grows
 * around the axis, and a count grip jumps from one copy to the next by whole
 * steps.
 */
export class ArrayDrag implements OperationHandleDrag {
  private before: Project | null = null;
  private original: ArrayFeature | null = null;
  private resolved: Resolved<ArrayFeature> | null = null;
  private changed = false;
  private currentValue = 0;

  constructor(
    private readonly featureId: string,
    private readonly index: number,
    private readonly grip: ArrayGrip,
    private readonly options: {
      step: number;
      name: string;
      span?: number;
      length?: number;
      scale?: number;
      closed?: boolean;
    },
  ) {}

  get op(): null {
    return null;
  }

  get kind(): null {
    return null;
  }

  get value(): number {
    return this.currentValue;
  }

  get label(): string {
    return this.options.name;
  }

  get unit(): 'length' | 'count' | 'angle' {
    if (this.grip === 'angle') return 'angle';
    if (this.grip === 'spacing') return 'length';
    return 'count';
  }

  start(): void {
    const state = useDocumentStore.getState();
    this.before = state.project;
    const feature = arrayOf(activeModel(state.project), this.featureId);
    this.original = feature ?? null;
    this.resolved = feature ? (resolvedFeatureFor(feature) ?? null) : null;
    const direction = this.resolved?.directions[this.index];
    this.changed = false;
    this.currentValue = currentValueOf(direction, this.grip) ?? 0;
    useLiveEditStore.getState().begin('feature', this.featureId);
  }

  update(value: number): void {
    if (!this.before || !this.original) return;
    const state = useLiveEditStore.getState();
    const feature = arrayOf(activeModel(liveProject()), this.featureId);
    const direction = this.resolved?.directions[this.index];
    if (!feature || !direction || !this.resolved) return;
    const next = nextDirection(direction, this.grip, value, this.options);
    if (!next) return;
    const directions = [...feature.directions];
    // Only the dragged field becomes a number: the rest keep their formulas.
    directions[this.index] = withGrip(feature.directions[this.index]!, next, this.grip);
    const updated: ArrayFeature = { ...feature, directions };
    state.preview({ type: 'feature/replace', feature: updated });
    const resolvedDirections = [...this.resolved.directions];
    resolvedDirections[this.index] = next;
    this.resolved = { ...this.resolved, directions: resolvedDirections };
    // The copies are one volume already in memory: move them with the pointer
    // instead of waiting for the rebuild, which then only confirms them.
    const copies = previewArrayCopies(this.resolved);
    if (copies) useKernelStore.getState().setPreviewGhosts(updated.id, copies.ghosts);
    this.currentValue = currentValueOf(next, this.grip) ?? 0;
    this.changed = true;
  }

  end(): void {
    if (this.changed && this.before) useLiveEditStore.getState().finish(true);
    this.reset();
  }

  cancel(): void {
    useLiveEditStore.getState().finish(false);
    this.reset();
  }

  private reset(): void {
    this.before = null;
    this.original = null;
    this.resolved = null;
    this.changed = false;
    this.currentValue = 0;
  }
}

/** Applies what a grip changed to the authored direction. */
function withGrip(
  authored: ArrayDirection,
  next: Resolved<ArrayDirection>,
  grip: ArrayGrip,
): ArrayDirection {
  if (grip === 'spacing' && next.kind === 'linear' && authored.kind === 'linear') {
    return { ...authored, spacing: next.spacing };
  }
  if (grip === 'angle' && next.kind === 'rotation' && authored.kind === 'rotation') {
    return { ...authored, angle: next.angle, inverted: next.inverted };
  }
  return { ...authored, count: next.count };
}

/** The direction a grip drag produces, or null when it would change nothing. */
function nextDirection(
  direction: Resolved<ArrayDirection>,
  grip: ArrayGrip,
  value: number,
  options: {
    step: number;
    span?: number;
    length?: number;
    scale?: number;
    closed?: boolean;
  },
): Resolved<ArrayDirection> | null {
  if (!Number.isFinite(value)) return null;
  if (grip === 'spacing' && direction.kind === 'linear') {
    return { ...direction, spacing: snapLength(value) };
  }
  if (grip === 'count' && direction.kind === 'linear') {
    return { ...direction, count: copiesAt(Math.abs(value), options.step) };
  }
  if (grip === 'angle' && direction.kind === 'rotation') {
    // A drag the other way round is not a negative angle: it is the same span
    // turned backwards, so the field keeps showing a number without a sign.
    const span = Math.max(0, Math.min(MAX_ARRAY_ANGLE, snapAngle(Math.abs(value))));
    return { ...direction, angle: span, inverted: value < 0 };
  }
  if (grip === 'rotationCount' && direction.kind === 'rotation') {
    // The grip is dragged around the axis: the angle between it and the start
    // is the step, so a smaller angle packs more copies into the same span.
    return {
      ...direction,
      count: copiesInSpan(Math.abs(value), options.span ?? 0, isFullTurn(options.span ?? 0)),
    };
  }
  if (grip === 'pathCount' && direction.kind === 'path') {
    // The grip is dragged along the path: the distance is the step, so the
    // copies cover the same path more densely the closer it is to the start.
    const step = Math.abs(value) * (options.scale ?? 1);
    return {
      ...direction,
      count: copiesInSpan(step, options.length ?? 0, options.closed === true),
    };
  }
  return null;
}

function currentValueOf(
  direction: Resolved<ArrayDirection> | undefined,
  grip: ArrayGrip,
): number | null {
  if (!direction) return null;
  switch (grip) {
    case 'spacing':
      return direction.kind === 'linear' ? direction.spacing : null;
    case 'angle':
      return direction.kind === 'rotation' ? direction.angle : null;
    case 'count':
    case 'rotationCount':
    case 'pathCount':
      return direction.count;
  }
}

function snapAngle(value: number): number {
  // Degrees, to a tenth, so a drag does not invent noise in the stored angle.
  return Math.round(value * 10) / 10;
}

function arrayOf(project: Model, featureId: string): ArrayFeature | undefined {
  const feature = project.features.find((candidate) => candidate.id === featureId);
  return feature?.type === 'array' ? feature : undefined;
}

/** How many copies a grip dragged to `distance` asks for. */
function copiesAt(distance: number, step: number): number {
  if (Math.abs(step) < 1e-6) return 1;
  const count = Math.round(distance / step) + 1;
  return Math.max(1, Math.min(MAX_ARRAY_COPIES, count));
}

/**
 * How many copies a step of `step` fits into `span`: the grip that sets the step
 * of a rotation or a path counts the copies the whole run holds.
 */
function copiesInSpan(step: number, span: number, closed: boolean): number {
  if (Math.abs(step) < 1e-6 || Math.abs(span) < 1e-6) return 1;
  // A full turn or a closed path has no copy at its end, so the step divides the
  // run itself; anything else leaves the last copy on the far end.
  const count = Math.abs(span) / Math.abs(step) + (closed ? 0 : 1);
  return Math.max(1, Math.min(MAX_ARRAY_COPIES, Math.round(count)));
}
