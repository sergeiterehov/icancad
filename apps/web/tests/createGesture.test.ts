import { describe, expect, it } from 'vitest';
import {
  dragAnchors,
  dragCreates,
  dragEndsChain,
  isTap,
  TAP_SLOP_PX,
} from '../src/sketch/createGesture';

describe('tap or stretch', () => {
  it('calls a press and release in the same place a tap', () => {
    expect(isTap(0, 0)).toBe(true);
    expect(isTap(TAP_SLOP_PX, 0)).toBe(true);
    expect(isTap(TAP_SLOP_PX - 1, 0)).toBe(true);
  });

  it('calls a press that travelled a stretch', () => {
    expect(isTap(TAP_SLOP_PX + 1, 0)).toBe(false);
    expect(isTap(0, -40)).toBe(false);
  });

  it('turns a finger or a pen into a stretch, and never a mouse', () => {
    expect(dragCreates('touch', 30, 0)).toBe(true);
    expect(dragCreates('pen', 0, 30)).toBe(true);
    expect(dragCreates('mouse', 300, 0)).toBe(false);
  });

  it('keeps a finger that did not travel a tap', () => {
    expect(dragCreates('touch', 3, 3)).toBe(false);
  });
});

describe('what a stretch leaves behind', () => {
  it('anchors the press point for every tool that builds from a start', () => {
    for (const tool of ['line', 'circle', 'arc', 'ellipse', 'bezier']) {
      expect(dragAnchors(tool, 0), tool).toBe(true);
    }
  });

  it('uses the draft that is already there instead of a new anchor', () => {
    expect(dragAnchors('line', 1)).toBe(false);
    expect(dragAnchors('circle', 1)).toBe(false);
  });

  it('never anchors a point, so the point follows the finger', () => {
    expect(dragAnchors('point', 0)).toBe(false);
  });

  it('ends the chain for the tools a stretch names both ends of', () => {
    expect(dragEndsChain('line')).toBe(true);
    expect(dragEndsChain('bezier')).toBe(true);
    for (const tool of ['point', 'circle', 'ellipse', 'arc']) {
      expect(dragEndsChain(tool), tool).toBe(false);
    }
  });
});
