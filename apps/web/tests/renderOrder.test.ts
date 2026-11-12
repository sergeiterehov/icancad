import { describe, expect, it } from 'vitest';
import { RenderOrder } from '../src/viewport/renderOrder';

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
