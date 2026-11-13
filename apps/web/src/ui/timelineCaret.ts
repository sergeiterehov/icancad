/**
 * How a timeline caret relates to the first failed operation. The caret sits
 * in front of an operation, so the barrier is the one before the failure:
 * everything after it is never built.
 */
export type TimelineCaretMark = 'normal' | 'error' | 'unreachable';

export function timelineCaretMark(index: number, failedIndex: number): TimelineCaretMark {
  if (failedIndex < 0) return 'normal';
  if (index === failedIndex) return 'error';
  return index > failedIndex ? 'unreachable' : 'normal';
}
