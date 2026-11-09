import { featureBodyId, type Project } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import {
  isDirectlySelected,
  linkedBodyIds,
  selectedBodyIds,
  selectedFeatureIds,
} from '../src/stores/selection';

const project = {
  bodies: [
    { id: 'body-1', name: 'One', color: '#fff', visible: true, createdBy: 'feat-1' },
    { id: 'body-2', name: 'Two', color: '#fff', visible: true, createdBy: 'feat-2' },
    {
      id: featureBodyId('feat-import'),
      name: 'Mesh',
      color: '#fff',
      visible: true,
      createdBy: 'feat-import',
    },
  ],
  features: [
    { id: 'feat-1' },
    { id: 'feat-2' },
    { id: 'feat-import', type: 'import-mesh', assetId: 'asset-1' },
    { id: 'feat-sketch', type: 'sketch' },
  ],
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

  it('links an imported mesh operation to its body', () => {
    const byFeature = [{ kind: 'feature' as const, id: 'feat-import' }];
    expect(linkedBodyIds(byFeature, project)).toEqual([featureBodyId('feat-import')]);
    expect(selectedBodyIds(byFeature)).toEqual([featureBodyId('feat-import')]);
  });

  it('keeps the sketch object separate from its operation', () => {
    const selection = [{ kind: 'sketch' as const, id: 'feat-sketch' }];
    expect(selectedFeatureIds(selection, project)).toEqual(['feat-sketch']);
    // A sketch has no body, so nothing is highlighted or measured for it.
    expect(selectedBodyIds(selection)).toEqual([]);
    expect(linkedBodyIds(selection, project)).toEqual([]);
    expect(isDirectlySelected(selection, 'sketch', 'feat-sketch')).toBe(true);
    expect(isDirectlySelected(selection, 'feature', 'feat-sketch')).toBe(false);
  });

  it('reports direct selection separately', () => {
    const selection = [{ kind: 'feature' as const, id: 'feat-1' }];
    expect(isDirectlySelected(selection, 'feature', 'feat-1')).toBe(true);
    expect(isDirectlySelected(selection, 'body', 'body-1')).toBe(false);
  });
});
