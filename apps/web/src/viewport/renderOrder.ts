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
  /** The busy wave over a body, above its surface but below its edges. */
  bodyWave: 0.5,
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
  /** The sketch grid, below its curves but above its fills. */
  sketchGrid: 17,
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

/**
 * Depth-buffer units one row of the object tree is worth when two solids meet
 * on a surface. Two bodies that share a plane — a cylinder standing on a box,
 * the same primitive twice — compute almost the same depth there, and the
 * winner changes from pixel to pixel, which is the stipple along the seam.
 */
const SOLID_DEPTH_STEP = 1;

/**
 * Ceiling of the whole bias. A long list keeps its newest rows apart and lets
 * the oldest share a bias, which beats shifting a body far enough to show.
 */
const SOLID_DEPTH_MAX = 24;

/**
 * Depth bias of a solid, counted from its place in the object tree. The last
 * row keeps no bias at all and every row above it is pushed back one step, so a
 * shared surface belongs to the object listed lower, the way a later object
 * covers an earlier one in the panel. Values are depth-buffer units, far below
 * a millimetre, so only surfaces lying on each other are separated.
 */
export function solidDepthBias(order: number, count: number): number {
  return Math.min(SOLID_DEPTH_MAX, Math.max(0, count - 1 - order) * SOLID_DEPTH_STEP);
}
