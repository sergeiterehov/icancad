import type { Model } from '@icancad/model';
import type { ScenePick } from './handle';
import type { SelectionHit } from './selectionPick';

/** The maps a pick answers with: which operation made a face, or a whole body. */
export interface PickOwners {
  /** Operation that last built the shape a body has. */
  bodyOperations: Record<string, string>;
  /** Per body, the operation that made each face. */
  faceOperations: Record<string, string[]>;
}

/**
 * The operation that made the geometry a pick landed on. A face knows its own
 * operation, because a boolean keeps the faces it does not touch; anything
 * coarser falls back to the operation that built the body.
 */
function operationOfBody(
  owners: PickOwners,
  project: Model,
  bodyId: string,
  faceId?: string | null,
): string | null {
  if (faceId !== null && faceId !== undefined) {
    const owner = owners.faceOperations[bodyId]?.[Number(faceId)];
    if (owner) return owner;
  }
  const body = owners.bodyOperations[bodyId] ?? project.bodies.find((entry) => entry.id === bodyId)?.createdBy;
  return body ?? null;
}

function knownFeature(project: Model, featureId: string | null): string | null {
  if (!featureId) return null;
  const feature = project.features.find((candidate) => candidate.id === featureId);
  if (!feature || feature.suppressed) return null;
  return feature.id;
}

/** The operation behind a pick from the 3D view. */
export function featureOfPick(
  pick: ScenePick,
  owners: PickOwners,
  project: Model,
): string | null {
  switch (pick.kind) {
    case 'body':
    case 'mesh':
      return knownFeature(project, operationOfBody(owners, project, pick.id));
    case 'body-face':
      return knownFeature(project, operationOfBody(owners, project, pick.bodyId, pick.faceId));
    case 'body-edge':
    case 'body-vertex':
      return knownFeature(project, operationOfBody(owners, project, pick.bodyId));
    case 'face':
    case 'sketch-edge':
      // A region or a curve of a sketch belongs to the sketch operation itself.
      return knownFeature(project, pick.sketchId);
  }
}

/** The operation behind the hit of a normal selection click. */
export function featureOfHit(
  hit: SelectionHit,
  owners: PickOwners,
  project: Model,
): string | null {
  if (hit.sketch) return knownFeature(project, hit.sketch.id);
  if (hit.sketchFace) return knownFeature(project, hit.sketchFace.sketchId);
  if (hit.sketchEdge) return knownFeature(project, hit.sketchEdge.sketchId);
  if (hit.body) {
    return knownFeature(
      project,
      operationOfBody(owners, project, hit.body.id, hit.body.faceId ?? null),
    );
  }
  return null;
}
