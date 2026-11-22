import type { SketchFeature } from '@icancad/model';
import { SKETCH_ORIGIN_ID } from '@icancad/sketch';
import { describe, expect, it } from 'vitest';
import { constructionSelection, toggleConstruction } from '../src/sketch/construction';
import { referenceMenuItems } from '../src/sketch/referenceMenu';

const feature: SketchFeature = {
  id: 'sketch',
  type: 'sketch',
  name: 'Sketch',
  suppressed: false,
  plane: { type: 'datum', plane: 'XY', offset: 0 },
  references: [],
  constraints: [],
  entities: [
    { id: 'line', type: 'line', construction: false, x1: 0, y1: 0, x2: 10, y2: 0 },
    { id: 'circle', type: 'circle', construction: true, cx: 0, cy: 0, r: 5 },
  ],
};

describe('construction toggle', () => {
  it('ignores point indices and fundamental geometry', () => {
    expect(constructionSelection(feature, ['line#0', SKETCH_ORIGIN_ID])).toEqual([]);
  });

  it('turns the selected geometry on and keeps the rest untouched', () => {
    const next = toggleConstruction(feature, ['line']);
    expect(next?.entities).toEqual([
      { id: 'line', type: 'line', construction: true, x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'circle', type: 'circle', construction: true, cx: 0, cy: 0, r: 5 },
    ]);
  });

  it('turns a fully construction selection off', () => {
    const next = toggleConstruction(feature, ['circle']);
    expect(next?.entities[1]).toMatchObject({ id: 'circle', construction: false });
  });

  it('gives a mixed selection one state instead of flipping each member apart', () => {
    const next = toggleConstruction(feature, ['line', 'circle']);
    expect(next?.entities.every((entity) => entity.construction)).toBe(true);
  });

  it('does nothing without geometry to toggle', () => {
    expect(toggleConstruction(feature, [])).toBeNull();
    expect(toggleConstruction(feature, [SKETCH_ORIGIN_ID])).toBeNull();
  });
});

/** The menu row that toggles construction, narrowed past the separators. */
function constructionRow(items: ReturnType<typeof referenceMenuItems>) {
  const item = items.find(
    (candidate): candidate is Extract<typeof candidate, { onSelect: () => void }> =>
      candidate.id === 'toggle-construction' && 'onSelect' in candidate,
  );
  if (!item) throw new Error('NO_CONSTRUCTION_ROW');
  return item;
}

describe('construction in the geometry context menu', () => {
  const withPoint: SketchFeature = {
    ...feature,
    entities: [...feature.entities, { id: 'dot', type: 'point', construction: false, x: 2, y: 2 }],
  };
  const t = (key: string) => key;

  it('toggles the whole selection the menu was opened on', () => {
    const items = referenceMenuItems(withPoint, 'line', t, 'en', () => {}, {
      selectedEntityIds: ['line', 'circle'],
    });
    expect(constructionRow(items)).toMatchObject({ checked: false });
    let next: SketchFeature | undefined;
    const applied = referenceMenuItems(withPoint, 'line', t, 'en', (value) => (next = value), {
      selectedEntityIds: ['line', 'circle'],
    });
    constructionRow(applied).onSelect();
    expect(next?.entities.map((entity) => entity.construction)).toEqual([true, true, false]);
  });

  it('toggles only the right-clicked geometry when it sits outside the selection', () => {
    let next: SketchFeature | undefined;
    const items = referenceMenuItems(withPoint, 'dot', t, 'en', (value) => (next = value), {
      selectedEntityIds: ['line'],
    });
    constructionRow(items).onSelect();
    expect(next?.entities.map((entity) => [entity.id, entity.construction])).toEqual([
      ['line', false],
      ['circle', true],
      ['dot', true],
    ]);
  });
});
