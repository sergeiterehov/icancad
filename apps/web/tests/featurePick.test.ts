import { describe, expect, it } from 'vitest';
import type { Model } from '@icancad/model';
import type { ScenePick } from '../src/viewport/handle';
import { featureOfHit, featureOfPick, type PickOwners } from '../src/viewport/featurePick';

const owners: PickOwners = {
  bodyOperations: { body_1: 'feat_box' },
  faceOperations: { body_1: ['feat_box', 'feat_box', 'feat_boss', 'feat_fillet'] },
};

const project = {
  features: [
    { id: 'feat_box', type: 'primitive', name: 'Box', suppressed: false },
    { id: 'feat_boss', type: 'extrude', name: 'Boss', suppressed: false },
    { id: 'feat_fillet', type: 'edge-treatment', name: 'Fillet', suppressed: false },
    { id: 'feat_off', type: 'extrude', name: 'Off', suppressed: true },
  ],
  bodies: [{ id: 'body_1', createdBy: 'feat_box' }],
} as unknown as Model;

describe('featureOfPick', () => {
  it('names the operation that made the face under the pointer', () => {
    const pick: ScenePick = {
      kind: 'body-face',
      bodyId: 'body_1',
      faceId: '2',
      normal: [0, 0, 1],
      origin: [0, 0, 0],
      planar: true,
    };
    expect(featureOfPick(pick, owners, project)).toBe('feat_boss');
  });

  it('falls back to the operation that built the body', () => {
    expect(featureOfPick({ kind: 'body', id: 'body_1' }, owners, project)).toBe('feat_box');
    expect(featureOfPick({ kind: 'body-edge', bodyId: 'body_1', edgeId: '7' }, owners, project)).toBe(
      'feat_box',
    );
  });

  it('ignores an operation that is rolled out of the history', () => {
    const pick: ScenePick = {
      kind: 'body-face',
      bodyId: 'body_1',
      faceId: '3',
      normal: [0, 0, 1],
      origin: [0, 0, 0],
      planar: true,
    };
    owners.faceOperations.body_1![3] = 'feat_off';
    expect(featureOfPick(pick, owners, project)).toBeNull();
  });
});

describe('featureOfHit', () => {
  it('reads the face detail a click resolved', () => {
    expect(
      featureOfHit({ body: { id: 'body_1', kind: 'solid', faceId: '2' } }, owners, project),
    ).toBe('feat_boss');
  });

  it('takes the whole body when the click stayed at object level', () => {
    expect(featureOfHit({ body: { id: 'body_1', kind: 'solid' } }, owners, project)).toBe(
      'feat_box',
    );
  });
});
