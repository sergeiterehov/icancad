import type { Feature } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { RebuildCache, type RebuildCheckpoint } from '../src/kernel/checkpoints';

function feature(id: string): Feature {
  return {
    id,
    name: id,
    suppressed: false,
    type: 'primitive',
    kind: 'box',
    params: { dx: 1, dy: 1, dz: 1 },
    transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
  };
}

function checkpoint(features: readonly Feature[], index: number): RebuildCheckpoint<string> {
  return {
    index,
    prefix: features.slice(0, index + 1),
    state: `after-${features[index]!.id}`,
  };
}

describe('RebuildCache', () => {
  it('returns the newest snapshot that fits the cursor', () => {
    const cache = new RebuildCache<string>();
    const features = [feature('a'), feature('b'), feature('c')];
    cache.store(checkpoint(features, 0));
    cache.store(checkpoint(features, 1));
    cache.store(checkpoint(features, 2));

    expect(cache.find(features, 2)?.state).toBe('after-c');
    expect(cache.find(features, 1)?.state).toBe('after-b');
    expect(cache.find(features, 0)?.state).toBe('after-a');
    expect(cache.find(features, -1)).toBeNull();
  });

  it('drops snapshots of an edited operation and of everything after it', () => {
    const cache = new RebuildCache<string>();
    const features = [feature('a'), feature('b'), feature('c')];
    cache.store(checkpoint(features, 0));
    cache.store(checkpoint(features, 1));
    cache.store(checkpoint(features, 2));

    // Editing `b` replaces the feature object, so its prefix no longer matches.
    const edited = [features[0]!, feature('b'), features[2]!];
    expect(cache.find(edited, 2)?.state).toBe('after-a');
    expect(cache.size).toBe(1);
  });

  it('invalidates explicitly from an index', () => {
    const cache = new RebuildCache<string>();
    const features = [feature('a'), feature('b'), feature('c')];
    for (let index = 0; index < features.length; index += 1) {
      cache.store(checkpoint(features, index));
    }

    expect(cache.invalidateFrom(1)).toBe(2);
    expect(cache.find(features, 2)?.state).toBe('after-a');
  });

  it('forgets snapshots of removed operations', () => {
    const cache = new RebuildCache<string>();
    const features = [feature('a'), feature('b'), feature('c')];
    cache.store(checkpoint(features, 0));
    cache.store(checkpoint(features, 1));
    cache.store(checkpoint(features, 2));

    const shortened = [features[0]!, features[1]!];
    expect(cache.find(shortened, 1)?.state).toBe('after-b');
    expect(cache.size).toBe(2);
  });

  it('replaces a snapshot for the same index', () => {
    const cache = new RebuildCache<string>();
    const features = [feature('a')];
    cache.store(checkpoint(features, 0));
    cache.store({ ...checkpoint(features, 0), state: 'rebuilt' });
    expect(cache.size).toBe(1);
    expect(cache.find(features, 0)?.state).toBe('rebuilt');
  });
});
