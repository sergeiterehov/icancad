import type { TessellationResult } from '@icancad/kernel';
import type { Vec3 } from '@icancad/model';
import { pointInMesh } from '../quick/geometry';

/** How far a union reaches behind its plane to overlap the body it joins. */
export const UNION_EMBED = 0.01;

/**
 * How far an add tool must reach behind its profile plane.
 *
 * A tool that only touches a body needs that sliver of overlap to fuse. A tool
 * whose sweep goes *into* the body already shares material along its length,
 * so reaching behind the plane would push its cap out of the body and leave a
 * 0.01 step and extra edges on the face the user sees.
 */
export function addEmbedFor(
  samples: readonly Vec3[],
  normal: Vec3,
  meshes: Record<string, TessellationResult>,
): number {
  if (samples.length === 0) return 0;
  // A profile can be sampled finely; a handful of points settles the question.
  const stride = Math.max(1, Math.ceil(samples.length / 24));
  for (const mesh of Object.values(meshes)) {
    for (let index = 0; index < samples.length; index += stride) {
      const sample = samples[index]!;
      const behind: Vec3 = [
        sample[0] - normal[0] * UNION_EMBED,
        sample[1] - normal[1] * UNION_EMBED,
        sample[2] - normal[2] * UNION_EMBED,
      ];
      if (pointInMesh(mesh, behind)) return UNION_EMBED;
    }
  }
  return 0;
}
