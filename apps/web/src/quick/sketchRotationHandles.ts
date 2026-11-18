import { isDriven, type SketchFeature } from '@icancad/model';
import { sketchFrameBasis, sketchPlaneReady, sketchRotationAngles } from '../sketch/sectionPlane';
import { sketchRotationRings } from '../sketch/rotation';
import { resolvedFeatureFor } from '../stores/formulaStore';
import { SketchRotationDrag } from './controller';
import type { OperationHandle, OperationHandleContext } from './operationHandles';

const AXES = ['x', 'y', 'z'] as const;

/** The rings keep this radius on screen, whatever the sketch size or zoom. */
const RING_RADIUS_PX = 72;

/**
 * The rings that turn a sketch plane. They belong to the sketch operation, so
 * they appear when that operation is selected; while the sketch is edited the
 * viewport hides every operation handle.
 */
export function sketchRotationHandles(context: OperationHandleContext): OperationHandle[] {
  if (context.selection.length !== 1 || context.selection[0]?.kind !== 'feature') return [];
  const feature = context.project.features.find(
    (candidate): candidate is SketchFeature =>
      candidate.id === context.selection[0]?.id && candidate.type === 'sketch',
  );
  if (!feature || feature.suppressed || feature.plane.rotation === undefined) return [];
  if (!sketchPlaneReady(feature)) return [];

  const driven = resolvedFeatureFor(feature) ?? feature;
  const faceMesh =
    driven.plane.type === 'face' ? context.meshes[driven.plane.bodyId ?? ''] : undefined;
  const angles = sketchRotationAngles(driven);
  // The basis must not depend on the angle being dragged, or the rings would
  // drift under the pointer while the rebuild catches up. Rotation keeps the
  // anchor, so its origin is the ring centre too.
  const basis = sketchFrameBasis(driven, faceMesh);
  const origin = basis.origin;
  const labels = [
    context.labels.sketchRotateX,
    context.labels.sketchRotateY,
    context.labels.sketchRotateZ,
  ];

  return sketchRotationRings(basis, angles).map((ring, index) => {
    const axis = AXES[index]!;
    const rotationIndex = index as 0 | 1 | 2;
    const label = labels[index]!;
    return {
      id: `sketch-rotate:${feature.id}:${index}`,
      origin,
      direction: ring.axis,
      value: angles[rotationIndex],
      enabled: !isDriven(feature, `plane.rotation.${index}`),
      thickness: 1.2,
      tooltip: label,
      axis,
      arc: {
        axis: ring.axis,
        center: origin,
        reference: ring.reference,
        angle: ring.angle,
        radius: 0,
        radiusPx: RING_RADIUS_PX,
      },
      beginDrag: () => {
        const drag = new SketchRotationDrag(
          feature.id,
          rotationIndex,
          label,
          angles[rotationIndex],
        );
        drag.start();
        return drag;
      },
    };
  });
}
