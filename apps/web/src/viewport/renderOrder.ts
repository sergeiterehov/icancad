/**
 * Explicit draw order of every scene layer. Higher numbers draw later, so the
 * order decides which coplanar surface wins. Depth testing still runs for the
 * model, the section and the phantom volumes; only gizmos (handles, points,
 * draft geometry) intentionally ignore depth.
 *
 * Keep this list as the single source of truth: a new layer picks a slot here
 * instead of using a bare number in the renderer.
 */
export const RenderOrder = {
  /** Ground grid, behind everything. */
  grid: -1,
  /** Opaque solid bodies. */
  solid: 0,
  /** Body outlines, drawn after the faces so depth ties go to the line. */
  bodyEdge: 1,
  /** Section caps and their hatching, over the exposed cut face. */
  section: 2,
  /** Sketch region fills and the sketch plane, over the section cap. */
  sketchFace: 3,
  /** Translucent bodies an operation adds, changes or removes. */
  phantom: 4,
  /** Operation tool volumes: the red removed shape, the green added delta. */
  delta: 5,
  /** Face selection and hover tints, over any planar annotation. */
  faceOverlayGroup: 6,
  faceOverlay: 7,
  /** Sketch curves and their annotations. */
  sketch: 18,
  /** The sketch grid, just above its curves. */
  sketchGrid: 19,
  /** Highlighted body edges and sketch preview lines. */
  annotation: 22,
  sketchDraft: 23,
  /** Hairline under a handle, so its arrow reads on a same-coloured body. */
  handleOutline: 23.5,
  /** Handles are gizmos: always on top of the model. */
  handle: 24,
  sketchPoint: 30,
  sketchPointActive: 31,
  sketchPhantom: 32,
} as const;
