import { isFormula, type Feature, type ParamValue } from './types';

export type ParameterKind = 'length' | 'angle' | 'count' | 'number';

/**
 * One numeric input of an operation. The registry is what the resolver walks
 * to apply bounds and rounding; formulas themselves are stored in the fields,
 * so no path is ever written to the document.
 */
export interface ParameterSpec {
  /** Dotted address inside the feature, e.g. `params.dx` or `directions.0.count`. */
  path: string;
  kind: ParameterKind;
  integer?: boolean;
  min?: number;
  max?: number;
}

const size = (path: string, min = 0.1): ParameterSpec => ({
  path,
  kind: 'length',
  min,
});
const length = (path: string): ParameterSpec => ({ path, kind: 'length' });
const angle = (path: string): ParameterSpec => ({ path, kind: 'angle' });
const count = (path: string, min = 1, max = 120): ParameterSpec => ({
  path,
  kind: 'count',
  integer: true,
  min,
  max,
});

const transformSpecs = (): ParameterSpec[] => [
  length('transform.translation.0'),
  length('transform.translation.1'),
  length('transform.translation.2'),
  angle('transform.rotation.0'),
  angle('transform.rotation.1'),
  angle('transform.rotation.2'),
  { path: 'transform.scale', kind: 'number', min: 0.0001 },
];

export function featureParameterSpecs(feature: Feature): ParameterSpec[] {
  switch (feature.type) {
    case 'primitive': {
      const params: ParameterSpec[] = [...transformSpecs()];
      switch (feature.kind) {
        case 'box':
          params.push(size('params.dx'), size('params.dy'), size('params.dz'));
          break;
        case 'sphere':
          params.push(size('params.radius'));
          break;
        case 'cylinder':
          params.push(size('params.radius'), size('params.height'));
          break;
        case 'cone':
          params.push(
            size('params.bottomRadius'),
            size('params.topRadius', 0),
            size('params.height'),
          );
          break;
        case 'torus':
          params.push(size('params.majorRadius'), size('params.tubeRadius'));
          break;
        case 'pyramid':
          params.push(count('params.sides', 3, 120), size('params.radius'), size('params.height'));
          break;
        case 'capsule':
          params.push(size('params.radius'), size('params.height'));
          break;
      }
      return params;
    }
    case 'import-mesh':
      return [{ path: 'scale', kind: 'number', min: 0.0001 }, ...transformSpecs()];
    case 'convert-to-solid': {
      const params: ParameterSpec[] = [{ path: 'voxelSize', kind: 'length', min: 0.1 }];
      params.push({ path: 'targetTriangles', kind: 'count', integer: true, min: 1 });
      params.push({ path: 'tolerance', kind: 'length', min: 0.0001 });
      return params;
    }
    case 'sketch': {
      const params: ParameterSpec[] = [];
      if (feature.plane.offset !== undefined) {
        params.push(length('plane.offset'));
      }
      if (feature.plane.rotation !== undefined) {
        params.push(
          angle('plane.rotation.0'),
          angle('plane.rotation.1'),
          angle('plane.rotation.2'),
        );
      }
      // Paths are structural, like every collected source: an id is not an
      // address inside an array.
      feature.constraints.forEach((constraint, index) => {
        if (constraint.value !== undefined) {
          params.push({ path: `constraints.${index}.value`, kind: 'number' });
        }
      });
      return params;
    }
    case 'extrude': {
      const params: ParameterSpec[] = [length('distance')];
      if (feature.secondDirection) params.push(length('secondDirection.distance'));
      if (feature.revolve) {
        params.push(angle('revolve.start'), angle('revolve.end'));
      }
      return params;
    }
    case 'shell':
      return [
        { path: 'thickness', kind: 'length', min: 0.01 },
        { path: 'offset', kind: 'length', min: 0 },
      ];
    case 'hole': {
      const params: ParameterSpec[] = [
        size('spec.diameter'),
        size('spec.depth'),
        size('spec.headDiameter'),
        size('spec.headDepth'),
        angle('spec.angle'),
      ];
      feature.positions.forEach((_, index) => {
        params.push(length(`positions.${index}.x`), length(`positions.${index}.y`));
      });
      return params;
    }
    case 'rib':
      return [{ path: 'thickness', kind: 'length', min: 0.01 }];
    case 'edge-treatment':
      return [{ path: 'size', kind: 'length', min: 0.01 }];
    case 'array': {
      const params: ParameterSpec[] = [];
      feature.directions.forEach((direction, index) => {
        params.push(count(`directions.${index}.count`));
        if (direction.kind === 'linear') {
          params.push(length(`directions.${index}.spacing`));
          params.push(angle(`directions.${index}.angle`));
        } else if (direction.kind === 'rotation') {
          params.push(angle(`directions.${index}.angle`));
        }
      });
      return params;
    }
    case 'transform':
      return transformSpecs();
    case 'boolean':
    case 'delete-body':
      return [];
  }
}

function segments(path: string): string[] {
  return path.split('.');
}

function readAt(value: unknown, parts: readonly string[]): unknown {
  let current = value;
  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (typeof current === 'object' && current !== null) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
    if (current === undefined) return undefined;
  }
  return current;
}

function writeAt(value: unknown, parts: readonly string[], next: ParamValue): unknown {
  if (parts.length === 0) return next;
  const [head, ...rest] = parts as [string, ...string[]];
  if (Array.isArray(value)) {
    const index = Number(head);
    const copy = [...value];
    copy[index] = writeAt(value[index], rest, next);
    return copy;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return { ...record, [head]: writeAt(record[head], rest, next) };
  }
  return value;
}

export function getParameter(feature: Feature, path: string): ParamValue | undefined {
  const value = readAt(feature, segments(path));
  return typeof value === 'number' || isFormula(value) ? value : undefined;
}

export function setParameter(feature: Feature, path: string, value: ParamValue): Feature {
  return writeAt(feature, segments(path), value) as Feature;
}

export function isDriven(feature: Feature, path: string): boolean {
  const value = getParameter(feature, path);
  return value !== undefined && isFormula(value);
}

/** Applies the bounds and rounding a resolved value needs before the rebuild. */
export function normalizeParameter(spec: ParameterSpec, value: number): number {
  let next = value;
  if (!Number.isFinite(next)) return next;
  if (spec.integer) next = Math.round(next);
  if (spec.min !== undefined) next = Math.max(spec.min, next);
  if (spec.max !== undefined) next = Math.min(spec.max, next);
  return next;
}
