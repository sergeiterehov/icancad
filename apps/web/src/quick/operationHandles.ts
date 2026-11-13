import type { TessellationResult } from '@icancad/kernel';
import {
  defaultRevolve,
  type EdgeTreatmentFeature,
  type EdgeTreatmentKind,
  type ExtrudeFeature,
  type Project,
  type SketchFeature,
  type SketchFrame,
  type Vec3,
} from '@icancad/model';
import type { SelectionItem } from '../stores/documentStore';
import type { SceneArcHandle } from '../viewport/handle';
import { resolveRevolveAxis, revolveAngles } from '../sketch/revolveAxis';
import {
  QuickEdgeTreatmentDrag,
  QuickExtrudeDrag,
  RevolveAngleDrag,
  type ExtrudeHandleAxis,
  type QuickBodySource,
} from './controller';
import {
  edgeTreatmentGeometry,
  edgeTreatmentLimit,
  edgeTreatmentTargetFromSelection,
  treatmentFaceOffset,
  type EdgeTreatmentGeometry,
} from './edgeTreatment';
import {
  boundBodyFaceGeometry,
  findBoundExtrude,
  quickTargetFromSelection,
  resolveQuickTarget,
} from './target';
import { quickTargetKey, type QuickTargetGeometry } from './types';

/** A drag started by an operation handle. */
export interface OperationHandleDrag {
  /** Extrude method while the gesture runs; the chip names it. */
  readonly op: ExtrudeFeature['op'] | null;
  /** Edge treatment kind while the gesture runs; the chip names it. */
  readonly kind: EdgeTreatmentKind | null;
  /** Value the operation currently has: the distance or the treatment size. */
  readonly value: number;
  /** Angle handles report degrees; every other handle reports millimetres. */
  readonly unit?: 'length' | 'angle';
  /** `shift` asks an edge treatment for the other kind while the grab lasts. */
  update(value: number, shift?: boolean): void;
  end(): void;
  cancel(): void;
}

/**
 * The extrude arrow is the bigger one: extrusion is the operation the viewport
 * offers most often, and the two arrows hang off the same faces.
 */
const EXTRUDE_ARROW_THICKNESS = 2;

/**
 * A 3D affordance offered by an operation. The viewport only draws, hovers and
 * hit-tests it; creating or editing the operation is the operation's business.
 */
export interface OperationHandle {
  id: string;
  origin: Vec3;
  direction: Vec3;
  /** Length along `direction`; zero shows the idle affordance. */
  value: number;
  enabled: boolean;
  /** How heavy the arrow is drawn, relative to the thinnest one. */
  thickness?: number;
  tooltip: string;
  /** Present on an angle handle: the grip turns around an axis. */
  arc?: SceneArcHandle;
  beginDrag(): OperationHandleDrag;
}

export interface OperationHandleContext {
  project: Project;
  selection: readonly SelectionItem[];
  meshes: Record<string, TessellationResult>;
  /**
   * Shape of each body before the edited operation, keyed by body id. The mesh
   * of a finished operation no longer holds the edge it treated, so its refs
   * are read here.
   */
  baseMeshes: Record<string, TessellationResult>;
  sketchFrames: Record<string, SketchFrame>;
  bodies: readonly QuickBodySource[];
  labels: {
    extrude: string;
    /** Prospective handle: what a drag will create. */
    create: string;
    /** Handle of an existing operation: what a drag changes. */
    distance: string;
    /** Handle of the second, opposite direction. */
    secondDistance: string;
    /** Name of the edge treatment operation. */
    edgeTreatment: string;
    /** What a fresh grab will create, and the modifier that switches it. */
    edgeTreatmentTooltip: string;
    /** What the handle of an existing operation changes. */
    edgeTreatmentRadiusTooltip: string;
    edgeTreatmentDistanceTooltip: string;
    /** The two ends of a revolve sweep. */
    revolveStart: string;
    revolveEnd: string;
  };
}

/**
 * Handles the current document and selection offer. Each operation type adds
 * its own provider here; the viewport never builds a handle itself.
 */
export function operationHandles(context: OperationHandleContext): OperationHandle[] {
  return [...extrudeHandles(context), ...edgeTreatmentHandles(context)];
}

function selectedExtrude(context: OperationHandleContext): ExtrudeFeature | undefined {
  if (context.selection.length !== 1 || context.selection[0]?.kind !== 'feature') return undefined;
  const feature = context.project.features.find(
    (candidate) => candidate.id === context.selection[0]?.id,
  );
  return feature?.type === 'extrude' && !feature.suppressed ? feature : undefined;
}

/** Geometry of the operation's own inputs, independent of face renumbering. */
function featureGeometry(
  feature: ExtrudeFeature,
  context: OperationHandleContext,
): QuickTargetGeometry | null {
  if (feature.faceRefs.length > 0) {
    const target = {
      kind: 'body-face' as const,
      bodyId: feature.faceRefs[0]!.bodyId,
      faceIds: feature.faceRefs.map((ref) => ref.faceId),
    };
    return boundBodyFaceGeometry(feature, target);
  }
  if (feature.sketchId) {
    const selection: SelectionItem[] =
      feature.scope === 'selected'
        ? feature.regions.map((region) => ({
            kind: 'face' as const,
            id: `${feature.sketchId}#${region}`,
          }))
        : [{ kind: 'sketch', id: feature.sketchId }];
    return resolveQuickTarget({
      project: context.project,
      selection,
      meshes: context.meshes,
      sketchFrames: context.sketchFrames,
    });
  }
  return null;
}

function extrudeHandle(
  geometry: QuickTargetGeometry,
  context: OperationHandleContext,
  feature: ExtrudeFeature | undefined,
  tooltip: string,
  axis: ExtrudeHandleAxis = 'primary',
): OperationHandle {
  const [x, y, z] = geometry.direction;
  return {
    id: feature
      ? axis === 'second'
        ? `extrude:${feature.id}:second`
        : `extrude:${feature.id}`
      : `extrude:new:${quickTargetKey(geometry.target)}`,
    origin: geometry.origin,
    direction: axis === 'second' ? [0 - x, 0 - y, 0 - z] : geometry.direction,
    thickness: EXTRUDE_ARROW_THICKNESS,
    value: feature
      ? axis === 'second'
        ? (feature.secondDirection?.distance ?? 0)
        : feature.reversed
          ? -feature.distance
          : feature.distance
      : 0,
    enabled: true,
    tooltip,
    beginDrag: () => {
      const drag = new QuickExtrudeDrag(
        geometry,
        context.bodies,
        context.labels.extrude,
        feature?.id,
        axis,
      );
      drag.start();
      return drag;
    },
  };
}

/**
 * A through-all extrusion has no free distance, so it offers no distance
 * handle; the operation is still edited in the inspector.
 */
function extrudeHandlesFor(
  geometry: QuickTargetGeometry,
  context: OperationHandleContext,
  feature: ExtrudeFeature | undefined,
  tooltip: string,
): OperationHandle[] {
  if (!feature) return [extrudeHandle(geometry, context, undefined, tooltip)];
  const handles: OperationHandle[] = [];
  if (feature.end !== 'through-all') {
    handles.push(extrudeHandle(geometry, context, feature, tooltip));
  }
  if (feature.secondDirection && feature.secondDirection.end !== 'through-all') {
    handles.push(
      extrudeHandle(geometry, context, feature, context.labels.secondDistance, 'second'),
    );
  }
  return handles;
}

/**
 * Where the angle handles of a revolve sit: on the circle the profile's
 * farthest point traces around the axis, so the handle starts at the profile
 * itself and turns with the sweep.
 */
interface RevolveArcFrame {
  center: Vec3;
  reference: Vec3;
  radius: number;
  axis: Vec3;
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalized(vector: Vec3): Vec3 | null {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(length) || length < 1e-9) return null;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function revolveArcFrame(
  axis: { origin: Vec3; direction: Vec3 },
  geometry: QuickTargetGeometry | null,
): RevolveArcFrame | null {
  const points = [
    ...(geometry?.samples ?? []),
    ...(geometry?.faces.map((face) => face.centroid) ?? []),
  ];
  let center = axis.origin;
  if (points.length > 0) {
    const average: Vec3 = [0, 0, 0];
    for (const point of points) {
      average[0] += point[0] / points.length;
      average[1] += point[1] / points.length;
      average[2] += point[2] / points.length;
    }
    const along = dot(subtract(average, axis.origin), axis.direction);
    center = [
      axis.origin[0] + axis.direction[0] * along,
      axis.origin[1] + axis.direction[1] * along,
      axis.origin[2] + axis.direction[2] * along,
    ];
  }
  let reference: Vec3 | null = null;
  let radius = 0;
  for (const point of points) {
    const offset = subtract(point, center);
    const radial = subtract(
      offset,
      axis.direction.map((value) => value * dot(offset, axis.direction)) as Vec3,
    );
    const length = Math.hypot(radial[0], radial[1], radial[2]);
    if (length <= radius) continue;
    const direction = normalized(radial);
    if (!direction) continue;
    radius = length;
    reference = direction;
  }
  if (!reference || radius < 1e-3) {
    // Without a profile to measure, any perpendicular direction will do.
    const helper: Vec3 = Math.abs(axis.direction[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    reference = normalized(cross(axis.direction, helper));
    radius = 10;
  }
  if (!reference) return null;
  return { center, reference, radius: radius * 1.05, axis: axis.direction };
}

function gripAt(frame: RevolveArcFrame, degrees: number): Vec3 {
  const angle = (degrees * Math.PI) / 180;
  const tangent = cross(frame.axis, frame.reference);
  return [
    frame.center[0] +
      (frame.reference[0] * Math.cos(angle) + tangent[0] * Math.sin(angle)) * frame.radius,
    frame.center[1] +
      (frame.reference[1] * Math.cos(angle) + tangent[1] * Math.sin(angle)) * frame.radius,
    frame.center[2] +
      (frame.reference[2] * Math.cos(angle) + tangent[2] * Math.sin(angle)) * frame.radius,
  ];
}

/** The two angle handles of a revolve, or none before its axis is picked. */
function revolveHandles(
  feature: ExtrudeFeature,
  context: OperationHandleContext,
): OperationHandle[] {
  const revolve = feature.revolve ?? defaultRevolve();
  const axis = resolveRevolveAxis(revolve.axis, {
    meshes: context.meshes,
    sketches: context.project.features.filter(
      (candidate): candidate is SketchFeature => candidate.type === 'sketch',
    ),
    frames: context.sketchFrames,
  });
  if (!axis) return [];
  const frame = revolveArcFrame(axis, featureGeometry(feature, context));
  if (!frame) return [];
  const angles = revolveAngles(revolve);
  const handles: OperationHandle[] = [];
  for (const which of ['start', 'end'] as const) {
    const degrees = angles[which];
    const grip = gripAt(frame, degrees);
    const tangent = normalized(cross(frame.axis, subtract(grip, frame.center)));
    handles.push({
      id: `revolve:${feature.id}:${which}`,
      origin: grip,
      direction: tangent ?? frame.axis,
      value: degrees,
      enabled: true,
      tooltip: which === 'start' ? context.labels.revolveStart : context.labels.revolveEnd,
      arc: {
        axis: frame.axis,
        center: frame.center,
        reference: frame.reference,
        angle: (degrees * Math.PI) / 180,
        radius: frame.radius,
      },
      beginDrag: () => {
        const drag = new RevolveAngleDrag(feature.id, which, revolve.inverted, degrees);
        drag.start();
        return drag;
      },
    });
  }
  return handles;
}

function extrudeHandles(context: OperationHandleContext): OperationHandle[] {
  // A focused operation owns its handle: dragging it changes that operation.
  const focused = selectedExtrude(context);
  if (focused) {
    if (focused.method === 'revolve') return revolveHandles(focused, context);
    const geometry = featureGeometry(focused, context);
    return geometry ? extrudeHandlesFor(geometry, context, focused, context.labels.distance) : [];
  }

  // A selected face or sketch offers the operation that could be created from
  // it. If that input already belongs to an operation, its handle is offered
  // instead, so the method cannot be changed by dragging.
  const target = quickTargetFromSelection(context.project, context.selection);
  if (!target) return [];
  const bound = findBoundExtrude(context.project, target);
  if (bound?.method === 'revolve') return revolveHandles(bound, context);
  const geometry =
    (bound && target.kind === 'body-face' ? boundBodyFaceGeometry(bound, target) : null) ??
    resolveQuickTarget({
      project: context.project,
      selection: context.selection,
      meshes: context.meshes,
      sketchFrames: context.sketchFrames,
    });
  if (!geometry) return [];
  return extrudeHandlesFor(
    geometry,
    context,
    bound,
    bound ? context.labels.distance : context.labels.create,
  );
}

function selectedEdgeTreatment(context: OperationHandleContext): EdgeTreatmentFeature | undefined {
  if (context.selection.length !== 1 || context.selection[0]?.kind !== 'feature') return undefined;
  const feature = context.project.features.find(
    (candidate) => candidate.id === context.selection[0]?.id,
  );
  return feature?.type === 'edge-treatment' && !feature.suppressed ? feature : undefined;
}

/** Geometry of an operation from its own stored refs, independent of renaming. */
function featureTreatmentGeometry(
  feature: EdgeTreatmentFeature,
  context: OperationHandleContext,
): EdgeTreatmentGeometry | null {
  return edgeTreatmentGeometry(
    { faceRefs: feature.faceRefs, edgeRefs: feature.edgeRefs },
    { ...context.meshes, ...context.baseMeshes },
  );
}

/**
 * The arrow of an edge treatment. Its length is the distance from the edge to
 * the face the operation creates, so the tip sits on that face and follows the
 * pointer; the size the operation stores is the radius or the leg distance.
 */
function treatmentHandle(
  geometry: EdgeTreatmentGeometry,
  context: OperationHandleContext,
  feature: EdgeTreatmentFeature | undefined,
): OperationHandle {
  const tooltip = !feature
    ? context.labels.edgeTreatmentTooltip
    : feature.kind === 'fillet'
      ? context.labels.edgeTreatmentRadiusTooltip
      : context.labels.edgeTreatmentDistanceTooltip;
  return {
    id: feature ? `edge-treatment:${feature.id}` : `edge-treatment:new:${treatmentKey(geometry)}`,
    origin: geometry.origin,
    direction: geometry.direction,
    value: feature ? treatmentFaceOffset(feature.kind, feature.size, geometry.wedge) : 0,
    enabled: true,
    tooltip,
    beginDrag: () => {
      const drag = new QuickEdgeTreatmentDrag(geometry, context.labels.edgeTreatment, feature?.id);
      drag.start();
      return drag;
    },
  };
}

function treatmentKey(geometry: EdgeTreatmentGeometry): string {
  const { target } = geometry;
  return [
    ...target.faceRefs.map((ref) => `${ref.bodyId}#${ref.faceId}`),
    ...target.edgeRefs.map((ref) => `${ref.bodyId}#${ref.edgeId}`),
  ].join(',');
}

/**
 * The edge treatment offered by the selection. Dragging the arrow cuts a
 * chamfer; holding shift rounds the corner instead, and the kind is fixed once
 * the grab ends.
 */
function edgeTreatmentHandles(context: OperationHandleContext): OperationHandle[] {
  // A focused operation owns its arrow: dragging it changes that operation.
  const focused = selectedEdgeTreatment(context);
  if (focused) {
    const geometry = featureTreatmentGeometry(focused, context);
    if (!geometry) return [];
    return [treatmentHandle(geometry, context, focused)];
  }

  // A selection always offers a new operation. An existing one is opened by
  // double-clicking a face it created, which hands the operation its own arrow.
  // The selection was picked on the input of the edited operation, so its
  // edges are read there and not on the renumbered result.
  const target = edgeTreatmentTargetFromSelection(context.project, context.selection, {
    ...context.meshes,
    ...context.baseMeshes,
  });
  if (!target) return [];
  const geometry = edgeTreatmentGeometry(target, context.meshes);
  if (!geometry) return [];
  // No arrow where no treatment fits: the operation would be invisible.
  if (edgeTreatmentLimit(target, context.meshes) === null) return [];
  return [treatmentHandle(geometry, context, undefined)];
}
