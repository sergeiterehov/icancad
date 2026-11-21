import { describe, expect, it } from 'vitest';
import { useExportStore } from '../src/stores/exportStore';
import { exportMenuItem, type MenuTarget } from '../src/ui/objectMenu';

const LABELS = { export: 'Export', stl: 'STL', step: 'STEP' };

function target(kind: MenuTarget['kind'], id: string): MenuTarget {
  return { kind, id, objectId: id, name: id, color: '#000000', visible: true };
}

function submenuIds(item: ReturnType<typeof exportMenuItem>): string[] {
  if (!item || !('submenu' in item)) return [];
  return item.submenu.map((entry) => entry.id);
}

describe('export context menu', () => {
  it('offers nothing for an empty or sketch-only selection', () => {
    expect(exportMenuItem([], LABELS)).toBeNull();
    expect(exportMenuItem([target('sketch', 'sketch_a')], LABELS)).toBeNull();
  });

  it('offers STL and STEP when a solid body is picked', () => {
    const item = exportMenuItem([target('body', 'body_a'), target('mesh', 'mesh_a')], LABELS);
    expect(item?.id).toBe('export');
    expect(submenuIds(item)).toEqual(['export-stl', 'export-step']);
  });

  it('offers only STL for a mesh, which has no B-rep', () => {
    expect(submenuIds(exportMenuItem([target('mesh', 'mesh_a')], LABELS))).toEqual([
      'export-stl',
    ]);
  });

  it('exports exactly the picked objects and names a single one after it', () => {
    const calls: string[][] = [];
    useExportStore.setState({
      requestStl: (bodyIds, nameSingleBody) => {
        calls.push(['stl', String(nameSingleBody), ...bodyIds]);
      },
      requestStep: async (bodyIds, nameSingleBody) => {
        calls.push(['step', String(nameSingleBody), ...bodyIds]);
      },
    });
    const item = exportMenuItem(
      [target('body', 'body_a'), target('mesh', 'mesh_a'), target('sketch', 'sketch_a')],
      LABELS,
    );
    if (!item || !('submenu' in item)) throw new Error('Export menu is missing');
    for (const entry of item.submenu) {
      if ('onSelect' in entry) entry.onSelect();
    }
    expect(calls).toEqual([
      ['stl', 'true', 'body_a', 'mesh_a'],
      ['step', 'true', 'body_a', 'mesh_a'],
    ]);
  });
});
