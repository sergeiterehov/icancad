import type { SketchEntity, SketchFeature } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import {
  buildSketchClipboard,
  clipboardAnchor,
  clipboardText,
  newClipboardEntities,
  parseClipboardText,
  placeClipboardEntities,
  reidentify,
} from '../src/clipboard/payload';

function feature(entities: SketchEntity[]): SketchFeature {
  return {
    id: 'sketch',
    type: 'sketch',
    name: 'Sketch',
    suppressed: false,
    plane: { type: 'datum', plane: 'XY', offset: 0 },
    references: [],
    constraints: [],
    entities,
  };
}

const line = (
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  construction = false,
): SketchEntity => ({ id, type: 'line', construction, x1, y1, x2, y2 });

describe('sketch clipboard payload (ADR 0059)', () => {
  it('copies only the named geometry, and nothing of the fixed frame', () => {
    const sketch = feature([
      line('a', 0, 0, 10, 4),
      line('b', 20, 0, 30, 0),
      { id: 'sketch:origin', type: 'point', construction: true, x: 0, y: 0 },
    ]);
    const payload = buildSketchClipboard(sketch, ['a', 'sketch:origin']);
    expect(payload).not.toBeNull();
    expect(payload?.entities.map((entity) => entity.id)).toEqual(['a']);
  });

  it('has nothing to copy when the selection is empty or only the frame', () => {
    const sketch = feature([line('a', 0, 0, 10, 0)]);
    expect(buildSketchClipboard(sketch, [])).toBeNull();
    expect(buildSketchClipboard(sketch, ['sketch:origin'])).toBeNull();
  });

  it('keeps a construction curve and a Bezier’s own points', () => {
    const bezier: SketchEntity = {
      id: 'curve',
      type: 'bezier',
      construction: true,
      points: [
        [0, 0],
        [5, 8],
        [10, 0],
      ],
    };
    const payload = buildSketchClipboard(feature([bezier]), ['curve']);
    expect(payload?.entities[0]).toEqual(bezier);
    expect(payload?.entities[0]).not.toBe(bezier);
    if (payload?.entities[0]?.type === 'bezier') {
      expect(payload.entities[0].points).not.toBe(bezier.points);
    }
  });

  it('round-trips through the clipboard text', () => {
    const payload = buildSketchClipboard(feature([line('a', 0, 0, 10, 4)]), ['a']);
    expect(payload).not.toBeNull();
    expect(parseClipboardText(clipboardText(payload!))).toEqual(payload);
  });

  it('refuses text that is not sketch geometry', () => {
    expect(parseClipboardText(null)).toBeNull();
    expect(parseClipboardText('')).toBeNull();
    expect(parseClipboardText('hello')).toBeNull();
    expect(parseClipboardText('{"kind":"other","version":1,"entities":[]}')).toBeNull();
    expect(
      parseClipboardText('{"kind":"icancad.sketch-geometry","version":1,"entities":[]}'),
    ).toBeNull();
    expect(
      parseClipboardText(
        '{"kind":"icancad.sketch-geometry","version":1,"entities":[{"id":"a","type":"line"}]}',
      ),
    ).toBeNull();
  });

  it('takes the centre of the bounds as the point that follows the pointer', () => {
    const linePayload = buildSketchClipboard(feature([line('a', 0, 0, 10, 4)]), ['a']);
    expect(clipboardAnchor(linePayload!)).toEqual([5, 2]);
    const circle: SketchEntity = {
      id: 'c',
      type: 'circle',
      construction: false,
      cx: 3,
      cy: 3,
      r: 2,
    };
    const circlePayload = buildSketchClipboard(feature([circle]), ['c']);
    const [x, y] = clipboardAnchor(circlePayload!);
    expect(x).toBeCloseTo(3, 6);
    expect(y).toBeCloseTo(3, 6);
  });

  it('places the anchored geometry under a fresh set of ids', () => {
    const payload = buildSketchClipboard(feature([line('a', 0, 0, 10, 4)]), ['a'])!;
    const entities = newClipboardEntities(payload);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.id).not.toBe('a');

    const placed = placeClipboardEntities(entities, clipboardAnchor(payload), [100, 50]);
    expect(placed[0]).toMatchObject({ type: 'line', x1: 95, y1: 48, x2: 105, y2: 52 });
  });

  it('gives every paste its own ids, so a copy can land in its own sketch', () => {
    const payload = buildSketchClipboard(feature([line('a', 0, 0, 10, 4)]), ['a'])!;
    const first = newClipboardEntities(payload);
    const second = newClipboardEntities(payload);
    expect(first[0]!.id).not.toBe(second[0]!.id);
  });

  it('re-arms a run of pastes under ids of its own', () => {
    const payload = buildSketchClipboard(feature([line('a', 0, 0, 10, 4)]), ['a'])!;
    const armed = newClipboardEntities(payload);
    const next = reidentify(armed);
    expect(next[0]!.id).not.toBe(armed[0]!.id);
    // The shape is the same; only the ids are new, and the armed set is untouched.
    expect({ ...next[0], id: 'a' }).toEqual({ ...armed[0], id: 'a' });
    expect(armed[0]!.id).not.toBe('a');
  });
});
