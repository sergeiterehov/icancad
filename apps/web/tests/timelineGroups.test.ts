import { describe, expect, it } from 'vitest';
import {
  groupableRun,
  holdingGroup,
  levelCaretPosition,
  menuEntryTargets,
  type LevelNode,
} from '../src/ui/timelineGroups';
import type { SelectionItem } from '../src/stores/documentStore';

const feature = (id: string, start: number): LevelNode => ({
  id,
  kind: 'feature',
  start,
  end: start,
});

// Two folders with one operation after them: a, b, [c, d], e.
const nodes: LevelNode[] = [
  feature('a', 0),
  feature('b', 1),
  { id: 'g1', kind: 'group', start: 2, end: 3 },
  feature('e', 4),
];

const selected = (...ids: string[]): SelectionItem[] =>
  ids.map((id) => ({ kind: id.startsWith('g') ? 'group' : 'feature', id }));

describe('timeline levels', () => {
  it('puts a cursor outside the level on its edge', () => {
    expect(levelCaretPosition(0, 2, 4)).toBe(2);
    expect(levelCaretPosition(1, 2, 4)).toBe(2);
    expect(levelCaretPosition(3, 2, 4)).toBe(3);
    expect(levelCaretPosition(4, 2, 4)).toBe(4);
    expect(levelCaretPosition(9, 2, 4)).toBe(4);
  });

  it('keeps caret positions flat when a folder sits before them', () => {
    // The folder covers two operations, so the caret after it is 3, not 2.
    const level: LevelNode[] = [
      feature('a', 0),
      { id: 'g1', kind: 'group', start: 1, end: 2 },
      feature('d', 3),
    ];
    expect(levelCaretPosition(3, 0, 4)).toBe(level[2]?.start);
    expect(levelCaretPosition(4, 0, 4)).toBe(4);
    expect(levelCaretPosition(2, 0, 4)).toBe(2);
    expect(holdingGroup(level, levelCaretPosition(2, 0, 4))?.id).toBe('g1');
  });

  it('hides the caret inside a folder and shows it at its end', () => {
    expect(holdingGroup(nodes, 0)).toBeNull();
    expect(holdingGroup(nodes, 1)).toBeNull();
    // Caret 2 is in front of the folder, caret 3 follows its first operation.
    expect(holdingGroup(nodes, 2)).toBeNull();
    expect(holdingGroup(nodes, 3)?.id).toBe('g1');
    // Caret 4 is after the last operation of the folder.
    expect(holdingGroup(nodes, 4)).toBeNull();
  });
});

describe('grouping a run', () => {
  it('takes the whole selected stretch', () => {
    expect(groupableRun(nodes, selected('a', 'b'), 'a')).toEqual(['a', 'b']);
    expect(groupableRun(nodes, selected('b', 'g1', 'e'), 'g1')).toEqual(['b', 'g1', 'e']);
  });

  it('needs the clicked item in the selection', () => {
    expect(groupableRun(nodes, selected('a', 'b'), 'e')).toBeNull();
  });

  it('refuses a selection of one item', () => {
    expect(groupableRun(nodes, selected('a'), 'a')).toBeNull();
  });

  it('refuses a selection with a gap in it', () => {
    expect(groupableRun(nodes, selected('a', 'g1'), 'a')).toBeNull();
  });

  it('ignores items that belong to another level', () => {
    expect(groupableRun(nodes, selected('a', 'b', 'other'), 'b')).toEqual(['a', 'b']);
  });
});

describe('timeline menu targets', () => {
  it('takes the whole level selection the clicked item belongs to', () => {
    expect(menuEntryTargets(nodes, selected('a', 'b'), 'b')).toEqual(['a', 'b']);
  });

  it('takes one item when the clicked one is not selected', () => {
    expect(menuEntryTargets(nodes, selected('a', 'b'), 'e')).toEqual(['e']);
  });

  it('does not reach outside the level', () => {
    expect(menuEntryTargets(nodes, selected('a', 'other'), 'a')).toEqual(['a']);
  });
});
