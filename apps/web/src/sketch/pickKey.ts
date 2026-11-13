import type { SketchEntity } from '@icancad/model';

/** Selection key of a pick, in the same form the sketch selection stores. */
export function sketchPickKey(
  pick: { entityId: string | null; pointIndex: number | null } | null,
  entity: SketchEntity | undefined,
): string | null {
  if (!pick?.entityId) return null;
  const pointIndex = pick.pointIndex ?? (entity?.type === 'point' ? 0 : null);
  return pointIndex === null ? pick.entityId : `${pick.entityId}#${pointIndex}`;
}
