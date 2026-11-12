import type { TessellationResult } from '@icancad/kernel';
import type {
  EdgeTreatmentFeature,
  EdgeTreatmentKind,
  ExtrudeFeature,
  Project,
  SketchFrame,
  Vec3,
} from '@icancad/model';
import type { SelectionItem } from '../stores/documentStore';
import {
  QuickEdgeTreatmentDrag,
  QuickExtrudeDrag,
  type ExtrudeHandleAxis,
  type QuickBodySource,
} from './controller';
import {
  edgeTreatmentGeometry,
  edgeTreatmentLimit,
  edgeTreatmentTargetFromSelection,
  findBoundEdgeTreatment,
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
  /** Edge treatment side while the gesture runs. */
  readonly kind: EdgeTreatmentKind | null;
  /** Signed size the operation currently has. */
  readonly value: number;
  update(value: number): void;
  end(): void;
  cancel(): void;
}

/**
 * A 3D affordance offered by an operation. The viewport only draws, hovers and
 * hit-tests it; creating or editing the operation is the operation's business.
 */
export interface OperationHandle {
  id: string;
  kind: 'extrude' | 'track';
  origin: Vec3;
  direction: Vec3;
  /** Signed distance along `direction`; zero shows the idle affordance. */
  value: number;
  /** Track only: the value at either end of the arc. */
  limit?: number;
  /** Track only: reach it from `origin` with a dashed leader. */
  leader?: boolean;
  enabled: boolean;
  tooltip: string;
  beginDrag(): OperationHandleDrag;
}

export interface OperationHandleContext {
  project: Project;
  selection: readonly SelectionItem[];
  meshes: Record<string, TessellationResult>;
  sketchFrames: Record<string, SketchFrame>;
  bodies: readonly QuickBodySource[];
  /** Size the kernel applied to an edge treatment, keyed by operation. */
  limits: Record<string, { requested: number; applied: number }>;
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
    edgeTreatmentTooltip: string;
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
    kind: 'extrude',
    origin: geometry.origin,
    direction: axis === 'second' ? [0 - x, 0 - y, 0 - z] : geometry.direction,
    value: feature
      ? axis === 'second'
        ? feature.secondDirection?.distance ?? 0
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

function extrudeHandles(context: OperationHandleContext): OperationHandle[] {
  // A focused operation owns its handle: dragging it changes that operation.
  const focused = selectedExtrude(context);
  if (focused) {
    const geometry = featureGeometry(focused, context);
    return geometry
      ? extrudeHandlesFor(geometry, context, focused, context.labels.distance)
      : [];
  }

  // A selected face or sketch offers the operation that could be created from
  // it. If that input already belongs to an operation, its handle is offered
  // instead, so the method cannot be changed by dragging.
  const target = quickTargetFromSelection(context.project, context.selection);
  if (!target) return [];
  const bound = findBoundExtrude(context.project, target);
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

function selectedEdgeTreatment(
  context: OperationHandleContext,
): EdgeTreatmentFeature | undefined {
  if (context.selection.length !== 1 || context.selection[0]?.kind !== 'feature') return undefined;
  const feature = context.project.features.find(
    (candidate) => candidate.id === context.selection[0]?.id,
  );
  return feature?.type === 'edge-treatment' && !feature.suppressed ? feature : undefined;
}

/** Geometry of an operation from its own stored refs, independent of renaming. */
function featureTreatmentGeometry(
  feature: EdgeTreatmentFeature,
): EdgeTreatmentGeometry | null {
  return edgeTreatmentGeometry({
    faceRefs: feature.faceRefs,
    edgeRefs: feature.edgeRefs,
  });
}

function treatmentHandle(
  geometry: EdgeTreatmentGeometry,
  context: OperationHandleContext,
  feature: EdgeTreatmentFeature | undefined,
  limit: number,
): OperationHandle {
  const kind = feature?.kind ?? null;
  // An operation that exists has no known ceiling any more: the geometry it
  // measured against is gone. Its own size becomes the middle of the track, so
  // the knob has room in both directions, and an operation the kernel had to
  // reduce stays pinned at the end instead.
  const applied = feature ? context.limits[feature.id]?.applied : undefined;
  const span =
    feature && applied !== undefined && applied < feature.size
      ? feature.size
      : feature
        ? Math.max(feature.size * 2, 0.001)
        : limit;
  return {
    id: feature ? `edge-treatment:${feature.id}` : `edge-treatment:new:${treatmentKey(geometry)}`,
    kind: 'track',
    origin: geometry.origin,
    direction: geometry.direction,
    // A fillet sits on the positive side of the track, a chamfer on the
    // negative one, so the knob shows which of the two the operation is.
    value: feature ? (kind === 'chamfer' ? -feature.size : feature.size) : 0,
    limit: span,
    leader: geometry.leader,
    enabled: true,
    tooltip: context.labels.edgeTreatmentTooltip,
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
 * The edge treatment offered by the selection. One track serves both kinds:
 * pulling it to the right rounds the corners, to the left it cuts them.
 */
function edgeTreatmentHandles(context: OperationHandleContext): OperationHandle[] {
  // A focused operation owns its track: dragging it changes that operation.
  const focused = selectedEdgeTreatment(context);
  if (focused) {
    const geometry = featureTreatmentGeometry(focused);
    if (!geometry) return [];
    return [treatmentHandle(geometry, context, focused, focused.size)];
  }

  const target = edgeTreatmentTargetFromSelection(
    context.project,
    context.selection,
    context.meshes,
  );
  if (!target) return [];
  const geometry = edgeTreatmentGeometry(target);
  if (!geometry) return [];
  const limit = edgeTreatmentLimit(target, context.meshes);
  if (limit === null) return [];
  const bound = findBoundEdgeTreatment(context.project, target);
  return [treatmentHandle(geometry, context, bound, limit)];
}
