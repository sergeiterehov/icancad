import { describe, expect, it } from 'vitest';
import { predictBodyFaceOp, predictSketchOp } from '../src/quick/predict';
import { cubeMesh } from './cubeMesh';

describe('extrude method prediction', () => {
  it('joins outward from a body face and cuts inward', () => {
    expect(predictBodyFaceOp(4, 'b')).toEqual({ op: 'add', bodyIds: ['b'] });
    expect(predictBodyFaceOp(-4, 'b')).toEqual({ op: 'subtract', bodyIds: ['b'] });
  });

  const bodies = [{ id: 'b', mesh: cubeMesh() }];

  it('joins a profile sitting on a surface', () => {
    expect(
      predictSketchOp({
        bodies,
        samples: [[10, 10, 20]],
        direction: [0, 0, 1],
        sign: 1,
      }),
    ).toEqual({ op: 'add', bodyIds: ['b'] });
  });

  it('cuts when material lies ahead of the profile', () => {
    expect(
      predictSketchOp({
        bodies,
        samples: [[10, 10, 20]],
        direction: [0, 0, -1],
        sign: -1,
      }),
    ).toEqual({ op: 'subtract', bodyIds: ['b'] });
  });

  it('cuts a profile buried in material', () => {
    expect(
      predictSketchOp({
        bodies,
        samples: [[10, 10, 10]],
        direction: [0, 0, 1],
        sign: 1,
      }),
    ).toEqual({ op: 'subtract', bodyIds: ['b'] });
  });

  it('creates a new body in empty space', () => {
    expect(
      predictSketchOp({
        bodies,
        samples: [[40, 10, 10]],
        direction: [0, 0, 1],
        sign: 1,
      }),
    ).toEqual({ op: 'new', bodyIds: [] });
  });

  it('falls back to the host body of a face sketch', () => {
    expect(
      predictSketchOp({
        bodies,
        samples: [[40, 10, 10]],
        direction: [0, 0, 1],
        sign: 1,
        preferredBodyId: 'b',
      }),
    ).toEqual({ op: 'add', bodyIds: ['b'] });
  });

  it('returns a new body when there is nothing to sample', () => {
    expect(
      predictSketchOp({ bodies, samples: [], direction: [0, 0, 1], sign: 1 }),
    ).toEqual({ op: 'new', bodyIds: [] });
  });
});
