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
