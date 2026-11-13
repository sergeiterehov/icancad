import type { SketchFeature, SketchFrame } from '@icancad/model';
import type { BodyEdge, TessellationResult } from '@icancad/kernel';
import { sketchTopology } from '@icancad/sketch';
import { describe, expect, it } from 'vitest';
import {
  addProjectionToSketch,
  bodyElements,
  resolveSketchProjections,
  vertexElementId,
} from '../src/sketch/projection';

const frame: SketchFrame = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
};

function mesh(edges: BodyEdge[]): TessellationResult {
  return {
    positions: new Float32Array(),
    normals: new Float32Array(),
    indices: new Uint32Array(),
    faceIds: new Uint32Array(),
    triangleCount: 0,
    vertexCount: 0,
    bbox: { min: [0, 0, 0], max: [0, 0, 0] },
    edges,
  };
}

const lineEdge: BodyEdge = {
  id: 'e-line',
  faceIds: [1, 2],
  points: [0, 0, 5, 5, 0, 5, 10, 0, 5],
  closed: false,
};

const secondEdge: BodyEdge = {
  id: 'e-side',
  faceIds: [1],
  points: [10, 0, 5, 10, 6, 5, 10, 12, 5],
  closed: false,
};

function sketch(overrides: Partial<SketchFeature> = {}): SketchFeature {
  return {
    id: 'sketch-1',
    name: 'Sketch',
    suppressed: false,
    type: 'sketch',
    plane: { type: 'datum', plane: 'XY', offset: 0 },
    entities: [],
    constraints: [],
    references: [],
    projections: [],
    ...overrides,
  };
}

describe('sketch projections', () => {
  it('derives vertices from the endpoints of B-rep edges', () => {
    const elements = bodyElements(mesh([lineEdge, secondEdge]));
    expect([...elements.vertices.keys()]).toHaveLength(3);
    expect(elements.vertices.get(vertexElementId([0, 0, 5]))).toEqual([0, 0, 5]);
  });

  it('projects a vertex into a linked point', () => {
    const next = addProjectionToSketch(sketch(), frame, mesh([lineEdge]), {
      kind: 'vertex',
      bodyId: 'body-1',
      elementId: vertexElementId([10, 0, 5]),
      position: [10, 0, 5],
    });
    expect(next?.entities).toHaveLength(1);
    expect(next?.entities[0]).toMatchObject({ type: 'point', x: 10, y: 0 });
    expect(next?.projections?.[0]).toMatchObject({
      entityId: next?.entities[0]?.id,
      source: { kind: 'vertex', bodyId: 'body-1', elementId: vertexElementId([10, 0, 5]) },
    });
  });

  it('projects an edge into a linked curve', () => {
    const next = addProjectionToSketch(sketch(), frame, mesh([lineEdge]), {
      kind: 'edge',
      bodyId: 'body-1',
      edgeId: 'e-line',
    });
    expect(next?.entities[0]).toMatchObject({ type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 });
    expect(next?.projections?.[0]?.source.elementId).toBe('e-line');
  });

  it('projects a face into its boundary curves and corner points', () => {
    const next = addProjectionToSketch(sketch(), frame, mesh([lineEdge, secondEdge]), {
      kind: 'face',
      bodyId: 'body-1',
      faceId: '1',
    });
    expect(next?.projections).toHaveLength(5);
    expect(next?.entities.filter((entity) => entity.type === 'line')).toHaveLength(2);
    expect(next?.entities.filter((entity) => entity.type === 'point')).toHaveLength(3);
  });

  it('turns projections into ordinary geometry of the sketch object', () => {
    const square: BodyEdge[] = [
      [0, 0, 0, 10, 0, 0],
      [10, 0, 0, 10, 10, 0],
      [10, 10, 0, 0, 10, 0],
      [0, 10, 0, 0, 0, 0],
    ].map((points, index) => ({
      id: `e-${index}`,
      faceIds: [1],
      points,
      closed: false,
    }));
    const next = addProjectionToSketch(sketch(), frame, mesh(square), {
      kind: 'face',
      bodyId: 'body-1',
      faceId: '1',
    })!;
    expect(next.entities.every((entity) => !entity.construction)).toBe(true);
    const topology = sketchTopology(next.entities);
    expect(topology.faces).toHaveLength(1);
    expect(topology.edges).toHaveLength(4);
    expect(topology.points).toHaveLength(4);
  });

  it('does not add the same source twice', () => {
    const once = addProjectionToSketch(sketch(), frame, mesh([lineEdge]), {
      kind: 'edge',
      bodyId: 'body-1',
      edgeId: 'e-line',
    })!;
    const twice = addProjectionToSketch(once, frame, mesh([lineEdge]), {
      kind: 'edge',
      bodyId: 'body-1',
      edgeId: 'e-line',
    });
    expect(twice).toBeNull();
  });

  it('refreshes a linked curve from the current body geometry', () => {
    const projected = addProjectionToSketch(sketch(), frame, mesh([lineEdge]), {
      kind: 'edge',
      bodyId: 'body-1',
      edgeId: 'e-line',
    })!;
    const moved: BodyEdge = {
      ...lineEdge,
      points: [0, 0, 5, 5, 0, 5, 20, 0, 5],
    };
    const resolved = resolveSketchProjections(projected, frame, () => mesh([moved]));
    expect(resolved.lostEntityIds).toEqual([]);
    expect(resolved.entities[0]).toMatchObject({ type: 'line', x2: 20 });
  });

  it('keeps the construction flag the user set on a projected entity', () => {
    const projected = addProjectionToSketch(sketch(), frame, mesh([lineEdge]), {
      kind: 'edge',
      bodyId: 'body-1',
      edgeId: 'e-line',
    })!;
    const construction = {
      ...projected,
      entities: projected.entities.map((entity) => ({ ...entity, construction: true })),
    };
    const resolved = resolveSketchProjections(construction, frame, () => mesh([lineEdge]));
    expect(resolved.entities[0]).toMatchObject({ construction: true });
  });

  it('keeps the snapshot and reports a lost link', () => {
    const projected = addProjectionToSketch(sketch(), frame, mesh([lineEdge]), {
      kind: 'edge',
      bodyId: 'body-1',
      edgeId: 'e-line',
    })!;
    const resolved = resolveSketchProjections(projected, frame, () => undefined);
    expect(resolved.lostEntityIds).toEqual([projected.entities[0]?.id]);
    expect(resolved.entities).toEqual(projected.entities);
  });

  it('keeps the snapshot when the source edge disappears', () => {
    const projected = addProjectionToSketch(sketch(), frame, mesh([lineEdge]), {
      kind: 'edge',
      bodyId: 'body-1',
      edgeId: 'e-line',
    })!;
    const resolved = resolveSketchProjections(projected, frame, () => mesh([secondEdge]));
    expect(resolved.lostEntityIds).toEqual([projected.entities[0]?.id]);
    expect(resolved.entities).toEqual(projected.entities);
  });
});

describe('projection identity', () => {
  it('gives the same source the same entity id on a repeated operation', () => {
    const first = addProjectionToSketch(sketch(), frame, mesh([lineEdge]), {
      kind: 'edge',
      bodyId: 'body-1',
      edgeId: 'e-line',
    })!;
    const second = addProjectionToSketch(sketch(), frame, mesh([lineEdge]), {
      kind: 'edge',
      bodyId: 'body-1',
      edgeId: 'e-line',
    })!;
    expect(second.entities[0]?.id).toBe(first.entities[0]?.id);
  });

  it('re-attaches a detached entity instead of adding a copy', () => {
    const projected = addProjectionToSketch(sketch(), frame, mesh([lineEdge]), {
      kind: 'edge',
      bodyId: 'body-1',
      edgeId: 'e-line',
    })!;
    const detached: SketchFeature = { ...projected, projections: [] };
    const again = addProjectionToSketch(detached, frame, mesh([lineEdge]), {
      kind: 'edge',
      bodyId: 'body-1',
      edgeId: 'e-line',
    })!;
    expect(again.entities).toHaveLength(1);
    expect(again.entities[0]?.id).toBe(projected.entities[0]?.id);
    expect(again.projections?.[0]?.entityId).toBe(projected.entities[0]?.id);
  });
});
