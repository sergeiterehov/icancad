import type { SketchEntity } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import {
  fundamentalEntities,
  fundamentalEntity,
  isFundamentalEntityId,
  isSketchAxisId,
  SKETCH_ORIGIN_ID,
  SKETCH_X_AXIS_ID,
  SKETCH_Y_AXIS_ID,
  sketchEntityIndex,
  withFundamentalEntities,
} from '../src/index';

const point: SketchEntity = { id: 'p', type: 'point', construction: false, x: 4, y: 7 };

describe('fundamental sketch geometry', () => {
  it('is the same in every sketch and is not stored in the sketch', () => {
    expect(fundamentalEntities().map((entity) => entity.id)).toEqual([
      SKETCH_ORIGIN_ID,
      SKETCH_X_AXIS_ID,
      SKETCH_Y_AXIS_ID,
    ]);
    expect(fundamentalEntity(SKETCH_ORIGIN_ID)).toMatchObject({ type: 'point', x: 0, y: 0 });
    expect(isFundamentalEntityId(SKETCH_ORIGIN_ID)).toBe(true);
    expect(isFundamentalEntityId(point.id)).toBe(false);
    expect(isSketchAxisId(SKETCH_X_AXIS_ID)).toBe(true);
    expect(isSketchAxisId(SKETCH_ORIGIN_ID)).toBe(false);

    expect(withFundamentalEntities([point])).toEqual([point, ...fundamentalEntities()]);
    expect(withFundamentalEntities(fundamentalEntities())).toEqual([...fundamentalEntities()]);
  });

  it('places the axes through the origin', () => {
    for (const id of [SKETCH_X_AXIS_ID, SKETCH_Y_AXIS_ID]) {
      const axis = fundamentalEntity(id);
      expect(axis?.type).toBe('line');
      if (axis?.type !== 'line') continue;
      const mid: [number, number] = [(axis.x1 + axis.x2) / 2, (axis.y1 + axis.y2) / 2];
      expect(mid).toEqual([0, 0]);
    }
  });

  it('resolves refs to fundamental geometry but never stores it', () => {
    const index = sketchEntityIndex([point]);
    expect(index.get('p')).toBe(point);
    expect(index.get(SKETCH_ORIGIN_ID)?.id).toBe(SKETCH_ORIGIN_ID);
    expect(index.get(SKETCH_Y_AXIS_ID)?.id).toBe(SKETCH_Y_AXIS_ID);
    // The stored list stays exactly what the document holds.
    expect([point].every((entity) => !isFundamentalEntityId(entity.id))).toBe(true);
  });
});
