import { describe, expect, it } from 'vitest';
import { RenderOrder, solidDepthBias } from '../src/viewport/renderOrder';

describe('render order', () => {
  it('keeps the base model behind every annotation', () => {
    const annotations = [
      RenderOrder.bodyEdge,
      RenderOrder.section,
      RenderOrder.sketchFace,
      RenderOrder.phantom,
      RenderOrder.delta,
      RenderOrder.faceOverlay,
      RenderOrder.sketch,
      RenderOrder.annotation,
      RenderOrder.handle,
    ];
    for (const order of annotations) expect(order).toBeGreaterThan(RenderOrder.solid);
  });

  it('draws operation deltas over section hatching and face tints', () => {
    expect(RenderOrder.delta).toBeGreaterThan(RenderOrder.section);
    expect(RenderOrder.delta).toBeGreaterThan(RenderOrder.sketchFace);
    expect(RenderOrder.faceOverlay).toBeGreaterThan(RenderOrder.delta);
  });

  it('keeps gizmos above the model and its annotations', () => {
    for (const order of [RenderOrder.sketch, RenderOrder.sketchGrid, RenderOrder.annotation]) {
      expect(RenderOrder.handle).toBeGreaterThan(order);
    }
  });

  it('never gives two layers the same slot', () => {
    const values = Object.values(RenderOrder);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('solid depth bias', () => {
  it('leaves the object at the bottom of the tree unbiased', () => {
    expect(solidDepthBias(2, 3)).toBe(0);
    expect(solidDepthBias(0, 1)).toBe(0);
  });

  it('steps every row above it back by the same amount', () => {
    expect(solidDepthBias(1, 3)).toBeGreaterThan(solidDepthBias(2, 3));
    expect(solidDepthBias(0, 3) - solidDepthBias(1, 3)).toBe(
      solidDepthBias(1, 3) - solidDepthBias(2, 3),
    );
  });

  it('never pulls a body forward', () => {
    for (const order of [0, 1, 5, 40]) {
      expect(solidDepthBias(order, 41)).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps a long list from shifting the top bodies by a visible amount', () => {
    const first = solidDepthBias(0, 500);
    expect(first).toBe(solidDepthBias(0, 25));
    expect(first).toBeLessThanOrEqual(24);
  });
});
