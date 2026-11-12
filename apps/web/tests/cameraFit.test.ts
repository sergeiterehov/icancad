import { describe, expect, it } from 'vitest';
import {
  CAMERA_FOV_DEGREES,
  CAMERA_REACH,
  FIT_MARGIN_PX,
  cameraFrustum,
  easeInOut,
  fitDistance,
  shortestAngle,
} from '../src/viewport/cameraFit';

const WIDTH = 1000;
const HEIGHT = 800;

function projected(
  span: number,
  distance: number,
  viewportPx: number,
  axis: 'width' | 'height',
) {
  const tan = Math.tan((CAMERA_FOV_DEGREES * Math.PI) / 180 / 2);
  const visible = 2 * distance * tan * (axis === 'width' ? WIDTH / HEIGHT : 1);
  return (span / visible) * viewportPx;
}

describe('fitDistance', () => {
  it('leaves the requested margin on the limiting axis', () => {
    const distance = fitDistance(400, 100, WIDTH, HEIGHT);
    expect(projected(400, distance, WIDTH, 'width')).toBeCloseTo(WIDTH - FIT_MARGIN_PX * 2, 5);
  });

  it('fits tall content by height', () => {
    const distance = fitDistance(100, 600, WIDTH, HEIGHT);
    expect(projected(600, distance, HEIGHT, 'height')).toBeCloseTo(HEIGHT - FIT_MARGIN_PX * 2, 5);
    expect(projected(100, distance, WIDTH, 'width')).toBeLessThan(WIDTH - FIT_MARGIN_PX * 2);
  });

  it('never returns a degenerate distance for empty content', () => {
    expect(fitDistance(0, 0, WIDTH, HEIGHT)).toBe(0.05);
  });

  it('zooms out for larger content', () => {
    expect(fitDistance(400, 100, WIDTH, HEIGHT)).toBeGreaterThan(
      fitDistance(200, 100, WIDTH, HEIGHT),
    );
  });
});

describe('camera easing', () => {
  it('is symmetric and reaches both ends', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 6);
    expect(easeInOut(0.25)).toBeCloseTo(1 - easeInOut(0.75), 6);
  });

  it('takes the shorter rotation arc', () => {
    expect(shortestAngle(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 6);
    expect(shortestAngle((350 * Math.PI) / 180, (10 * Math.PI) / 180)).toBeCloseTo(
      (20 * Math.PI) / 180,
      6,
    );
    expect(shortestAngle(Math.PI, -Math.PI)).toBeCloseTo(0, 6);
  });
});

describe('cameraFrustum', () => {
  it('keeps the eye outside the content however deep the zoom is', () => {
    const radius = 17.3;
    for (const distance of [0.05, 1, 50, 500, 100_000]) {
      const { eye, near } = cameraFrustum(distance, radius);
      // The nearest possible vertex sits `radius` in front of the target.
      expect(eye - radius).toBeGreaterThan(near);
    }
  });

  it('keeps the eye behind the content when zoomed in', () => {
    expect(cameraFrustum(0.05, 17.3).eye).toBeCloseTo(34.65, 6);
    // Zooming out still pushes the eye out, so the view never crosses the model.
    expect(cameraFrustum(500, 17.3).eye).toBeCloseTo(534.6, 6);
  });

  it('covers the ground grid and the section caps at every zoom', () => {
    for (const distance of [0.05, 10, 1000]) {
      const { far, eye } = cameraFrustum(distance, 17.3);
      expect(far - eye).toBeGreaterThanOrEqual(CAMERA_REACH);
    }
  });

  it('keeps a positive depth range for an empty scene', () => {
    const { eye, near, far } = cameraFrustum(200, 0);
    expect(eye).toBeGreaterThan(near);
    expect(far).toBeGreaterThan(eye);
  });
});
