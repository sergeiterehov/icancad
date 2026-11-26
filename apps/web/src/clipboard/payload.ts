import {
  SKETCH_CLIPBOARD_KIND,
  createId,
  parseSketchClipboard,
  type SketchClipboardPayload,
  type SketchEntity,
  type SketchFeature,
} from '@icancad/model';
import {
  isFundamentalEntityId,
  tessellateEntity,
  translateEntity,
  type Point2,
} from '@icancad/sketch';

/** Segments a curved entity is measured with when its bounds are taken. */
const BOUNDS_SEGMENTS = 32;

/**
 * A copy of one entity with nothing shared: the clipboard outlives the sketch it
 * was taken from, so a Bezier keeps its own point arrays and `JSON.stringify`
 * below cannot alias the document.
 */
function snapshotEntity(entity: SketchEntity): SketchEntity {
  return entity.type === 'bezier'
    ? { ...entity, points: entity.points.map((point) => [point[0], point[1]] as Point2) }
    : { ...entity };
}

/**
 * The payload of a copy: the geometry named by `entityIds`, as it stands now.
 * Projected geometry is copied like any other curve — the payload carries no
 * link to the body it came from, so a paste is ordinary geometry. The origin
 * and the axes are not geometry to copy, and a selection of nothing but them
 * gives no payload at all.
 */
export function buildSketchClipboard(
  feature: SketchFeature,
  entityIds: readonly string[],
): SketchClipboardPayload | null {
  const wanted = new Set(entityIds);
  const entities = feature.entities.filter(
    (entity) => wanted.has(entity.id) && !isFundamentalEntityId(entity.id),
  );
  if (entities.length === 0) return null;
  return {
    kind: SKETCH_CLIPBOARD_KIND,
    version: 1,
    entities: entities.map(snapshotEntity),
  };
}

/** Bounds of the payload's geometry in its own sketch plane. */
function clipboardBounds(payload: SketchClipboardPayload): {
  min: Point2;
  max: Point2;
} | null {
  const min: Point2 = [Infinity, Infinity];
  const max: Point2 = [-Infinity, -Infinity];
  for (const entity of payload.entities) {
    for (const point of tessellateEntity(entity, BOUNDS_SEGMENTS)) {
      min[0] = Math.min(min[0], point[0]);
      min[1] = Math.min(min[1], point[1]);
      max[0] = Math.max(max[0], point[0]);
      max[1] = Math.max(max[1], point[1]);
    }
  }
  return Number.isFinite(min[0]) ? { min, max } : null;
}

/**
 * The point of the copied geometry that follows the pointer: the centre of its
 * bounds. A paste drags the shape as one, so the middle is the place a hand
 * expects the shape to gather around.
 */
export function clipboardAnchor(payload: SketchClipboardPayload): Point2 {
  const bounds = clipboardBounds(payload);
  if (!bounds) return [0, 0];
  return [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2];
}

/**
 * The geometry under fresh ids. A paste is a new object even when it lands back
 * in the sketch it was copied from, and a run of pastes needs a set of ids per
 * copy: the armed set is used up by the copy it places and replaced with a new
 * one for the next.
 */
export function reidentify(entities: readonly SketchEntity[]): SketchEntity[] {
  return entities.map((entity) => ({ ...snapshotEntity(entity), id: createId('entity') }));
}

/** The payload's geometry under fresh ids, ready to be armed for the pointer. */
export function newClipboardEntities(payload: SketchClipboardPayload): SketchEntity[] {
  return reidentify(payload.entities);
}

/** The armed geometry moved so its anchor stands at `at`. */
export function placeClipboardEntities(
  entities: readonly SketchEntity[],
  anchor: Point2,
  at: Point2,
): SketchEntity[] {
  const dx = at[0] - anchor[0];
  const dy = at[1] - anchor[1];
  return entities.map((entity) => translateEntity(entity, dx, dy));
}

/** The clipboard text of a payload. */
export function clipboardText(payload: SketchClipboardPayload): string {
  return JSON.stringify(payload);
}

/** The payload a clipboard text carries, or `null` when it holds something else. */
export function parseClipboardText(text: string | null | undefined): SketchClipboardPayload | null {
  if (!text) return null;
  try {
    return parseSketchClipboard(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}
