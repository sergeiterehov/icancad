import type { MakePrimitiveParams } from '@icancad/kernel';
import type { PrimitiveFeature, PrimitiveKind, Vec3 } from '@icancad/model';

/** Smallest size worth building and the smallest a handle can leave. */
export const MIN_PRIMITIVE_SIZE = 0.1;
export const PYRAMID_MIN_SIDES = 3;
export const PYRAMID_MAX_SIDES = 120;

/** Sizes a primitive handle or the inspector can edit. */
export type PrimitiveSizeKey =
  | 'dx'
  | 'dy'
  | 'dz'
  | 'radius'
  | 'height'
  | 'bottomRadius'
  | 'topRadius'
  | 'majorRadius'
  | 'tubeRadius'
  | 'sides';

export function defaultPrimitiveFeature(
  kind: PrimitiveKind,
  name: string,
  id: string,
): PrimitiveFeature {
  const transform = {
    translation: [0, 0, 0] as Vec3,
    rotation: [0, 0, 0] as Vec3,
    scale: 1,
  };
  const base = { id, name, suppressed: false, type: 'primitive' as const, transform };
  switch (kind) {
    case 'box':
      return { ...base, kind, params: { dx: 20, dy: 20, dz: 20 } };
    case 'sphere':
      return { ...base, kind, params: { radius: 10 } };
    case 'cylinder':
      return { ...base, kind, params: { radius: 10, height: 20 } };
    case 'cone':
      return { ...base, kind, params: { bottomRadius: 10, topRadius: 0, height: 20 } };
    case 'torus':
      return { ...base, kind, params: { majorRadius: 20, tubeRadius: 5 } };
    case 'pyramid':
      return { ...base, kind, params: { sides: 4, radius: 10, height: 20 } };
    case 'capsule':
      return { ...base, kind, params: { radius: 5, height: 20 } };
  }
}

/** Keeps every primitive inside the range its kernel maker accepts. */
export function normalizePrimitive(feature: PrimitiveFeature): PrimitiveFeature {
  const size = (value: number, minimum = MIN_PRIMITIVE_SIZE) =>
    Number.isFinite(value) ? Math.max(minimum, value) : minimum;
  switch (feature.kind) {
    case 'box':
      return {
        ...feature,
        params: {
          dx: size(feature.params.dx),
          dy: size(feature.params.dy),
          dz: size(feature.params.dz),
        },
      };
    case 'sphere':
      return { ...feature, params: { radius: size(feature.params.radius) } };
    case 'cylinder':
      return {
        ...feature,
        params: {
          radius: size(feature.params.radius),
          height: size(feature.params.height),
        },
      };
    case 'cone':
      return {
        ...feature,
        params: {
          bottomRadius: size(feature.params.bottomRadius),
          topRadius: Number.isFinite(feature.params.topRadius)
            ? Math.max(0, feature.params.topRadius)
            : 0,
          height: size(feature.params.height),
        },
      };
    case 'torus': {
      const majorRadius = Math.max(MIN_PRIMITIVE_SIZE * 2, size(feature.params.majorRadius));
      const tubeRadius = Math.min(
        size(feature.params.tubeRadius),
        Math.max(MIN_PRIMITIVE_SIZE, majorRadius - MIN_PRIMITIVE_SIZE),
      );
      return { ...feature, params: { majorRadius, tubeRadius } };
    }
    case 'pyramid': {
      const sides = Number.isFinite(feature.params.sides)
        ? Math.round(feature.params.sides)
        : PYRAMID_MIN_SIDES;
      return {
        ...feature,
        params: {
          sides: Math.min(PYRAMID_MAX_SIDES, Math.max(PYRAMID_MIN_SIDES, sides)),
          radius: size(feature.params.radius),
          height: size(feature.params.height),
        },
      };
    }
    case 'capsule':
      return {
        ...feature,
        params: {
          radius: size(feature.params.radius),
          height: size(feature.params.height),
        },
      };
  }
}

export function primitiveParamValue(feature: PrimitiveFeature, key: PrimitiveSizeKey): number {
  return (feature.params as Record<string, number>)[key] ?? 0;
}

/** Patches one numeric parameter while keeping the primitive valid. */
export function withPrimitiveParam(
  feature: PrimitiveFeature,
  key: PrimitiveSizeKey,
  value: number,
): PrimitiveFeature {
  const params = { ...feature.params, [key]: value } as Record<string, number>;
  return normalizePrimitive({ ...feature, params } as PrimitiveFeature);
}

/**
 * Place of the translation gizmo: the anchor the inspector edits. It stays put
 * when a size changes, so dragging a size never moves the object's origin.
 */
export function primitiveGizmoOrigin(feature: PrimitiveFeature): Vec3 {
  return [...feature.transform.translation];
}

/** Request the kernel rebuilds a primitive from. */
export function primitiveKernelParams(
  feature: PrimitiveFeature,
  shapeId: string,
): MakePrimitiveParams {
  const at = feature.transform.translation;
  switch (feature.kind) {
    case 'box':
      return { kind: 'box', shapeId, at, ...feature.params };
    case 'sphere':
      return { kind: 'sphere', shapeId, at, ...feature.params };
    case 'cylinder':
      return { kind: 'cylinder', shapeId, at, ...feature.params };
    case 'cone':
      return { kind: 'cone', shapeId, at, ...feature.params };
    case 'torus':
      return { kind: 'torus', shapeId, at, ...feature.params };
    case 'pyramid':
      return { kind: 'pyramid', shapeId, at, ...feature.params };
    case 'capsule':
      return { kind: 'capsule', shapeId, at, ...feature.params };
  }
}
