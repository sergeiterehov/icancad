import { describe, expect, it } from 'vitest';
import { resolveSketchPoint, snapModeFor, snapTargetPoint } from '../src/sketch/resolvePoint';
import type { SketchSnap } from '../src/sketch/snap';

const snap = (
  point: SketchSnap['pointSnap'] = null,
  curve: SketchSnap['curveSnap'] = null,
  midpoint: SketchSnap['midpointSnap'] = null,
): SketchSnap => ({ point: [0, 0], pointSnap: point, curveSnap: curve, midpointSnap: midpoint });

describe('snap modes', () => {
  it('reads the magnet differently at each step of a tool', () => {
    expect(snapModeFor('circle', 0)).toBe('free');
    expect(snapModeFor('circle', 1)).toBe('tangent');
    expect(snapModeFor('arc', 1)).toBe('free');
    expect(snapModeFor('circle', 1)).toBe('tangent');
    expect(snapModeFor('ellipse', 1)).toBe('free');
    expect(snapModeFor('ellipse', 2)).toBe('none');
    // Both ends of an elliptical arc are points of the arc, so they snap; the
    // click that names the minor half-axis only gives a length.
    expect(snapModeFor('elliptical-arc', 2)).toBe('none');
    expect(snapModeFor('elliptical-arc', 3)).toBe('free');
    expect(snapModeFor('elliptical-arc', 4)).toBe('free');
    expect(snapModeFor('line', 1)).toBe('free');
  });

  it('takes only the targets the step can constrain', () => {
    const target = snap(
      { entityId: 'p', pointIndex: 0, point: [1, 1] },
      { entityId: 'l', type: 'line', point: [2, 2] },
      { entityId: 'm', point: [3, 3] },
    );
    expect(snapTargetPoint(target, 'free')).toEqual([1, 1]);
    expect(snapTargetPoint(target, 'tangent')).toEqual([1, 1]);
    expect(snapTargetPoint(target, 'none')).toBeNull();
    expect(snapTargetPoint(snap(null, null, { entityId: 'm', point: [3, 3] }), 'free')).toEqual([
      3, 3,
    ]);
  });
});

describe('resolveSketchPoint', () => {
  it('keeps a magnet target exactly where it is, without gridding it', () => {
    const resolution = resolveSketchPoint({
      raw: [1.24, 2.26],
      snap: snap({ entityId: 'p', pointIndex: 0, point: [1.03, 2.47] }),
      tool: 'line',
      mode: 'free',
      magnet: true,
      anchor: [0, 0],
    });
    expect(resolution.point).toEqual([1.03, 2.47]);
    expect(resolution.input.snap?.pointSnap?.entityId).toBe('p');
  });

  it('rounds a free point to the half-millimetre grid', () => {
    const resolution = resolveSketchPoint({
      raw: [1.24, 2.26],
      snap: snap(),
      tool: 'line',
      mode: 'free',
      magnet: true,
      anchor: null,
    });
    expect(resolution.point).toEqual([1, 2.5]);
    expect(resolution.input.snap).toBeNull();
  });

  it('makes a nearly vertical line exactly vertical and grids the free coordinate', () => {
    const resolution = resolveSketchPoint({
      raw: [1.3, 5.88],
      snap: snap(),
      tool: 'line',
      mode: 'free',
      magnet: true,
      anchor: [1.24, 0.44],
    });
    expect(resolution.point[0]).toBeCloseTo(1.24);
    expect(resolution.point[1]).toBeCloseTo(6);
  });

  it('makes a nearly horizontal line exactly horizontal', () => {
    const resolution = resolveSketchPoint({
      raw: [7.88, 0.5],
      snap: snap(),
      tool: 'line',
      mode: 'free',
      magnet: true,
      anchor: [1.24, 0.44],
    });
    expect(resolution.point[0]).toBeCloseTo(8);
    expect(resolution.point[1]).toBeCloseTo(0.44);
  });

  it('lets the magnet win over the axis orientation and keeps the grid fallback', () => {
    const resolution = resolveSketchPoint({
      raw: [1.3, 5.88],
      snap: snap({ entityId: 'p', pointIndex: 0, point: [1.37, 5.91] }),
      tool: 'line',
      mode: 'free',
      magnet: true,
      anchor: [1.24, 0.44],
    });
    expect(resolution.point).toEqual([1.37, 5.91]);
    expect(resolution.fallback).toEqual([1.5, 6]);
    // A coincidence cannot be made vertical when the target itself is off the
    // axis, so the step must not promise an alignment.
    expect(resolution.input.alignment).toBeUndefined();
  });

  it('keeps an alignment when the magnet target lies exactly on the axis', () => {
    const resolution = resolveSketchPoint({
      raw: [1.3, 5.88],
      snap: snap({ entityId: 'p', pointIndex: 0, point: [1.24, 5.91] }),
      tool: 'line',
      mode: 'free',
      magnet: true,
      anchor: [1.24, 0.44],
    });
    expect(resolution.point).toEqual([1.24, 5.91]);
    expect(resolution.input.alignment).toBe('vertical');
  });

  it('reports the axis the step was aligned to', () => {
    const vertical = resolveSketchPoint({
      raw: [1.3, 5.88],
      snap: snap(),
      tool: 'line',
      mode: 'free',
      magnet: true,
      anchor: [1.24, 0.44],
    });
    expect(vertical.input.alignment).toBe('vertical');
    const horizontal = resolveSketchPoint({
      raw: [7.88, 0.5],
      snap: snap(),
      tool: 'line',
      mode: 'free',
      magnet: true,
      anchor: [1.24, 0.44],
    });
    expect(horizontal.input.alignment).toBe('horizontal');
  });

  it('turns the magnet and the axis orientation off together', () => {
    const resolution = resolveSketchPoint({
      raw: [1.3, 5.88],
      snap: snap({ entityId: 'p', pointIndex: 0, point: [1.37, 5.91] }),
      tool: 'line',
      mode: 'free',
      magnet: false,
      anchor: [1.24, 0.44],
    });
    expect(resolution.point).toEqual([1.5, 6]);
    expect(resolution.input.snap).toBeNull();
  });

  it('does not orient a tool that draws no line', () => {
    const resolution = resolveSketchPoint({
      raw: [1.3, 5.88],
      snap: snap(),
      tool: 'circle',
      mode: 'free',
      magnet: true,
      anchor: [1.24, 0.44],
    });
    expect(resolution.point).toEqual([1.5, 6]);
  });
});
