import { describe, expect, it } from 'vitest';
import type { SketchEntity } from '@icancad/model';
import { sketchTopology, translateEntity } from '../src/index';

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

describe('sketch topology', () => {
  it('turns a closed rectangle into one face with four edges', () => {
    const topology = sketchTopology(rectangle());
    expect(topology.edges).toHaveLength(4);
    expect(topology.faces).toHaveLength(1);
    expect(topology.faces[0]!.area).toBeCloseTo(200, 6);
    expect(new Set(topology.faces[0]!.boundary)).toEqual(new Set(['l1', 'l2', 'l3', 'l4']));
    expect(topology.faces[0]!.holes).toEqual([]);
    expect(topology.points).toHaveLength(4);
  });

  it('keeps open chains as edges without faces', () => {
    const topology = sketchTopology([line('a', 0, 0, 10, 0), line('b', 10, 0, 20, 5)]);
    expect(topology.edges).toHaveLength(2);
    expect(topology.faces).toHaveLength(0);
    expect(topology.points).toHaveLength(3);
  });

  it('finds a dangling edge attached to a closed profile', () => {
    const entities = [...rectangle(), line('tail', 20, 0, 30, 0)];
    const topology = sketchTopology(entities);
    expect(topology.edges).toHaveLength(5);
    expect(topology.faces).toHaveLength(1);
  });

  it('gives a circle its own face and the rectangle a hole', () => {
    const circle: SketchEntity = {
      id: 'c1',
      type: 'circle',
      construction: false,
      cx: 10,
      cy: 5,
      r: 3,
    };
    const topology = sketchTopology([...rectangle(), circle]);
    expect(topology.faces).toHaveLength(2);
    const disk = topology.faces.find((face) => face.holes.length === 0 && face.boundary.length === 1);
    const ring = topology.faces.find((face) => face.holes.length === 1);
    expect(disk?.area).toBeCloseTo(Math.PI * 9, 0);
    expect(ring?.area).toBeCloseTo(200, 0);
    expect(ring?.holes[0]).toEqual(['c1']);
  });

  it('ignores construction geometry and isolated points only produce points', () => {
    const construction: SketchEntity = { ...line('c', 0, 5, 20, 5), construction: true };
    const point: SketchEntity = { id: 'p1', type: 'point', construction: false, x: 40, y: 40 };
    const topology = sketchTopology([...rectangle(), construction, point]);
    expect(topology.edges).toHaveLength(4);
    expect(topology.faces).toHaveLength(1);
    expect(topology.points.some((candidate) => candidate.kind === 'isolated')).toBe(true);
  });

  it('keeps face ids stable when unrelated geometry is added', () => {
    const before = sketchTopology(rectangle());
    const after = sketchTopology([...rectangle(), line('extra', 100, 0, 120, 0)]);
    expect(after.faces[0]!.id).toBe(before.faces[0]!.id);
  });
});

describe('sketch topology identifiers', () => {
  it('derives element ids from the sketch entities, not from traversal order', () => {
    const entities = rectangle();
    const forward = sketchTopology(entities);
    const backward = sketchTopology([...entities].reverse());
    const ids = (topology: ReturnType<typeof sketchTopology>) => ({
      points: topology.points.map((point) => point.id).sort(),
      edges: topology.edges.map((edge) => edge.id).sort(),
      faces: topology.faces.map((face) => face.id).sort(),
    });
    expect(ids(backward)).toEqual(ids(forward));
    expect(forward.points.map((point) => point.id)).toContain('pt_l1_0');
  });

  it('keeps ids of untouched elements when unrelated geometry appears', () => {
    const before = sketchTopology(rectangle());
    const after = sketchTopology([...rectangle(), line('extra', 100, 0, 120, 0)]);
    const beforeIds = new Set(before.points.map((point) => point.id));
    for (const point of before.points) expect(after.points.map((p) => p.id)).toContain(point.id);
    expect(beforeIds.size).toBe(4);
    expect(after.edges.map((edge) => edge.id)).toEqual(expect.arrayContaining(['l1', 'l2', 'l3', 'l4']));
  });

  it('changes the face id only when its contour changes', () => {
    const before = sketchTopology(rectangle());

    const replaced = [...rectangle().filter((edge) => edge.id !== 'l3'), line('l3b', 20, 10, 0, 10)];
    const rebuilt = sketchTopology(replaced);
    expect(rebuilt.faces).toHaveLength(1);
    expect(rebuilt.faces[0]!.id).not.toBe(before.faces[0]!.id);

    const translated = sketchTopology(rectangle().map((edge) => translateEntity(edge, 5, 5)));
    expect(translated.faces[0]!.id).toBe(before.faces[0]!.id);
  });

  it('marks a circle as a closed edge sharing its start and end point', () => {
    const circle: SketchEntity = {
      id: 'c1',
      type: 'circle',
      construction: false,
      cx: 0,
      cy: 0,
      r: 5,
    };
    const topology = sketchTopology([circle]);
    expect(topology.edges[0]!.closed).toBe(true);
    expect(topology.edges[0]!.start).toBe(topology.edges[0]!.end);
    expect(topology.points.map((point) => point.id)).toContain('pt_c1_0');
  });
});
