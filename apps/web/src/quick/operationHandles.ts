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
