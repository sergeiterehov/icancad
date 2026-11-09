import type { SectionPlane, SketchFeature, SketchFrame, Vec3 } from '@icancad/model';
import { datumFrame } from '@icancad/sketch';

export const SKETCH_SECTION_ID = '__sketch-plane__';

export function sketchFrameOf(feature: SketchFeature): SketchFrame {
  return feature.plane.type === 'datum'
    ? datumFrame(feature.plane.plane, feature.plane.offset)
    : (feature.plane.frame ?? datumFrame('XY', 0));
}

// The sketch plane cuts the model away in front of the camera, so the section
// at the sketch plane stays visible while the sketch is being edited.
export function sketchSectionPlane(feature: SketchFeature): SectionPlane {
  const frame = sketchFrameOf(feature);
  const normal = frame.normal.map((value) => -value) as Vec3;
  return {
    id: SKETCH_SECTION_ID,
    name: '',
    origin: [...frame.origin] as Vec3,
    normal,
    offset: 0,
    visible: true,
  };
}
