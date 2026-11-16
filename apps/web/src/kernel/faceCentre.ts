import type { FaceCentreResult } from '@icancad/kernel';
import type { Vec3 } from '@icancad/model';
import { getKernelClient } from './client';

/**
 * Middle of one face of a body, in the plane of that face.
 *
 * The middle of a face is the middle of what it covers, and only the exact
 * geometry says where that is: a tessellated arc stops short of its own extreme
 * by the sagitta of its chords. So the answer comes from the kernel, and the
 * caller keeps its own reading of the mesh for the case when the shape behind
 * the body is gone.
 */
export async function faceCentre(
  shapeId: string | undefined,
  faceId: number,
  normal: Vec3,
): Promise<Vec3 | null> {
  if (!shapeId) return null;
  try {
    const result = await getKernelClient().request<FaceCentreResult>({
      type: 'face-centre',
      params: { shapeId, faceId, normal },
    });
    return result.origin;
  } catch {
    // A face the kernel cannot measure still turns around something: the mesh
    // reading the caller already has.
    return null;
  }
}
