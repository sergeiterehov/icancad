import { featureBodyId, type Project } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { isDirectlySelected, selectedBodyIds, selectedFeatureIds } from '../src/stores/selection';

const project = {
  bodies: [
    { id: 'body-1', name: 'One', color: '#fff', visible: true, createdBy: 'feat-1' },
    { id: 'body-2', name: 'Two', color: '#fff', visible: true, createdBy: 'feat-2' },
  ],
  features: [{ id: 'feat-1' }, { id: 'feat-2' }],
} as unknown as Project;

describe('selection helpers', () => {
  it('links a selected body to its operation', () => {
    const selection = [{ kind: 'body' as const, id: 'body-2' }];
    expect(selectedFeatureIds(selection, project)).toEqual(['feat-2']);
    expect(selectedBodyIds(selection)).toEqual(['body-2']);
  });

  it('links a selected operation to its body', () => {
    const selection = [{ kind: 'feature' as const, id: 'feat-1' }];
    expect(selectedFeatureIds(selection, project)).toEqual(['feat-1']);
    expect(selectedBodyIds(selection)).toEqual([featureBodyId('feat-1')]);
  });

  it('merges bodies and operations without duplicates', () => {
    const selection = [
      { kind: 'body' as const, id: 'body-1' },
      { kind: 'feature' as const, id: 'feat-1' },
    ];
    expect(selectedFeatureIds(selection, project)).toEqual(['feat-1']);
    expect(selectedBodyIds(selection)).toEqual(['body-1', featureBodyId('feat-1')]);
  });

  it('reports direct selection separately', () => {
    const selection = [{ kind: 'feature' as const, id: 'feat-1' }];
    expect(isDirectlySelected(selection, 'feature', 'feat-1')).toBe(true);
    expect(isDirectlySelected(selection, 'body', 'body-1')).toBe(false);
  });
});
