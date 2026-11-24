import { describe, expect, it } from 'vitest';
import type { SketchEntity } from '@icancad/model';
import {
  collectCurveChains,
  loopIsSimple,
  outlineChain,
  offsetChain,
  signedDistanceToChain,
  tessellateEntity,
  type CurveChain,
  type OffsetLoop,
  type SketchEntityDraft,
} from '../src/index';

function line(id: string, x1: number, y1: number, x2: number, y2: number): SketchEntity {
  return { id, type: 'line', construction: false, x1, y1, x2, y2 };
}

function rectangle(prefix = 'l'): SketchEntity[] {
  return [
    line(`${prefix}1`, 0, 0, 20, 0),
    line(`${prefix}2`, 20, 0, 20, 10),
    line(`${prefix}3`, 20, 10, 0, 10),
    line(`${prefix}4`, 0, 10, 0, 0),
  ];
}

/** The same rectangle drawn clockwise, the way a sketch can be drawn. */
function clockwiseRectangle(): SketchEntity[] {
  return [
    line('c1', 0, 0, 0, 10),
    line('c2', 0, 10, 20, 10),
    line('c3', 20, 10, 20, 0),
    line('c4', 20, 0, 0, 0),
  ];
}

function chainOf(entities: SketchEntity[]): CurveChain {
  const { chains, error } = collectCurveChains(entities);
  expect(error).toBeUndefined();
  expect(chains).toHaveLength(1);
  return chains[0]!;
}

function loop(entities: SketchEntity[], distance: number, join: 'round' | 'miter' = 'round') {
  const result = offsetChain(chainOf(entities), { distance, join });
  expect(result.ok).toBe(true);
  return result.ok ? result.loops[0]! : null;
}

function arcs(loop: OffsetLoop) {
  return loop.pieces
    .map((piece) => piece.curve)
    .filter((curve): curve is Extract<SketchEntityDraft, { type: 'arc' }> => curve.type === 'arc');
}

function lines(loop: OffsetLoop) {
  return loop.pieces
    .map((piece) => piece.curve)
    .filter((curve): curve is Extract<SketchEntityDraft, { type: 'line' }> => curve.type === 'line');
}

describe('offset chains', () => {
  it('orders a rectangle into one closed chain and an angle into one open chain', () => {
    const closed = chainOf(rectangle());
    expect(closed.closed).toBe(true);
    expect(closed.curves).toHaveLength(4);

    const open = chainOf([line('a', 0, 0, 10, 0), line('b', 10, 0, 10, 5)]);
    expect(open.closed).toBe(false);
    expect(open.curves.map((curve) => curve.entity.id)).toEqual(['a', 'b']);
    expect(open.curves[1]!.reversed).toBe(false);
  });

  it('refuses a selection that forks', () => {
    const entities = [
      line('a', 0, 0, 10, 0),
      line('b', 10, 0, 20, 0),
      line('c', 10, 0, 10, 10),
    ];
    expect(collectCurveChains(entities).error).toBe('branching');
  });

  it('offsets a line to the chosen side', () => {
    const entities = [line('a', 0, 0, 10, 0)];
    const left = loop(entities, 2)!;
    const [offset] = lines(left);
    expect(offset?.y1).toBeCloseTo(2, 9);
    expect(offset?.y2).toBeCloseTo(2, 9);
    expect(left.pieces[0]!.sourceId).toBe('a');

    const right = loop(entities, -2)!;
    expect(lines(right)[0]?.y1).toBeCloseTo(-2, 9);
  });

  it('rounds an outside corner with an arc of the offset radius', () => {
    const corner = [line('a', 0, 0, 10, 0), line('b', 10, 0, 10, 10)];
    const result = loop(corner, -2)!;
    expect(lines(result)).toHaveLength(2);
    const [arc] = arcs(result);
    expect(arc).toBeDefined();
    expect(arc?.cx).toBeCloseTo(10, 9);
    expect(arc?.cy).toBeCloseTo(0, 9);
    expect(arc?.r).toBeCloseTo(2, 9);
    expect(arc?.startAngle).toBeCloseTo(-Math.PI / 2, 9);
    expect(arc?.endAngle).toBeCloseTo(0, 9);
  });

  it('meets an inside corner at the crossing of the offset curves', () => {
    const corner = [line('a', 0, 0, 10, 0), line('b', 10, 0, 10, 10)];
    const result = loop(corner, 2)!;
    expect(arcs(result)).toHaveLength(0);
    const [first, second] = lines(result);
    expect(Math.hypot(first!.x2 - 8, first!.y2 - 2)).toBeLessThan(1e-9);
    expect(Math.hypot(second!.x1 - 8, second!.y1 - 2)).toBeLessThan(1e-9);
  });

  it('offsets a chain the same way whichever way its curves were drawn', () => {
    const forward = [line('a', 0, 0, 10, 0), line('b', 10, 0, 10, 10)];
    const backward = [line('a', 0, 0, 10, 0), line('b', 10, 10, 10, 0)];
    for (const distance of [2, -2]) {
      const expected = loop(forward, distance)!;
      const actual = loop(backward, distance)!;
      expect(actual.pieces.map((piece) => piece.curve.type)).toEqual(
        expected.pieces.map((piece) => piece.curve.type),
      );
      expect(lines(actual)).toEqual(lines(expected));
    }
  });

  it('meets an outside corner at the miter point on request', () => {
    const corner = [line('a', 0, 0, 10, 0), line('b', 10, 0, 10, 10)];
    const result = loop(corner, -2, 'miter')!;
    expect(arcs(result)).toHaveLength(0);
    const [first, second] = lines(result);
    expect(Math.hypot(first!.x2 - 12, first!.y2 + 2)).toBeLessThan(1e-9);
    expect(Math.hypot(second!.x1 - 12, second!.y1 + 2)).toBeLessThan(1e-9);
  });

  it('keeps inward corners sharp and rounds outward ones', () => {
    const inward = loop(rectangle(), 2)!;
    expect(lines(inward)).toHaveLength(4);
    expect(arcs(inward)).toHaveLength(0);

    const outward = loop(rectangle(), -2)!;
    expect(lines(outward)).toHaveLength(4);
    expect(arcs(outward)).toHaveLength(4);
    for (const arc of arcs(outward)) expect(arc.r).toBeCloseTo(2, 9);
  });

  it('offsets a circle by changing its radius', () => {
    const circle: SketchEntity = { id: 'c', type: 'circle', construction: false, cx: 0, cy: 0, r: 10 };
    const inside = loop([circle], 1)!;
    expect(inside.pieces[0]!.curve.type).toBe('circle');
    if (inside.pieces[0]!.curve.type === 'circle') {
      expect(inside.pieces[0]!.curve.r).toBeCloseTo(9, 9);
    }
    const outside = loop([circle], -1)!;
    if (outside.pieces[0]!.curve.type === 'circle') {
      expect(outside.pieces[0]!.curve.r).toBeCloseTo(11, 9);
    }
  });

  it('refuses an offset that would erase the geometry', () => {
    const circle: SketchEntity = { id: 'c', type: 'circle', construction: false, cx: 0, cy: 0, r: 2 };
    expect(offsetChain(chainOf([circle]), { distance: 3, join: 'round' })).toEqual({
      ok: false,
      reason: 'distance',
    });
  });

  it('continues an arc offset past its centre on the other side', () => {
    const arc: SketchEntity = {
      id: 'arc',
      type: 'arc',
      construction: false,
      cx: 0,
      cy: 0,
      r: 5,
      startAngle: 0,
      endAngle: Math.PI / 2,
    };
    const result = offsetChain(chainOf([arc]), { distance: 7, join: 'round' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const piece = result.loops[0]!.pieces[0]!.curve;
    expect(piece.type).toBe('arc');
    if (piece.type !== 'arc') return;
    expect(piece.r).toBeCloseTo(2, 9);
    expect(piece.startAngle).toBeCloseTo(Math.PI, 9);
    expect(piece.endAngle).toBeCloseTo((Math.PI * 3) / 2, 9);
  });

  it('fits the offset of an ellipse into sketch curves', () => {
    const ellipse: SketchEntity = {
      id: 'e',
      type: 'ellipse',
      construction: false,
      cx: 0,
      cy: 0,
      rx: 10,
      ry: 5,
      rotation: 0,
    };
    const result = loop([ellipse], -2)!;
    expect(result.pieces.length).toBeGreaterThan(0);
    const samples = result.pieces.flatMap((piece) => tessellateEntity(piece.curve as SketchEntity, 16));
    expect(samples.length).toBeGreaterThan(8);
    // The offset of an ellipse reaches two millimetres past each axis.
    const maxX = Math.max(...samples.map((point) => Math.abs(point[0])));
    const maxY = Math.max(...samples.map((point) => Math.abs(point[1])));
    expect(maxX).toBeGreaterThan(11.5);
    expect(maxX).toBeLessThan(12.5);
    expect(maxY).toBeGreaterThan(6.5);
    expect(maxY).toBeLessThan(7.5);
  });

  it('measures the pointer side of the chain', () => {
    const chain = chainOf([line('a', 0, 0, 10, 0)]);
    expect(signedDistanceToChain(chain, [5, 3])).toBeCloseTo(3, 9);
    expect(signedDistanceToChain(chain, [5, -4])).toBeCloseTo(-4, 9);
  });

  it('offsets a chain past an arc narrower than the distance', () => {
    // The arc is 2 wide and the distance is 5: its offset would sit on the far
    // side of its own centre, so the offset of the chain follows the lines.
    const chain = [
      line('a', 0, 0, 10, 0),
      {
        id: 'arc',
        type: 'arc' as const,
        construction: false,
        cx: 10,
        cy: 2,
        r: 2,
        startAngle: -Math.PI / 2,
        endAngle: 0,
      },
      line('b', 12, 2, 12, 12),
    ];
    const result = offsetChain(chainOf(chain), { distance: 5, join: 'round' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loop = result.loops[0]!;
    for (const arc of arcs(loop)) expect(Math.abs(arc.r - 3)).toBeGreaterThan(0.5);
    expect(loopIsSimple(loop, false)).toBe(true);
  });
});

describe('contours', () => {
  it('wraps an open chain into one loop with round caps', () => {
    const result = outlineChain(chainOf([line('a', 0, 0, 10, 0)]), {
      distance: 1,
      join: 'round',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.loops).toHaveLength(1);
    const pieces = result.loops[0]!.pieces;
    expect(pieces.map((piece) => piece.role)).toEqual(['offset', 'cap', 'offset', 'cap']);
    const caps = arcs(result.loops[0]!);
    expect(caps).toHaveLength(2);
    // A cap is a half turn, so both directions are the same length: it has to
    // wrap around the tip rather than curl back into the stroke.
    const tips = caps.map((cap) => {
      const middle = (cap.startAngle + cap.endAngle) / 2;
      return [cap.cx + Math.cos(middle) * cap.r, cap.cy + Math.sin(middle) * cap.r] as const;
    });
    const xs = tips.map((point) => point[0]).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-1, 6);
    expect(xs[1]).toBeCloseTo(11, 6);
  });

  it('wraps the ends of a bent chain outside the bend', () => {
    const chain = [line('a', 0, 0, 10, 0), line('b', 10, 0, 20, 10)];
    const result = outlineChain(chainOf(chain), { distance: 1, join: 'round' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const caps = result.loops[0]!.pieces
      .filter((piece) => piece.role === 'cap')
      .map((piece) => piece.curve)
      .filter((curve): curve is Extract<SketchEntityDraft, { type: 'arc' }> => curve.type === 'arc');
    expect(caps).toHaveLength(2);
    const tips = caps.map((cap) => {
      const middle = (cap.startAngle + cap.endAngle) / 2;
      return [cap.cx + Math.cos(middle) * cap.r, cap.cy + Math.sin(middle) * cap.r] as const;
    });
    const atStart = tips.find((point) => point[0] < 0);
    const atEnd = tips.find((point) => point[0] > 20);
    expect(atStart?.[0]).toBeCloseTo(-1, 6);
    expect(atStart?.[1]).toBeCloseTo(0, 6);
    expect(atEnd?.[0]).toBeCloseTo(20 + Math.SQRT1_2, 6);
    expect(atEnd?.[1]).toBeCloseTo(10 + Math.SQRT1_2, 6);
  });

  it('wraps a closed chain into a ring of two loops', () => {
    const result = outlineChain(chainOf(rectangle()), { distance: 1, join: 'round' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.loops).toHaveLength(2);
    const [outer, inner] = result.loops;
    expect(arcs(outer!)).toHaveLength(4);
    expect(lines(outer!)).toHaveLength(4);
    expect(arcs(inner!)).toHaveLength(0);
    expect(lines(inner!)).toHaveLength(4);
  });

  it('uses square caps when the corners are sharp', () => {
    const result = outlineChain(chainOf([line('a', 0, 0, 10, 0)]), {
      distance: 1,
      join: 'miter',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(arcs(result.loops[0]!)).toHaveLength(0);
    expect(result.loops[0]!.pieces.map((piece) => piece.role)).toEqual([
      'offset',
      'cap',
      'offset',
      'cap',
    ]);
  });

  it('wraps a chain of tangent curves without adding join arcs', () => {
    const chain = [
      line('a', 0, 0, 10, 0),
      {
        id: 'arc',
        type: 'arc' as const,
        construction: false,
        cx: 10,
        cy: 5,
        r: 5,
        startAngle: -Math.PI / 2,
        endAngle: 0,
      },
      line('b', 15, 5, 15, 15),
    ];
    const result = outlineChain(chainOf(chain), { distance: 1, join: 'round' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pieces = result.loops[0]!.pieces;
    expect(pieces.filter((piece) => piece.role === 'join')).toHaveLength(0);
    expect(pieces.filter((piece) => piece.role === 'offset')).toHaveLength(6);
    expect(pieces.filter((piece) => piece.role === 'cap')).toHaveLength(2);
  });

  it('wraps a tangent chain whose arc was drawn the other way round', () => {
    const chain = [
      line('a', 0, 0, 10, 0),
      {
        id: 'arc',
        type: 'arc' as const,
        construction: false,
        cx: 10,
        cy: 5,
        r: 5,
        // The same arc, drawn from its far end towards the line.
        startAngle: 0,
        endAngle: -Math.PI / 2,
      },
      line('b', 15, 5, 15, 15),
    ];
    const result = outlineChain(chainOf(chain), { distance: 1, join: 'round' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pieces = result.loops[0]!.pieces;
    expect(pieces.filter((piece) => piece.role === 'join')).toHaveLength(0);
    expect(pieces.filter((piece) => piece.role === 'offset')).toHaveLength(6);
  });

  it('keeps the outside of a ring narrower than the stroke', () => {
    // A ring 20 × 10 is narrower than twice this distance, so the inside loop
    // has no room: the outside of the stroke is still a valid outline.
    const result = outlineChain(chainOf(rectangle()), { distance: 6, join: 'round' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.loops.length).toBeGreaterThanOrEqual(1);
    const outer = result.loops[0]!;
    expect(lines(outer).length).toBeGreaterThanOrEqual(4);
  });

  it('rounds the corners of a clockwise chain the same way', () => {
    const result = outlineChain(chainOf(clockwiseRectangle()), { distance: 1, join: 'round' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.loops).toHaveLength(2);
    const [outer, inner] = result.loops;
    expect(arcs(outer!)).toHaveLength(4);
    expect(lines(outer!)).toHaveLength(4);
    expect(arcs(inner!)).toHaveLength(0);
    expect(lines(inner!)).toHaveLength(4);
    // A join is the short way round; a long arc would wrap through the shape.
    for (const arc of arcs(outer!)) {
      expect(Math.abs(arc.endAngle - arc.startAngle)).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });

  it('keeps the outside of a contour that leaves no room for the inside', () => {
    const result = outlineChain(chainOf(clockwiseRectangle()), { distance: 6, join: 'round' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.loops).toHaveLength(1);
    expect(lines(result.loops[0]!).length).toBeGreaterThanOrEqual(4);
  });

  it('rounds the outward corners at every distance', () => {
    // A corner that fits is always rounded: the width must never turn the
    // corners sharp on its own, which is what only Shift asks for.
    const bent = () => [
      line('a', 0, 0, 20, 0),
      line('b', 20, 0, 30, 10),
      line('c', 30, 10, 30, 30),
    ];
    for (const distance of [1, 2, 4, 6, 8, 10, 12, 14]) {
      const result = outlineChain(chainOf(bent()), { distance, join: 'round' });
      expect(result.ok, `distance ${distance}`).toBe(true);
      if (!result.ok) continue;
      const joins = arcs(result.loops[0]!).filter((arc) =>
        result.loops[0]!.pieces.some(
          (piece) => piece.role === 'join' && piece.curve === arc,
        ),
      );
      expect(joins.length, `distance ${distance}`).toBe(2);
      for (const arc of joins) expect(arc.r).toBeCloseTo(distance, 6);
    }
    // Sharp corners are still available where they are asked for.
    const sharp = outlineChain(chainOf(bent()), { distance: 8, join: 'miter' });
    expect(sharp.ok).toBe(true);
    if (sharp.ok) expect(arcs(sharp.loops[0]!)).toHaveLength(0);
  });

  it('swallows an arc narrower than the stroke', () => {
    // The stroke is wider than the arc radius, so the arc has no boundary of
    // its own: the two lines meet across it instead of folding the loop.
    const chain = [
      line('a', 0, 0, 10, 0),
      {
        id: 'arc',
        type: 'arc' as const,
        construction: false,
        cx: 10,
        cy: 2,
        r: 2,
        startAngle: -Math.PI / 2,
        endAngle: 0,
      },
      line('b', 12, 2, 12, 12),
    ];
    const result = outlineChain(chainOf(chain), { distance: 5, join: 'round' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loop = result.loops[0]!;
    const radii = arcs(loop).map((arc) => arc.r);
    // The outside of the arc is at r + d, the caps are d wide, and nothing sits
    // on the far side of the arc's centre at |r − d| = 3.
    expect(radii.some((radius) => Math.abs(radius - 7) < 1e-6)).toBe(true);
    for (const radius of radii) expect(radius).toBeGreaterThan(2.5);
    expect(loopIsSimple(loop)).toBe(true);
  });

  it('keeps a joint that is all but tangent free of a zero-sweep arc', () => {
    // The arc of this chain meets its lines within a thousandth of a radian,
    // which used to leave a corner arc with no length. That arc could not be
    // solved, and the whole contour fell back to sharp corners.
    const chain: SketchEntity[] = [
      line('a', 11.516910393054463, 13.490584289736725, 20.861496908757797, 35.44943377046296),
      line('b', 32.9464195797937, 39.63922291300685, 65.94641957979371, 21.568155101141365),
      {
        id: 'arc',
        type: 'arc',
        construction: false,
        cx: 28.801715349339897,
        cy: 32.07048536711116,
        r: 8.629273503406258,
        startAngle: -3.543927831711292,
        endAngle: -5.213394173084436,
      },
    ];
    for (const distance of [2, 6, 10]) {
      const result = outlineChain(chainOf(chain), { distance, join: 'round' });
      expect(result.ok, `distance ${distance}`).toBe(true);
      if (!result.ok) continue;
      for (const arc of arcs(result.loops[0]!)) {
        expect(Math.abs(arc.endAngle - arc.startAngle) * arc.r).toBeGreaterThan(1e-6);
      }
    }
  });
});

describe('a stroke wider than the shape', () => {
  it('leaves one clean loop of a closed chain', () => {
    // The ring of this chain is narrower than the stroke at these widths: the
    // hole is filled, so no inside loop is left — and nothing else may be left
    // inside either. A curve the stroke swallowed is joined straight across; a
    // corner arc invented there would sweep through the shape.
    const chain = chainOf([
      line('a', 24.48215569826761, 11.345068199254744, 10.622883962010368, 59.41893686253899),
      line('b', 19.749375406580594, 70.41228839720446, 78.0122340585783, 64.82323234659022),
      line('c', 78.0122340585783, 64.82323234659022, 24.48215569826761, 11.345068199254744),
      {
        id: 'arc',
        type: 'arc',
        construction: false,
        cx: 18.924381640200888,
        cy: 61.81218012472198,
        r: 8.63958778026978,
        startAngle: -2.860912797326554,
        endAngle: -4.808024642738269,
      },
    ]);
    for (const distance of [12, 20, 31.75, 40]) {
      const result = outlineChain(chain, { distance, join: 'round' });
      expect(result.ok, `distance ${distance}`).toBe(true);
      if (!result.ok) continue;
      expect(result.loops.length, `distance ${distance}`).toBe(1);
      const loop = result.loops[0]!;
      expect(loopIsSimple(loop), `distance ${distance}`).toBe(true);
      // The joins that remain are the two real corners of the chain.
      const joinArcs = loop.pieces.filter(
        (piece) => piece.role === 'join' && piece.curve.type === 'arc',
      );
      expect(joinArcs.length, `distance ${distance}`).toBeLessThanOrEqual(2);
    }
  });
});
