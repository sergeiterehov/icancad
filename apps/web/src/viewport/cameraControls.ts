import type { OrbitPivot } from './orbitPivot';

/**
 * How the pointer drives the camera. Programs disagree about which button
 * orbits and which one pans, so a scheme is a table instead of a pile of
 * conditions in the renderer: the nav cube offers the same list in its menu and
 * the choice is remembered between sessions.
 *
 * Every scheme also has to work without a wheel button: a trackpad has no middle
 * click, so the schemes of programs that emulate one offer the same gestures
 * with Alt held down.
 */

export type CameraSchemeId = 'blender' | 'fusion' | 'solidworks' | 'sketchup';

/**
 * A pointer state that starts a camera drag. The modifiers a binding leaves out
 * must not be pressed, so `Shift + middle` and `middle` are different gestures.
 */
export interface CameraBinding {
  button: 0 | 1 | 2;
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
}

/** The part of a pointer event a binding reads. Ctrl stands for Cmd as well. */
export interface PointerGesture {
  button: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

/** What a camera drag does to the view. */
export type CameraDragMode = 'orbit' | 'pan';

export interface CameraScheme {
  id: CameraSchemeId;
  /** Translation key of the name shown in the nav cube menu. */
  label: string;
  orbit: readonly CameraBinding[];
  pan: readonly CameraBinding[];
  /** Where a drag puts the point the view turns around. */
  pivot: OrbitPivot;
  /** The wheel keeps the point under the pointer in place instead of the centre. */
  zoomToCursor: boolean;
  /**
   * A two-finger scroll turns the view instead of zooming it. Blender does this;
   * the schemes that zoom with their wheel keep zooming on a trackpad too.
   */
  scrollOrbits: boolean;
}

export const CAMERA_SCHEMES: readonly CameraScheme[] = [
  {
    id: 'blender',
    label: 'nav.schemeBlender',
    // Blender turns the view with the wheel button, pans with Shift held, and
    // offers the same two gestures on Alt with the left button for a trackpad
    // ("Emulate 3 Button Mouse"). The default scheme of the app.
    orbit: [{ button: 1 }, { button: 0, alt: true }],
    pan: [{ button: 1, shift: true }, { button: 0, shift: true, alt: true }],
    pivot: 'cursor',
    zoomToCursor: true,
    // A trackpad has no wheel button, so its wheel does the turning: two fingers
    // scroll to orbit, Shift with them pans, and a pinch zooms.
    scrollOrbits: true,
  },
  {
    id: 'fusion',
    label: 'nav.schemeFusion',
    // Fusion 360 pans with the wheel button and orbits with Shift held.
    orbit: [{ button: 1, shift: true }, { button: 0, shift: true, alt: true }],
    pan: [{ button: 1 }, { button: 0, alt: true }],
    pivot: 'cursor',
    zoomToCursor: true,
    scrollOrbits: false,
  },
  {
    id: 'solidworks',
    label: 'nav.schemeSolidworks',
    // SOLIDWORKS rotates with the wheel button and pans with Ctrl held.
    orbit: [{ button: 1 }, { button: 0, alt: true }],
    pan: [{ button: 1, ctrl: true }, { button: 0, ctrl: true, alt: true }],
    pivot: 'cursor',
    zoomToCursor: true,
    scrollOrbits: false,
  },
  {
    id: 'sketchup',
    label: 'nav.schemeSketchup',
    // SketchUp orbits the point under the pointer and pans with Shift held.
    orbit: [{ button: 1 }, { button: 0, alt: true }],
    pan: [{ button: 1, shift: true }, { button: 0, shift: true, alt: true }],
    pivot: 'cursor',
    zoomToCursor: true,
    scrollOrbits: false,
  },
];

export const DEFAULT_CAMERA_SCHEME: CameraSchemeId = 'blender';

/**
 * How a drag turns the view. A turntable keeps the horizon level, so the model
 * always stands the way it is modelled; a trackball turns it like a ball in the
 * hand and lets the horizon tilt.
 */
export type OrbitStyle = 'turntable' | 'trackball';

export const ORBIT_STYLES: readonly OrbitStyle[] = ['turntable', 'trackball'];

export const DEFAULT_ORBIT_STYLE: OrbitStyle = 'turntable';

export function isOrbitStyle(value: string | null | undefined): value is OrbitStyle {
  return ORBIT_STYLES.some((candidate) => candidate === value);
}

export function isCameraSchemeId(value: string | null | undefined): value is CameraSchemeId {
  return CAMERA_SCHEMES.some((scheme) => scheme.id === value);
}

/** The scheme with that id, or the default one when the id is unknown. */
export function cameraScheme(id?: string | null): CameraScheme {
  return (
    CAMERA_SCHEMES.find((scheme) => scheme.id === id) ??
    CAMERA_SCHEMES.find((scheme) => scheme.id === DEFAULT_CAMERA_SCHEME)!
  );
}

/**
 * What a pointer press starts, or null when it belongs to selection, a handle
 * or a context menu. Orbit is answered first: a scheme may bind the same button
 * to both, and turning the view is the harder gesture to reach any other way.
 */
export function cameraDragMode(
  scheme: CameraScheme,
  gesture: PointerGesture,
): CameraDragMode | null {
  if (scheme.orbit.some((binding) => bindingMatches(binding, gesture))) return 'orbit';
  if (scheme.pan.some((binding) => bindingMatches(binding, gesture))) return 'pan';
  return null;
}

function bindingMatches(binding: CameraBinding, gesture: PointerGesture): boolean {
  return (
    binding.button === gesture.button &&
    Boolean(binding.shift) === gesture.shift &&
    Boolean(binding.alt) === gesture.alt &&
    Boolean(binding.ctrl) === gesture.ctrl
  );
}
