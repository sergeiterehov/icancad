import type { SketchEntity } from '@icancad/model';

/**
 * Fundamental sketch geometry: the origin point and the two axes. It exists in
 * every sketch with the same ids and is never stored in the document, so a
 * constraint that refers to it keeps working when it is copied to another
 * sketch.
 */
export const SKETCH_ORIGIN_ID = 'sketch:origin';
export const SKETCH_X_AXIS_ID = 'sketch:x-axis';
export const SKETCH_Y_AXIS_ID = 'sketch:y-axis';

/** Half the length of an axis line; the axes themselves are unbounded. */
export const SKETCH_AXIS_HALF_LENGTH = 200;

const FUNDAMENTAL: readonly SketchEntity[] = [
  { id: SKETCH_ORIGIN_ID, type: 'point', construction: true, x: 0, y: 0 },
  {
    id: SKETCH_X_AXIS_ID,
    type: 'line',
    construction: true,
    x1: -SKETCH_AXIS_HALF_LENGTH,
    y1: 0,
    x2: SKETCH_AXIS_HALF_LENGTH,
    y2: 0,
  },
  {
    id: SKETCH_Y_AXIS_ID,
    type: 'line',
    construction: true,
    x1: 0,
    y1: -SKETCH_AXIS_HALF_LENGTH,
    x2: 0,
    y2: SKETCH_AXIS_HALF_LENGTH,
  },
];

const FUNDAMENTAL_IDS: ReadonlySet<string> = new Set(FUNDAMENTAL.map((entity) => entity.id));

export function isFundamentalEntityId(id: string): boolean {
  return FUNDAMENTAL_IDS.has(id);
}

export function isSketchAxisId(id: string): boolean {
  return id === SKETCH_X_AXIS_ID || id === SKETCH_Y_AXIS_ID;
}

/** The fundamental geometry of any sketch. The result is shared and read-only. */
export function fundamentalEntities(): readonly SketchEntity[] {
  return FUNDAMENTAL;
}

export function fundamentalEntity(id: string): SketchEntity | undefined {
  return FUNDAMENTAL.find((entity) => entity.id === id);
}

/**
 * Index of the sketch's own entities together with its fundamental geometry.
 * Fundamental ids win, so a stored entity can never shadow the origin or an
 * axis.
 */
export function sketchEntityIndex(entities: readonly SketchEntity[]): Map<string, SketchEntity> {
  const index = new Map<string, SketchEntity>();
  for (const entity of entities) index.set(entity.id, entity);
  for (const entity of FUNDAMENTAL) index.set(entity.id, entity);
  return index;
}

/** The sketch's own entities followed by its fundamental geometry. */
export function withFundamentalEntities(entities: readonly SketchEntity[]): SketchEntity[] {
  // A stored entity can never shadow the origin or an axis, even in a file that
  // was written by something else.
  return [...entities.filter((entity) => !FUNDAMENTAL_IDS.has(entity.id)), ...FUNDAMENTAL];
}
