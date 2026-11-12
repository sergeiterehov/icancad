import type { SplitSolid } from '@icancad/kernel';

/**
 * Which part of a split keeps the original body and which become new bodies.
 * The largest part keeps the body so its name, colour and history stay where
 * the user expects them; equal parts fall back to a stable position order.
 */
export interface SplitAssignment {
  main: SplitSolid;
  extras: SplitSolid[];
}

const VOLUME_TOLERANCE = 1e-6;

function compareSolids(a: SplitSolid, b: SplitSolid): number {
  const delta = b.volume - a.volume;
  const scale = Math.max(1, Math.abs(a.volume), Math.abs(b.volume));
  if (Math.abs(delta) > VOLUME_TOLERANCE * scale) return delta;
  return (
    a.center[0] - b.center[0] || a.center[1] - b.center[1] || a.center[2] - b.center[2]
  );
}

export function splitAssignment(solids: readonly SplitSolid[]): SplitAssignment | null {
  if (solids.length < 2) return null;
  const [main, ...extras] = [...solids].sort(compareSolids);
  return main ? { main, extras } : null;
}

/** Stable id of a body a boolean split off an existing body. */
export function splitBodyId(featureId: string, sourceBodyId: string, slot: number): string {
  return `${featureId}:split:${sourceBodyId}:${slot}`;
}
