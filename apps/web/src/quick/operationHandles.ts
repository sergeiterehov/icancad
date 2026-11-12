import type { TessellationResult } from '@icancad/kernel';
import type { ExtrudeFeature, Project, SketchFrame, Vec3 } from '@icancad/model';
import type { SelectionItem } from '../stores/documentStore';
import {
  QuickExtrudeDrag,
  type ExtrudeHandleAxis,
  type QuickBodySource,
} from './controller';
import {
  boundBodyFaceGeometry,
  findBoundExtrude,
  quickTargetFromSelection,
  resolveQuickTarget,
} from './target';
import { quickTargetKey, type QuickTargetGeometry } from './types';

/** A drag started by an operation handle. */
export interface OperationHandleDrag {
  readonly op: ExtrudeFeature['op'] | null;
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
  kind: 'extrude';
  origin: Vec3;
  direction: Vec3;
  /** Signed distance along `direction`; zero shows the idle affordance. */
  value: number;
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
  labels: {
    extrude: string;
    /** Prospective handle: what a drag will create. */
    create: string;
    /** Handle of an existing operation: what a drag changes. */
    distance: string;
    /** Handle of the second, opposite direction. */
    secondDistance: string;
  };
}

/**
 * Handles the current document and selection offer. Each operation type adds
 * its own provider here; the viewport never builds a handle itself.
 */
export function operationHandles(context: OperationHandleContext): OperationHandle[] {
  return extrudeHandles(context);
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
