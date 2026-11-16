import { describe, expect, it } from 'vitest';
import { rearmWarm, tooltipDelay, WARM_DELAY, WARM_MS } from '../src/ui/tooltipTiming';

describe('tooltip timing', () => {
  it('waits in full when no tooltip has been read', () => {
    expect(tooltipDelay(1000, 0, 1000)).toBe(1000);
  });

  it('opens at once between neighbours of a tooltip that was just read', () => {
    expect(tooltipDelay(1000, 5000, 1000)).toBe(WARM_DELAY);
  });

  it('extends a window that is still running', () => {
    expect(rearmWarm(5000, 4000)).toBe(4000 + WARM_MS);
  });

  it('does not revive a window that has already passed', () => {
    // Leaving a control after the pause must not put the next tooltip on the
    // fast path: that kept every tooltip instant for the whole session.
    expect(rearmWarm(5000, 6000)).toBe(5000);
    expect(tooltipDelay(1000, 5000, 6000)).toBe(1000);
  });
});
