import { activeModel, type Project, type Resolved, type ResolvedModel } from '@icancad/model';

/**
 * Test fixtures are written with literal numbers, so an authored value is
 * already its resolved form. This keeps the fixtures readable instead of
 * spelling every parameter as a number union.
 */
export function resolved<T>(value: T): Resolved<T> {
  return value as unknown as Resolved<T>;
}

export function resolvedModelOf(project: Project): ResolvedModel {
  return activeModel(project) as unknown as ResolvedModel;
}
