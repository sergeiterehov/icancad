import { BODY_COLORS, featureBodyId, type PrimitiveFeature, type Project } from '@icancad/model';
import type { ScenePreview } from '../stores/kernelStore';
import { primitivePreviewMesh } from './mesh';

/**
 * The primitive being edited is a delta, not a body: it draws as an overlay
 * ghost, ignores section planes and never runs through the kernel. The tree
 * still gets an added mark, but the viewport skips it because the ghost already
 * represents the object.
 */
export function primitivePreview(feature: PrimitiveFeature, project: Project): ScenePreview {
  const bodyId = featureBodyId(feature.id);
  const metadata = project.metadata[bodyId];
  const color =
    metadata?.color ??
    BODY_COLORS[
      project.bodies.filter((body) => body.kind !== 'mesh').length % BODY_COLORS.length
    ] ??
    '#6ea8fe';
  return {
    featureId: feature.id,
    bodies: [
      {
        id: bodyId,
        kind: 'added',
        name: metadata?.name ?? feature.name,
        color,
        ghostOnly: true,
      },
    ],
    ghosts: [
      {
        id: `primitive:${feature.id}`,
        mesh: primitivePreviewMesh(feature),
        color,
        opacity: 0.45,
      },
    ],
  };
}
