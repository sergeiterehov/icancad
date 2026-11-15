import { describe, expect, it } from 'vitest';
import {
  CAMERA_SCHEMES,
  cameraDragMode,
  cameraScheme,
  type CameraScheme,
} from '../src/viewport/cameraControls';

const gesture = (
  button: number,
  modifiers: Partial<{ shift: boolean; alt: boolean; ctrl: boolean }> = {},
) => ({
  button,
  shift: modifiers.shift ?? false,
  alt: modifiers.alt ?? false,
  ctrl: modifiers.ctrl ?? false,
});

const schemeOf = (id: string): CameraScheme => CAMERA_SCHEMES.find((scheme) => scheme.id === id)!;

describe('camera schemes', () => {
  it('falls back to the default scheme for an unknown id', () => {
    expect(cameraScheme(null).id).toBe('blender');
    expect(cameraScheme(undefined).id).toBe('blender');
    // The scheme the app used to have: a stored choice of it now means nothing.
    expect(cameraScheme('icancad').id).toBe('blender');
    expect(cameraScheme('fusion').id).toBe('fusion');
  });

  it('turns the view with the wheel button by default', () => {
    const scheme = cameraScheme();
    expect(cameraDragMode(scheme, gesture(1))).toBe('orbit');
    expect(cameraDragMode(scheme, gesture(0, { alt: true }))).toBe('orbit');
    expect(cameraDragMode(scheme, gesture(1, { shift: true }))).toBe('pan');
    expect(cameraDragMode(scheme, gesture(0, { shift: true, alt: true }))).toBe('pan');
  });

  it('swaps orbit and pan for a Fusion-style scheme', () => {
    const scheme = cameraScheme('fusion');
    expect(cameraDragMode(scheme, gesture(1))).toBe('pan');
    expect(cameraDragMode(scheme, gesture(1, { shift: true }))).toBe('orbit');
  });

  it('pans with Ctrl in SOLIDWORKS and with Shift in SketchUp', () => {
    expect(cameraDragMode(cameraScheme('solidworks'), gesture(1, { ctrl: true }))).toBe('pan');
    expect(cameraDragMode(cameraScheme('solidworks'), gesture(1, { shift: true }))).toBeNull();
    expect(cameraDragMode(cameraScheme('sketchup'), gesture(1, { shift: true }))).toBe('pan');
    expect(cameraDragMode(cameraScheme('sketchup'), gesture(1, { ctrl: true }))).toBeNull();
  });

  it('leaves an unmodified left button to selection in every scheme', () => {
    for (const scheme of CAMERA_SCHEMES) {
      expect(cameraDragMode(scheme, gesture(0))).toBeNull();
    }
  });

  it('mirrors every wheel-button drag on Alt with the left button', () => {
    for (const scheme of CAMERA_SCHEMES) {
      const wheelDrags = [...scheme.orbit, ...scheme.pan].filter(
        (binding) => binding.button === 1,
      );
      expect(wheelDrags.length).toBeGreaterThan(0);
      for (const binding of wheelDrags) {
        // A trackpad has no wheel button, so Alt with the left button has to do
        // the same thing, with the same modifiers.
        expect(
          cameraDragMode(scheme, {
            button: 0,
            shift: Boolean(binding.shift),
            alt: true,
            ctrl: Boolean(binding.ctrl),
          }),
          `${scheme.id}: ${JSON.stringify(binding)}`,
        ).not.toBeNull();
      }
    }
  });

  it('turns the view around the pointer and zooms to it in every scheme', () => {
    for (const scheme of CAMERA_SCHEMES) {
      expect(scheme.pivot).toBe('cursor');
      expect(scheme.zoomToCursor).toBe(true);
    }
  });
});

describe('camera scheme table', () => {
  it('names every scheme', () => {
    for (const scheme of CAMERA_SCHEMES) {
      expect(scheme.label).toMatch(/^nav\./);
    }
    expect(new Set(CAMERA_SCHEMES.map((scheme) => scheme.id)).size).toBe(CAMERA_SCHEMES.length);
  });

  it('lists the default scheme first', () => {
    expect(CAMERA_SCHEMES[0]?.id).toBe('blender');
    expect(schemeOf('blender')).toBe(CAMERA_SCHEMES[0]);
  });

  it('gives every scheme a way to orbit and a way to pan', () => {
    for (const scheme of CAMERA_SCHEMES) {
      expect(scheme.orbit.length).toBeGreaterThan(0);
      expect(scheme.pan.length).toBeGreaterThan(0);
    }
  });
});
