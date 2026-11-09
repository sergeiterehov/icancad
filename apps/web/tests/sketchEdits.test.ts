import type { SketchEntity, SketchFeature } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { removeSketchEntities } from '../src/sketch/constraintModel';

const lines: SketchEntity[] = [
  { id: 'l1', type: 'line', construction: false, x1: 0, y1: 0, x2: 10, y2: 0 },
  { id: 'l2', type: 'line', construction: false, x1: 10, y1: 0, x2: 10, y2: 10 },
];

const feature: SketchFeature = {
  id: 'sketch',
  name: 'Sketch',
  suppressed: false,
  type: 'sketch',
  plane: { type: 'datum', plane: 'XY', offset: 0 },
  entities: lines,
  references: [],
  constraints: [
    { id: 'c1', type: 'horizontal', refs: [{ entityId: 'l1' }] },
    {
      id: 'c2',
      type: 'coincident',
      refs: [
        { entityId: 'l1', pointIndex: 1 },
        { entityId: 'l2', pointIndex: 0 },
      ],
    },
    { id: 'c3', type: 'vertical', refs: [{ entityId: 'l2' }] },
    { id: 'c4', type: 'fix', refs: [{ entityId: 'l1', pointIndex: 0 }], x: 0, y: 0 },
  ],
};

describe('sketch entity removal', () => {
  it('drops constraints that reference removed entities', () => {
    const next = removeSketchEntities(feature, ['l1']);
    expect(next.entities.map((entity) => entity.id)).toEqual(['l2']);
    expect(next.constraints.map((constraint) => constraint.id)).toEqual(['c3']);
  });

  it('drops reference measurements of removed entities', () => {
    const next = removeSketchEntities(
      {
        ...feature,
        references: [
          { id: 'ref1', entityId: 'l1', measure: 'length' },
          { id: 'ref2', entityId: 'l2', measure: 'angle' },
        ],
      },
      ['l1'],
    );
    expect(next.references.map((reference) => reference.id)).toEqual(['ref2']);
  });

  it('keeps unrelated constraints when removing several entities', () => {
    const next = removeSketchEntities(feature, ['l1', 'l2']);
    expect(next.entities).toHaveLength(0);
    expect(next.constraints).toHaveLength(0);
  });
});
