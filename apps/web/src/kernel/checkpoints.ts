import type { Feature } from '@icancad/model';

/** Model state captured once the operation at `index` has been evaluated. */
export interface RebuildCheckpoint<TState> {
  /** Index of the last operation included in the snapshot. */
  index: number;
  /**
   * The exact feature objects the snapshot was built from. Operations are
   * immutable, so identity is enough to tell whether the history that produced
   * the snapshot is still the same.
   */
  prefix: readonly Feature[];
  state: TState;
}

function prefixMatches(features: readonly Feature[], prefix: readonly Feature[]): boolean {
  if (prefix.length > features.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (features[index] !== prefix[index]) return false;
  }
  return true;
}

/**
 * Per-operation snapshots of the kernel rebuild state. Editing an operation
 * replaces its feature object, so every snapshot from that operation on stops
 * matching and is discarded, while earlier snapshots stay usable.
 */
export class RebuildCache<TState> {
  private checkpoints: RebuildCheckpoint<TState>[] = [];

  get size(): number {
    return this.checkpoints.length;
  }

  /**
   * Drops snapshots whose operations are no longer the same and returns the
   * newest matching snapshot built at or before `endIndex`.
   */
  find(features: readonly Feature[], endIndex: number): RebuildCheckpoint<TState> | null {
    let best: RebuildCheckpoint<TState> | null = null;
    const kept: RebuildCheckpoint<TState>[] = [];
    for (const checkpoint of this.checkpoints) {
      if (!prefixMatches(features, checkpoint.prefix)) continue;
      kept.push(checkpoint);
      if (checkpoint.index <= endIndex && (!best || checkpoint.index > best.index)) {
        best = checkpoint;
      }
    }
    this.checkpoints = kept;
    return best;
  }

  /** True when a snapshot for this exact prefix is already stored. */
  has(features: readonly Feature[], index: number): boolean {
    return this.checkpoints.some(
      (checkpoint) => checkpoint.index === index && prefixMatches(features, checkpoint.prefix),
    );
  }

  store(checkpoint: RebuildCheckpoint<TState>): void {
    this.checkpoints = this.checkpoints.filter(
      (candidate) => candidate.index !== checkpoint.index,
    );
    this.checkpoints.push(checkpoint);
    this.checkpoints.sort((a, b) => a.index - b.index);
  }

  /** Snapshots still held, used to keep their kernel shapes alive. */
  all(): readonly RebuildCheckpoint<TState>[] {
    return this.checkpoints;
  }

  /** Drops every snapshot that includes the operation at `index` or a later one. */
  invalidateFrom(index: number): number {
    const before = this.checkpoints.length;
    this.checkpoints = this.checkpoints.filter((checkpoint) => checkpoint.index < index);
    return before - this.checkpoints.length;
  }

  clear(): void {
    this.checkpoints = [];
  }
}
