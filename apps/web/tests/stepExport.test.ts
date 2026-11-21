import type { BodyObject } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { stepBodies } from '../src/kernel/export';

function body(overrides: Partial<BodyObject> & Pick<BodyObject, 'id'>): BodyObject {
  return {
    createdBy: 'feature-1',
    kind: 'solid',
    name: 'Body',
    color: '#9aa1a9',
    visible: true,
    ...overrides,
  };
}

describe('STEP export bodies', () => {
  it('keeps the name and colour of every body with a shape', () => {
    expect(
      stepBodies([body({ id: 'body-1', name: 'Bracket', color: '#3366cc' })], {
        'body-1': 'shape-1',
      }),
    ).toEqual({
      bodies: [{ shapeId: 'shape-1', name: 'Bracket', color: '#3366cc' }],
      skipped: 0,
    });
  });

  it('counts imported meshes as skipped and exports the solids', () => {
    const result = stepBodies(
      [body({ id: 'solid-1' }), body({ id: 'mesh-1', kind: 'mesh' })],
      { 'solid-1': 'shape-1', 'mesh-1': 'shape-2' },
    );
    expect(result.bodies).toEqual([{ shapeId: 'shape-1', name: 'Body', color: '#9aa1a9' }]);
    expect(result.skipped).toBe(1);
  });

  it('leaves out a solid whose shape is not built yet', () => {
    expect(stepBodies([body({ id: 'body-1' })], {})).toEqual({ bodies: [], skipped: 0 });
  });
});
