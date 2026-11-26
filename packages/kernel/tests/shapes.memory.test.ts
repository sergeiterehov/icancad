import { describe, expect, it } from 'vitest';
import { KernelEngine } from '../src/engine';
import { loadOcctNode } from '../src/occt-node';
import type { OcctBindings } from '../src/occt-types';

/**
 * A drag preview builds the same operation under the same shape id a hundred
 * times in a few seconds, and every pass tessellates the result for the screen.
 * OCCT memory only comes back when an object is deleted. It does not come back
 * when JavaScript merely forgets it: wasm objects wait for the finalizer, and a
 * phone runs out of memory long before the collector gets round to it — the
 * iOS tab is killed mid-gesture.
 *
 * The measure is the wasm heap, which only ever grows. Memory the kernel gives
 * back is handed out again, so the size stands still; a leak shows up as a
 * roughly constant number of bytes per pass. Without the frees these two loops
 * cost about 200 MB each, so a few megabytes is still two orders of magnitude
 * below a leak.
 */
describe('kernel memory', () => {
  it('keeps the wasm heap flat through a drag', async () => {
    const oc: OcctBindings = await loadOcctNode();
    const engine = new KernelEngine(() => Promise.resolve(oc));
    await engine.init();
    const heap = () => oc.HEAPU8?.buffer.byteLength ?? 0;
    const limit = 4 * 1024 * 1024;

    engine.makePrimitive({ kind: 'cylinder', shapeId: 'drawn', radius: 40, height: 60 });
    engine.makePrimitive({ kind: 'cylinder', shapeId: 'dragged', radius: 40, height: 60 });
    // Warm up, so the shapes and the caches they leave are not counted.
    for (let index = 0; index < 10; index += 1) engine.tessellate('drawn');
    let before = heap();
    for (let index = 0; index < 200; index += 1) engine.tessellate('drawn');
    expect(heap() - before).toBeLessThan(limit);

    const pass = (height: number) => {
      engine.makePrimitive({ kind: 'cylinder', shapeId: 'dragged', radius: 40, height });
      engine.tessellate('dragged');
    };
    for (let index = 0; index < 10; index += 1) pass(60 + index * 0.1);
    before = heap();
    for (let index = 0; index < 200; index += 1) pass(62 + index * 0.1);
    expect(heap() - before).toBeLessThan(limit);
    expect(engine.shapeCount).toBe(2);
  });
});
