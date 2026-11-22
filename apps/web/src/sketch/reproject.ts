import type { SketchEntity, SketchFeature } from '@icancad/model';
import { entityControlPoints } from '@icancad/sketch';
import { solveSketch } from './client';
import { projectionEntityIds } from './projection';

/** How close two control points have to be to count as the same place. */
const POSITION_TOLERANCE = 1e-4;

/**
 * Whether any projected entity moved between the snapshot the sketch was solved
 * from and the geometry the source body has now. A projection that did not move
 * leaves the sketch alone, so a rebuild without a change costs no solve.
 */
export function projectionMoved(
  before: readonly SketchEntity[],
  after: readonly SketchEntity[],
  projected: ReadonlySet<string>,
): boolean {
  if (projected.size === 0) return false;
  const previous = new Map(before.map((entity) => [entity.id, entity]));
  for (const entity of after) {
    if (!projected.has(entity.id)) continue;
    const old = previous.get(entity.id);
    if (!old) return true;
    const a = entityControlPoints(old);
    const b = entityControlPoints(entity);
    if (a.length !== b.length) return true;
    for (let index = 0; index < a.length; index += 1) {
      if (
        Math.abs(a[index]![0] - b[index]![0]) > POSITION_TOLERANCE ||
        Math.abs(a[index]![1] - b[index]![1]) > POSITION_TOLERANCE
      ) {
        return true;
      }
    }
  }
  return false;
}

export interface ReprojectionSolve {
  /** Solved geometry, or null when there is nothing to solve or no solution. */
  entities: SketchEntity[] | null;
  /**
   * The constraints have a solution somewhere, but not with the geometry the
   * body now gives the projections. The caller keeps the rebuilt entities and
   * reports the sketch as broken instead of hiding the mismatch.
   */
  conflict: boolean;
}

/**
 * Solves a sketch again after its projections were rebuilt. The projected
 * curves are derived — they stay where the body puts them — and the rest of the
 * geometry follows the constraints that hold the sketch together, so changing a
 * projected feature earlier in the history moves the whole sketch instead of
 * leaving half of it behind.
 */
export async function solveReprojectedSketch(
  feature: SketchFeature,
  entities: SketchEntity[],
): Promise<ReprojectionSolve> {
  if (feature.constraints.length === 0) return { entities: null, conflict: false };
  try {
    const result = await solveSketch(entities, feature.constraints, [], {
      derived: [...projectionEntityIds(feature)],
    });
    if (result.conflicting.length > 0) return { entities: null, conflict: true };
    return { entities: result.entities, conflict: false };
  } catch {
    // A solver that could not run says nothing about the constraints.
    return { entities: null, conflict: false };
  }
}
