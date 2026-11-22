import type { SketchEntity } from '@icancad/model';
import { describe, expect, it, vi } from 'vitest';
import { dragPinSets, moveDraggedEntities } from '../src/sketch/dragSelection';
import { solveDrag } from '../src/sketch/dragSolve';
import { solveSketch } from './planegcsSolve';

vi.mock('../src/sketch/client', () => import('./planegcsSolve'));

const ellipse: SketchEntity = {
  id: 'ellipse',
  type: 'ellipse',
  construction: false,
  cx: 30,
  cy: 5,
  rx: 8,
  ry: 4,
  rotation: 27,
};

const arc: SketchEntity = {
  id: 'arc',
  type: 'elliptical-arc',
  construction: false,
  cx: -20,
  cy: 5,
  rx: 9,
  ry: 5,
  rotation: 15,
  startAngle: 0.4,
  endAngle: 2.6,
};

const line: SketchEntity = {
  id: 'line',
  type: 'line',
  construction: false,
  x1: 0,
  y1: 20,
  x2: 10,
  y2: 25,
};

const expected = (entity: SketchEntity) => {
  const { id: _id, ...rest } = entity as Record<string, unknown> & { id: string };
  return rest;
};

describe('ellipse in the solver', () => {
  it('holds a rotated ellipse and an elliptical arc through a free solve', async () => {
    // Adding geometry re-solves the whole sketch. A rotated ellipse used to be
    // rebuilt from a focus placed with degrees read as radians, so the solve
    // moved and turned it every time.
    const result = await solveSketch([ellipse, arc, line], [], []);
    expect(expected(result.entities[0]!)).toMatchObject({
      cx: expect.closeTo(30, 6),
      cy: expect.closeTo(5, 6),
      rx: expect.closeTo(8, 6),
      ry: expect.closeTo(4, 6),
      rotation: expect.closeTo(27, 6),
    });
    expect(expected(result.entities[1]!)).toMatchObject({
      cx: expect.closeTo(-20, 6),
      cy: expect.closeTo(5, 6),
      rx: expect.closeTo(9, 6),
      ry: expect.closeTo(5, 6),
      rotation: expect.closeTo(15, 6),
      startAngle: expect.closeTo(0.4, 6),
      endAngle: expect.closeTo(2.6, 6),
    });
  });

  it('keeps the authored frame when the shorter axis comes first', async () => {
    const tall: SketchEntity = { ...ellipse, rx: 4, ry: 8, rotation: 10 };
    const result = await solveSketch([tall], [], []);
    expect(result.entities[0]).toMatchObject({
      rx: expect.closeTo(4, 6),
      ry: expect.closeTo(8, 6),
      rotation: expect.closeTo(10, 6),
    });
  });

  it('drops a dragged group without reshaping its curves', async () => {
    const grabbed = {
      id: ellipse.id,
      mode: 'entity' as const,
      pointIndex: null,
      original: ellipse,
    };
    const movedIds = [ellipse.id, arc.id];
    const start: [number, number] = [38, 5];
    const target: [number, number] = [43, 8];
    const moved = moveDraggedEntities({
      entities: [ellipse, arc, line],
      grabbed,
      movedIds,
      target,
      reference: start,
    });
    const outcome = await solveDrag({
      entities: moved,
      constraints: [],
      pinSets: dragPinSets({
        grabbed,
        movedIds,
        startPoint: start,
        entities: [ellipse, arc, line],
      }),
      movedEntityIds: movedIds,
      maxMove: 100,
      allowAxisSwitch: false,
    });
    expect(outcome).not.toBeNull();
    const dropped = outcome!.result.entities;
    expect(dropped[0]).toMatchObject({
      cx: expect.closeTo(35, 6),
      cy: expect.closeTo(8, 6),
      rx: expect.closeTo(8, 6),
      ry: expect.closeTo(4, 6),
      rotation: expect.closeTo(27, 6),
    });
    expect(dropped[1]).toMatchObject({
      cx: expect.closeTo(-15, 6),
      cy: expect.closeTo(8, 6),
      rx: expect.closeTo(9, 6),
      ry: expect.closeTo(5, 6),
      rotation: expect.closeTo(15, 6),
      startAngle: expect.closeTo(0.4, 6),
      endAngle: expect.closeTo(2.6, 6),
    });
  });
});
