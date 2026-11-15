import { describe, expect, it } from 'vitest';
import { closesOnLeave, dockHand, opensOnHover, showsTab } from '../src/ui/dockGesture';

describe('the hand at a dock', () => {
  it('reads a finger as a touch and everything else as a cursor', () => {
    expect(dockHand('touch')).toBe('touch');
    // A pen hovers and a mouse hovers: both can work the panel by being over it.
    expect(dockHand('pen')).toBe('hover');
    expect(dockHand('mouse')).toBe('hover');
  });
});

describe('a dock under a cursor', () => {
  it('unfolds by itself', () => {
    expect(opensOnHover('hover')).toBe(true);
  });

  it('gives the panel back when the cursor leaves', () => {
    expect(closesOnLeave('hover', false)).toBe(true);
  });

  it('keeps the panel a subject holds', () => {
    // The inspector of a selected operation is a form to read, not a panel that
    // disappears because the mouse crossed the scene.
    expect(closesOnLeave('hover', true)).toBe(false);
  });

  it('keeps the panel its own menu is read from', () => {
    // The menu is drawn over the scene, so reading it leaves the panel behind.
    expect(closesOnLeave('hover', false, true)).toBe(false);
  });

  it('shows the tongue only while the panel is away', () => {
    expect(showsTab('hover', false)).toBe(true);
    expect(showsTab('hover', true)).toBe(false);
  });
});

describe('a dock under a finger', () => {
  it('never unfolds by itself', () => {
    expect(opensOnHover('touch')).toBe(false);
  });

  it('never closes because nothing left it', () => {
    expect(closesOnLeave('touch', false)).toBe(false);
    expect(closesOnLeave('touch', true)).toBe(false);
  });

  it('keeps the tongue on screen whether the panel is open or away', () => {
    // It is the only way out a finger has.
    expect(showsTab('touch', true)).toBe(true);
    expect(showsTab('touch', false)).toBe(true);
  });
});
