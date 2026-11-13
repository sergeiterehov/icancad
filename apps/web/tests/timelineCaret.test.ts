import { describe, expect, it } from 'vitest';
import { timelineCaretMark } from '../src/ui/timelineCaret';

describe('timeline caret marks', () => {
  it('marks the caret in front of the failed operation', () => {
    // Caret 2 sits between the second and the third operation, so the failure
    // is the third one: the model stops before it.
    expect(timelineCaretMark(2, 2)).toBe('error');
  });

  it('keeps the carets before the failure reachable', () => {
    expect(timelineCaretMark(0, 2)).toBe('normal');
    expect(timelineCaretMark(1, 2)).toBe('normal');
  });

  it('makes every position after the failure unreachable', () => {
    expect(timelineCaretMark(3, 2)).toBe('unreachable');
    expect(timelineCaretMark(7, 2)).toBe('unreachable');
  });

  it('leaves a healthy history alone', () => {
    expect(timelineCaretMark(0, -1)).toBe('normal');
    expect(timelineCaretMark(4, -1)).toBe('normal');
  });
});
