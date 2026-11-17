import type { ResolvedModel } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { rebuildInputKey } from '../src/kernel/buildInput';

const transform = {
  translation: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  scale: 1,
};

function model(groupId?: string, dx = 10): ResolvedModel {
  return {
    id: 'model',
    features: [
      {
        id: 'feat_box',
        name: 'Box',
        suppressed: false,
        type: 'primitive',
        kind: 'box',
        params: { dx, dy: 10, dz: 10 },
        transform,
        ...(groupId === undefined ? {} : { groupId }),
      },
    ],
  } as unknown as ResolvedModel;
}

function key(overrides: Partial<Parameters<typeof rebuildInputKey>[0]> = {}): string {
  return rebuildInputKey({
    modelId: 'model',
    model: model(),
    historyEnd: 'feat_box',
    editingFeatureId: null,
    expressionErrors: [],
    drivenSketches: [],
    ...overrides,
  });
}

describe('rebuild input key', () => {
  it('ignores folder membership, which is not a build step', () => {
    expect(key({ model: model('group_1') })).toBe(key({ model: model('group_2') }));
  });

  it('answers a real parameter edit', () => {
    expect(key({ model: model(undefined, 20) })).not.toBe(key());
  });

  it('covers the cursor, the edited operation and formula state', () => {
    expect(key({ historyEnd: null })).not.toBe(key());
    expect(key({ editingFeatureId: 'feat_box' })).not.toBe(key());
    expect(key({ expressionErrors: ['feat_box'] })).not.toBe(key());
    expect(key({ drivenSketches: ['sketch_1'] })).not.toBe(key());
  });
});
