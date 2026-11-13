import type { SketchEntity, SketchFeature, SketchFrame, Vec3 } from '@icancad/model';
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

function vertexIdAt(result: TessellationResult, point: Vec3): string {
  const elements = bodyElements(result);
  return elements.vertexIds.get(vertexElementId(point)) ?? vertexElementId(point);
}

describe('sketch projections', () => {
  it('names vertices after the edges that meet there', () => {
    const elements = bodyElements(mesh([lineEdge, secondEdge]));
    expect([...elements.vertices.keys()].sort()).toEqual([
      'v:e-line',
      'v:e-line+e-side',
      'v:e-side',
    ]);
    expect(elements.vertices.get('v:e-line+e-side')).toEqual([10, 0, 5]);
  });

  it('projects a vertex into a linked point', () => {
    const result = mesh([lineEdge]);
    const elementId = vertexIdAt(result, [10, 0, 5]);
    const next = addProjectionToSketch(sketch(), frame, result, {
      kind: 'vertex',
      bodyId: 'body-1',
      elementId,
      position: [10, 0, 5],
    });
    expect(next?.entities).toHaveLength(1);
    expect(next?.entities[0]).toMatchObject({ type: 'point', x: 10, y: 0 });
    expect(next?.projections?.[0]).toMatchObject({
      entityId: next?.entities[0]?.id,
      source: { kind: 'vertex', bodyId: 'body-1', elementId },
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

  it('projects the contour of a curved face as well as its boundary', () => {
    const radius = 5;
    const height = 10;
    const segments = 16;
    const rows = 4;
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const faceIds: number[] = [];
    const at = (segment: number, row: number): number => {
      const angle = (segment / segments) * Math.PI * 2;
      positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, (row / rows) * height);
      normals.push(Math.cos(angle), Math.sin(angle), 0);
      return positions.length / 3 - 1;
    };
    for (let row = 0; row < rows; row += 1) {
      for (let segment = 0; segment < segments; segment += 1) {
        const a = at(segment, row);
        const b = at(segment + 1, row);
        const c = at(segment + 1, row + 1);
        const d = at(segment, row + 1);
        indices.push(a, b, c, a, c, d);
        faceIds.push(0, 0);
      }
    }
    const ring = (z: number) => {
      const points: number[] = [];
      for (let segment = 0; segment <= segments; segment += 1) {
        const angle = (segment / segments) * Math.PI * 2;
        points.push(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
      }
      return points;
    };
    const tube: TessellationResult = {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint32Array(indices),
      faceIds: new Uint32Array(faceIds),
      triangleCount: faceIds.length,
      vertexCount: positions.length / 3,
      bbox: { min: [-radius, -radius, 0], max: [radius, radius, height] },
      edges: [
        { id: 'bottom', faceIds: [0], points: ring(0), closed: true },
        { id: 'top', faceIds: [0], points: ring(height), closed: true },
      ],
    };
    const yz: SketchFrame = {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 0, 1],
      normal: [0, 1, 0],
    };
    const next = addProjectionToSketch(sketch(), yz, tube, {
      kind: 'face',
      bodyId: 'body-1',
      faceId: '0',
    })!;
    const contours = (next.projections ?? []).filter(
      (projection) => projection.source.kind === 'silhouette',
    );
    // The tube shows two sides, each a vertical line at the extreme x.
    expect(contours).toHaveLength(2);
    const contourEntities = contours
      .map((projection) => next.entities.find((entity) => entity.id === projection.entityId))
      .filter((entity): entity is Extract<SketchEntity, { type: 'line' }> => entity?.type === 'line');
    expect(contourEntities).toHaveLength(2);
    for (const entity of contourEntities) {
      expect(Math.abs(entity.x1)).toBeCloseTo(5, 1);
      expect(Math.abs(entity.x2)).toBeCloseTo(5, 1);
      expect(Math.abs(entity.y2 - entity.y1)).toBeCloseTo(10, 1);
    }
    expect(new Set(contourEntities.map((entity) => Math.sign(entity.x1))).size).toBe(2);
    // The contour and the boundary it runs into meet, so the face is a closed
    // region and can be extruded.
    expect(sketchTopology(next.entities).faces).toHaveLength(1);
  });

  it('closes both faces when neighbouring faces share a boundary', () => {
    const radius = 5;
    const height = 10;
    const segments = 16;
    const rows = 4;
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const faceIds: number[] = [];
    const grid: number[][] = [];
    for (let row = 0; row <= rows; row += 1) {
      grid[row] = [];
      for (let segment = 0; segment < segments; segment += 1) {
        const angle = (segment / segments) * Math.PI * 2;
        positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, (row / rows) * height);
        normals.push(Math.cos(angle), Math.sin(angle), 0);
        grid[row]![segment] = positions.length / 3 - 1;
      }
    }
    for (let row = 0; row < rows; row += 1) {
      const faceId = row < rows / 2 ? 0 : 1;
      for (let segment = 0; segment < segments; segment += 1) {
        const next = (segment + 1) % segments;
        const a = grid[row]![segment]!;
        const b = grid[row]![next]!;
        const c = grid[row + 1]![next]!;
        const d = grid[row + 1]![segment]!;
        indices.push(a, b, c, a, c, d);
        faceIds.push(faceId, faceId);
      }
    }
    const ring = (row: number) => {
      const points: number[] = [];
      for (let segment = 0; segment <= segments; segment += 1) {
        const angle = (segment / segments) * Math.PI * 2;
        points.push(
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
          (row / rows) * height,
        );
      }
      return points;
    };
    const twoBands: TessellationResult = {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint32Array(indices),
      faceIds: new Uint32Array(faceIds),
      triangleCount: faceIds.length,
      vertexCount: positions.length / 3,
      bbox: { min: [-radius, -radius, 0], max: [radius, radius, height] },
      edges: [
        { id: 'bottom', faceIds: [0], points: ring(0), closed: true },
        { id: 'middle', faceIds: [0, 1], points: ring(rows / 2), closed: true },
        { id: 'top', faceIds: [1], points: ring(rows), closed: true },
      ],
    };
    const yz: SketchFrame = {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 0, 1],
      normal: [0, 1, 0],
    };
    const lower = addProjectionToSketch(sketch(), yz, twoBands, {
      kind: 'face',
      bodyId: 'body-1',
      faceId: '0',
    })!;
    // The shared ring belongs to both faces; joining it to one contour only
    // would leave the other face open.
    const both = addProjectionToSketch(lower, yz, twoBands, {
      kind: 'face',
      bodyId: 'body-1',
      faceId: '1',
    })!;
    expect(sketchTopology(both.entities).faces.length).toBeGreaterThanOrEqual(2);
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

  it('keeps a projected face attached when the body is resized', () => {
    const square = (size: number): BodyEdge[] =>
      [
        [0, 0, 0, size, 0, 0],
        [size, 0, 0, size, size, 0],
        [size, size, 0, 0, size, 0],
        [0, size, 0, 0, 0, 0],
      ].map((points, index) => ({
        id: `e-${index}`,
        faceIds: [1],
        points,
        closed: false,
      }));
    const projected = addProjectionToSketch(sketch(), frame, mesh(square(20)), {
      kind: 'face',
      bodyId: 'body-1',
      faceId: '1',
    })!;

    const resolved = resolveSketchProjections(projected, frame, () => mesh(square(40)));

    expect(resolved.lostEntityIds).toEqual([]);
    const points = resolved.entities.filter((entity) => entity.type === 'point');
    expect(points).toHaveLength(4);
    expect(points.map((entity) => (entity.type === 'point' ? entity.x : 0)).sort()).toEqual([
      0, 0, 40, 40,
    ]);
  });

  it('replaces a broken corner from an older build when the face is projected again', () => {
    const square = (size: number): BodyEdge[] =>
      [
        [0, 0, 0, size, 0, 0],
        [size, 0, 0, size, size, 0],
        [size, size, 0, 0, size, 0],
        [0, size, 0, 0, 0, 0],
      ].map((points, index) => ({
        id: `e-${index}`,
        faceIds: [1],
        points,
        closed: false,
      }));
    const projected = addProjectionToSketch(sketch(), frame, mesh(square(20)), {
      kind: 'face',
      bodyId: 'body-1',
      faceId: '1',
    })!;
    // What an older build wrote: a corner named after its position.
    const legacy = {
      ...projected,
      projections: projected.projections!.map((projection, index) =>
        index === 4 ? { ...projection, source: { ...projection.source, elementId: 'v:20,0,0' } } : projection,
      ),
    };
    expect(resolveSketchProjections(legacy, frame, () => mesh(square(40))).lostEntityIds).toHaveLength(
      1,
    );

    const repaired = addProjectionToSketch(legacy, frame, mesh(square(40)), {
      kind: 'face',
      bodyId: 'body-1',
      faceId: '1',
    })!;
    expect(repaired.entities).toHaveLength(projected.entities.length);
    expect(repaired.projections).toHaveLength(projected.projections!.length);
    expect(resolveSketchProjections(repaired, frame, () => mesh(square(40))).lostEntityIds).toEqual(
      [],
    );
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
