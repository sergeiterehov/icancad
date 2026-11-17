import type { SketchEntity, SketchFeature } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { dimensionAnnotations } from '../src/sketch/dimensions';

function sketch(
  entities: SketchEntity[],
  constraints: SketchFeature['constraints'],
): SketchFeature {
  return {
    id: 'sketch',
    type: 'sketch',
    name: 'Sketch',
    suppressed: false,
    plane: { type: 'datum', plane: 'XY', offset: 0 },
    entities,
    constraints,
    references: [],
  };
}

const line: SketchEntity = {
  id: 'line',
  type: 'line',
  construction: false,
  x1: 0,
  y1: 0,
  x2: 40,
  y2: 0,
};

describe('dimension annotations', () => {
  it('anchors a line distance at the line midpoint', () => {
    const annotations = dimensionAnnotations(
      sketch(
        [
          line,
          {
            id: 'line2',
            type: 'line',
            construction: false,
            x1: 0,
            y1: 20,
            x2: 40,
            y2: 20,
          },
        ],
        [
          {
            id: 'distance',
            type: 'distance',
            refs: [{ entityId: 'line' }],
            value: 40,
          },
        ],
      ),
      'en',
    );
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({ text: '40 mm', point: [20, 0] });
  });

  it('anchors point-to-point distances and ignores non-numeric constraints', () => {
    const annotations = dimensionAnnotations(
      sketch(
        [line],
        [
          {
            id: 'horizontal',
            type: 'horizontal',
            refs: [{ entityId: 'line' }],
          },
          {
            id: 'distance',
            type: 'distance',
            refs: [
              { entityId: 'line', pointIndex: 0 },
              { entityId: 'line', pointIndex: 1 },
            ],
            value: 40,
          },
        ],
      ),
      'en',
    );
    expect(annotations.map((annotation) => annotation.id)).toEqual(['distance']);
    expect(annotations[0]?.point).toEqual([20, 0]);
  });

  it('anchors a line-to-line distance halfway across the gap', () => {
    const second: SketchEntity = {
      id: 'line3',
      type: 'line',
      construction: false,
      x1: 0,
      y1: 10,
      x2: 40,
      y2: 10,
    };
    const annotations = dimensionAnnotations(
      sketch(
        [line, second],
        [
          {
            id: 'gap',
            type: 'distance',
            refs: [{ entityId: 'line' }, { entityId: 'line3' }],
            value: 10,
          },
        ],
      ),
      'en',
    );
    expect(annotations[0]?.point).toEqual([0, 5]);
  });

  it('anchors a point-to-line distance halfway to the line', () => {
    const target: SketchEntity = { id: 'p', type: 'point', construction: false, x: 10, y: 6 };
    const annotations = dimensionAnnotations(
      sketch(
        [line, target],
        [
          {
            id: 'to-line',
            type: 'distance',
            refs: [{ entityId: 'p', pointIndex: 0 }, { entityId: 'line' }],
            value: 6,
          },
        ],
      ),
      'en',
    );
    expect(annotations[0]?.point).toEqual([10, 3]);
  });

  it('anchors a point-to-circle distance halfway to the curve', () => {
    const circle: SketchEntity = {
      id: 'circle',
      type: 'circle',
      construction: false,
      cx: 0,
      cy: 0,
      r: 3,
    };
    const target: SketchEntity = { id: 'p', type: 'point', construction: false, x: 10, y: 0 };
    const annotations = dimensionAnnotations(
      sketch(
        [circle, target],
        [
          {
            id: 'to-circle',
            type: 'distance',
            refs: [{ entityId: 'p', pointIndex: 0 }, { entityId: 'circle' }],
            value: 7,
          },
        ],
      ),
      'en',
    );
    expect(annotations[0]?.point[0]).toBeCloseTo(6.5, 1);
    expect(annotations[0]?.point[1]).toBeCloseTo(0, 6);
  });

  it('anchors a circle-to-circle distance between the nearest rims', () => {
    const first: SketchEntity = {
      id: 'c1',
      type: 'circle',
      construction: false,
      cx: 0,
      cy: 0,
      r: 2,
    };
    const second: SketchEntity = {
      id: 'c2',
      type: 'circle',
      construction: false,
      cx: 10,
      cy: 0,
      r: 3,
    };
    const annotations = dimensionAnnotations(
      sketch(
        [first, second],
        [
          {
            id: 'gap',
            type: 'distance',
            refs: [{ entityId: 'c1' }, { entityId: 'c2' }],
            value: 5,
          },
        ],
      ),
      'en',
    );
    expect(annotations[0]?.point[0]).toBeCloseTo(4.5, 6);
    expect(annotations[0]?.point[1]).toBeCloseTo(0, 6);
  });

  it('anchors an axis distance halfway to the crossing point', () => {
    const target: SketchEntity = { id: 'p', type: 'point', construction: false, x: 4, y: 3 };
    const annotations = dimensionAnnotations(
      sketch(
        [line, target],
        [
          {
            id: 'vertical',
            type: 'vertical-distance',
            refs: [{ entityId: 'p', pointIndex: 0 }, { entityId: 'line' }],
            value: 3,
          },
        ],
      ),
      'en',
    );
    expect(annotations[0]?.point).toEqual([4, 1.5]);
  });

  it('places arc radius and diameter annotations at the arc center', () => {
    const arc: SketchEntity = {
      id: 'arc',
      type: 'arc',
      construction: false,
      cx: 5,
      cy: 7,
      r: 12,
      startAngle: 0,
      endAngle: Math.PI / 2,
    };
    const annotations = dimensionAnnotations(
      sketch(
        [arc],
        [
          { id: 'radius', type: 'radius', refs: [{ entityId: 'arc' }], value: 12 },
          { id: 'diameter', type: 'diameter', refs: [{ entityId: 'arc' }], value: 24 },
        ],
      ),
      'en',
    );
    const expected = 12 / Math.sqrt(2);
    for (const annotation of annotations) {
      expect(annotation.point[0]).toBeCloseTo(5 + expected, 6);
      expect(annotation.point[1]).toBeCloseTo(7 + expected, 6);
    }
  });
});
