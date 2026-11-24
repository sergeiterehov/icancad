import {
  createId,
  type SketchConstraint,
  type SketchEntity,
  type SketchFeature,
} from '@icancad/model';
import {
  collectCurveChains,
  entityControlPoints,
  isFundamentalEntityId,
  offsetChain,
  outlineChain,
  signedDistanceToChain,
  sketchEntityIndex,
  type CurveChain,
  type OffsetJoin,
  type OffsetLoop,
  type OffsetPiece,
} from '@icancad/sketch';
import { uniqueConstraints } from './constraintModel';
import { solveSketch } from './client';
import { canonicalLine, lineSide } from './distance';
import { projectionEntityIds } from './projection';
import { constraintsForSolve } from './resolvedConstraints';

/**
 * The Смещение and Контур tools: what they read from the selection, what they
 * preview while the pointer sets the distance, and the feature they commit.
 *
 * The geometry comes from `@icancad/sketch`; this module owns the sketch-level
 * decisions: which entities may take part, which dimensions are added, and how
 * the result joins the document in one undoable step.
 */

export type OffsetTool = 'offset' | 'outline';

export interface OffsetToolOptions {
  tool: OffsetTool;
  join: OffsetJoin;
}

/** Shortest distance the pointer has to travel before a preview appears. */
const MIN_DISTANCE = 0.05;

export type OffsetSelectionError = 'empty' | 'branching';

export interface OffsetSelection {
  chains: CurveChain[];
  error?: OffsetSelectionError;
}

/** The curve entities of a selection: points and the sketch axes take no part. */
export function offsetSelectionEntities(
  feature: SketchFeature,
  selectionKeys: readonly string[],
): SketchEntity[] {
  const ids = new Set(
    selectionKeys
      .filter((key) => !key.includes('#'))
      .filter((id) => id.length > 0 && !isFundamentalEntityId(id)),
  );
  const byId = sketchEntityIndex(feature.entities);
  return [...ids]
    .map((id) => byId.get(id))
    .filter((entity): entity is SketchEntity => Boolean(entity) && entity!.type !== 'point');
}

export function offsetSelection(
  feature: SketchFeature,
  selectionKeys: readonly string[],
): OffsetSelection {
  const entities = offsetSelectionEntities(feature, selectionKeys);
  if (entities.length === 0) return { chains: [], error: 'empty' };
  const { chains, error } = collectCurveChains(entities);
  if (error === 'branching') return { chains: [], error: 'branching' };
  if (chains.length === 0) return { chains: [], error: 'empty' };
  return { chains };
}

export interface OffsetPlanLoop {
  loop: OffsetLoop;
  /** Signed distance the loop was built at. */
  distance: number;
}

export type OffsetPlanError =
  | OffsetSelectionError
  | 'too-close'
  | 'distance'
  | 'degenerate'
  | 'self-intersection';

export type OffsetPlan =
  | { ok: true; loops: OffsetPlanLoop[] }
  | { ok: false; error: OffsetPlanError };

/**
 * Builds the geometry the pointer asks for. The distance is how far the pointer
 * is from the chain on its own side, so the preview follows the pointer and the
 * click commits exactly what was seen.
 */
export function planOffset(
  feature: SketchFeature,
  selectionKeys: readonly string[],
  pointer: readonly [number, number],
  options: OffsetToolOptions,
): OffsetPlan {
  const selection = offsetSelection(feature, selectionKeys);
  if (selection.error) return { ok: false, error: selection.error };

  const loops: OffsetPlanLoop[] = [];
  for (const chain of selection.chains) {
    const signed = signedDistanceToChain(chain, [pointer[0], pointer[1]]);
    const distance = options.tool === 'outline' ? Math.abs(signed) : signed;
    if (Math.abs(distance) < MIN_DISTANCE) return { ok: false, error: 'too-close' };
    const result =
      options.tool === 'outline'
        ? outlineChain(chain, { distance, join: options.join })
        : offsetChain(chain, { distance, join: options.join });
    if (!result.ok) return { ok: false, error: result.reason };
    for (const loop of result.loops) loops.push({ loop, distance });
  }
  if (loops.length === 0) return { ok: false, error: 'too-close' };
  return { ok: true, loops };
}

/** The preview geometry: ordinary drafts, named so the overlay can draw them. */
export function offsetPreviewEntities(plan: OffsetPlan): SketchEntity[] {
  if (!plan.ok) return [];
  const entities: SketchEntity[] = [];
  for (const { loop } of plan.loops) {
    for (const piece of loop.pieces) {
      entities.push({ ...piece.curve, id: `preview${entities.length}` } as SketchEntity);
    }
  }
  return entities;
}

/**
 * The driving dimensions of one offset piece: the distance back to its source
 * for a line, coaxiality and a diameter for an arc or a circle, and the
 * diameter of every corner arc and cap the tools add.
 *
 * The values are exact. Rounding them to the hundredth the chip shows would
 * leave the solver with a set the generated geometry itself cannot satisfy,
 * and a conflict would then drop the whole set.
 */
export function offsetConstraintsForPiece(
  source: SketchEntity | undefined,
  result: SketchEntity,
  piece: OffsetPiece,
  distance: number,
): SketchConstraint[] {
  const constraints: SketchConstraint[] = [];
  const add = (type: SketchConstraint['type'], refs: SketchConstraint['refs'], extra = {}) => {
    constraints.push({ id: createId('con'), type, refs, auto: true, ...extra } as SketchConstraint);
  };
  const resultRef = { entityId: result.id };

  if (piece.role === 'offset' && source?.type === 'line' && result.type === 'line') {
    // The result runs parallel to its source and keeps the distance the pointer
    // set; `side` stops the solver from moving it to the other side.
    const sourceRef = { entityId: source.id };
    add('parallel', [sourceRef, resultRef]);
    add('distance', [sourceRef, resultRef], {
      value: Math.abs(distance),
      side: lineSide(canonicalLine(source).start, result) || undefined,
    });
    return constraints;
  }

  if (
    piece.role === 'offset' &&
    (source?.type === 'circle' || source?.type === 'arc') &&
    (result.type === 'circle' || result.type === 'arc')
  ) {
    add('coincident', [
      { entityId: source.id, pointIndex: 0 },
      { entityId: result.id, pointIndex: 0 },
    ]);
    // A circle is the whole chain, so its radius is the only thing that can say
    // how wide the result is; it has to be pinned.
    if (result.type === 'circle') add('diameter', [resultRef], { value: result.r * 2 });
    // An arc in a chain is not pinned: its centre is concentric with its source,
    // and its ends are held by the offset lines that meet it. The radius follows
    // them — which is what keeps the band the same width when the source arc
    // grows or shrinks, instead of staying at the radius it was born with.
    return constraints;
  }

  if (piece.role !== 'offset' && result.type === 'arc') {
    add('diameter', [resultRef], { value: result.r * 2 });
  }
  return constraints;
}

export interface OffsetCommit {
  feature: SketchFeature;
  createdIds: string[];
  /** Constraints the tool added; they are already part of the returned feature. */
  addedConstraintIds: string[];
}

interface EndpointRefs {
  start: { entityId: string; pointIndex: number } | null;
  end: { entityId: string; pointIndex: number } | null;
}

/** The control points where a piece begins and ends; closed curves have none. */
function endpointRefsOf(entity: SketchEntity): EndpointRefs {
  switch (entity.type) {
    case 'line':
      return {
        start: { entityId: entity.id, pointIndex: 0 },
        end: { entityId: entity.id, pointIndex: 1 },
      };
    case 'arc':
      return {
        start: { entityId: entity.id, pointIndex: 1 },
        end: { entityId: entity.id, pointIndex: 2 },
      };
    case 'elliptical-arc':
      return {
        start: { entityId: entity.id, pointIndex: 3 },
        end: { entityId: entity.id, pointIndex: 4 },
      };
    case 'bezier':
      return {
        start: { entityId: entity.id, pointIndex: 0 },
        end: { entityId: entity.id, pointIndex: entity.points.length - 1 },
      };
    default:
      return { start: null, end: null };
  }
}

/**
 * The end of one piece and the start of the next are one joint: a gap that the
 * geometry already has is closed by moving both ends onto their midpoint, so
 * the loop the tool draws is the loop the sketch keeps. A wider gap is not a
 * joint at all and stays open.
 */
const JOINT_TOLERANCE = 0.05;

function snapJoint(first: SketchEntity, second: SketchEntity, endIndex: number, startIndex: number) {
  const endPoint = entityControlPoints(first)[endIndex];
  const startPoint = entityControlPoints(second)[startIndex];
  if (!endPoint || !startPoint) return false;
  const gap = Math.hypot(endPoint[0] - startPoint[0], endPoint[1] - startPoint[1]);
  if (gap > JOINT_TOLERANCE) return false;
  if (gap > 1e-9) {
    const middle: [number, number] = [
      (endPoint[0] + startPoint[0]) / 2,
      (endPoint[1] + startPoint[1]) / 2,
    ];
    moveControlPoint(first, endIndex, middle);
    moveControlPoint(second, startIndex, middle);
  }
  return true;
}

/** Moves one control point of a piece in place, keeping the curve's own definition. */
function moveControlPoint(entity: SketchEntity, index: number, point: [number, number]) {
  switch (entity.type) {
    case 'line':
      if (index === 0) {
        entity.x1 = point[0];
        entity.y1 = point[1];
      } else {
        entity.x2 = point[0];
        entity.y2 = point[1];
      }
      return;
    case 'arc': {
      const angle = Math.atan2(point[1] - entity.cy, point[0] - entity.cx);
      if (index === 1) entity.startAngle = angle;
      else entity.endAngle = angle;
      return;
    }
    case 'elliptical-arc': {
      // The point sits on the ellipse, so its own parameter is what moves.
      const rotation = (entity.rotation * Math.PI) / 180;
      const dx = point[0] - entity.cx;
      const dy = point[1] - entity.cy;
      const localX = Math.cos(rotation) * dx + Math.sin(rotation) * dy;
      const localY = -Math.sin(rotation) * dx + Math.cos(rotation) * dy;
      const angle = Math.atan2(localY / (entity.ry || 1), localX / (entity.rx || 1));
      if (index === 3) entity.startAngle = angle;
      else entity.endAngle = angle;
      return;
    }
    case 'bezier': {
      const point2 = entity.points[index];
      if (point2) {
        entity.points[index] = point;
      }
      return;
    }
    default:
      return;
  }
}

function jointConstraints(created: readonly SketchEntity[], closed: boolean): SketchConstraint[] {
  const constraints: SketchConstraint[] = [];
  const count = created.length;
  for (let index = 0; index < count; index += 1) {
    const isLast = index === count - 1;
    if (isLast && !closed) break;
    const first = created[index]!;
    const second = created[(index + 1) % count]!;
    const end = endpointRefsOf(first).end;
    const start = endpointRefsOf(second).start;
    if (!end || !start) continue;
    if (!snapJoint(first, second, end.pointIndex, start.pointIndex)) continue;
    // The joint is a coincidence and nothing else. A tangency here would repeat
    // what the other relations already say — the pieces' own dimensions and the
    // two coincidences at their ends fix the angle — and a rank-deficient system
    // is what makes the solver spend seconds on a sketch and then paint geometry
    // that still moves as fully constrained.
    constraints.push({ id: createId('con'), type: 'coincident', refs: [end, start], auto: true });
  }
  return constraints;
}

export type OffsetCommitResult = { ok: true; commit: OffsetCommit } | { ok: false; error: OffsetPlanError };

interface OffsetBuild {
  entities: SketchEntity[];
  createdIds: string[];
  added: SketchConstraint[];
}

/** Geometry and dimensions of the operation, before they join the feature. */
function buildOffset(
  feature: SketchFeature,
  selectionKeys: readonly string[],
  pointer: readonly [number, number],
  options: OffsetToolOptions,
): { ok: true; build: OffsetBuild } | { ok: false; error: OffsetPlanError } {
  const plan = planOffset(feature, selectionKeys, pointer, options);
  if (!plan.ok) return { ok: false, error: plan.error };

  const byId = sketchEntityIndex(feature.entities);
  const entities = [...feature.entities];
  const createdIds: string[] = [];
  const generated: SketchConstraint[] = [];

  for (const { loop, distance } of plan.loops) {
    const created: SketchEntity[] = [];
    for (const piece of loop.pieces) {
      const entity = { ...piece.curve, id: createId('entity') } as SketchEntity;
      entities.push(entity);
      created.push(entity);
      createdIds.push(entity.id);
      const source = piece.sourceId ? byId.get(piece.sourceId) : undefined;
      generated.push(...offsetConstraintsForPiece(source, entity, piece, distance));
    }
    // The pieces have to stay joined: a changed distance moves them, and
    // without the joints a loop would open up instead of breathing.
    generated.push(...jointConstraints(created, loop.closed));
  }

  const added = uniqueConstraints(generated, feature.constraints, sketchEntityIndex(entities));
  return { ok: true, build: { entities, createdIds, added } };
}

/**
 * The feature after the operation: the preview geometry becomes real entities,
 * with their driving dimensions, in the same edit as everything else.
 */
export function commitOffset(
  feature: SketchFeature,
  selectionKeys: readonly string[],
  pointer: readonly [number, number],
  options: OffsetToolOptions,
): OffsetCommitResult {
  const built = buildOffset(feature, selectionKeys, pointer, options);
  if (!built.ok) return built;
  const { entities, createdIds, added } = built.build;
  return {
    ok: true,
    commit: {
      feature: { ...feature, entities, constraints: [...feature.constraints, ...added] },
      createdIds,
      addedConstraintIds: added.map((constraint) => constraint.id),
    },
  };
}

/**
 * The order constraints give way in when the solver cannot hold them all. The
 * joints come first and the sizes last: a contour whose pieces are not joined
 * falls apart under the first drag, while a diameter the loop closure already
 * implies changes nothing that is seen.
 */
const DROP_ORDER: readonly SketchConstraint['type'][] = [
  'diameter',
  'distance',
  'parallel',
  'tangent',
];

/**
 * The commit the editor uses. The whole set of generated constraints goes to the
 * solver once, and the usual case is a single solve: the contour has to appear
 * under the click without a wait.
 *
 * The solve is a plain one. Asking the solver which constraints are implied
 * costs a rank analysis of the whole system — a hundred milliseconds and more
 * for a contour — while a solve itself is a couple of milliseconds. The implied
 * constraints are harmless: the solver holds them, and dropping one would be a
 * second guess about the shape the user can see.
 *
 * If the set cannot be solved at all, the class that matters least gives way and
 * the solve is tried again: diameters first, then distances, then parallels,
 * then tangencies. Coincidences are never dropped — they are the connectivity
 * the operation is for — so the pieces stay joined even when a dimension has to
 * go.
 */
export async function commitOffsetSolved(
  feature: SketchFeature,
  selectionKeys: readonly string[],
  pointer: readonly [number, number],
  options: OffsetToolOptions,
): Promise<OffsetCommitResult> {
  const built = buildOffset(feature, selectionKeys, pointer, options);
  if (!built.ok) return built;
  const { entities, createdIds, added } = built.build;
  if (added.length === 0) {
    return {
      ok: true,
      commit: {
        feature: { ...feature, entities },
        createdIds,
        addedConstraintIds: [],
      },
    };
  }

  const existing = feature.constraints;
  const derived = [...projectionEntityIds(feature)];
  let solved = entities;
  let kept = added;
  for (let pass = 0; pass <= DROP_ORDER.length; pass += 1) {
    const attempt = await solveSketch(
      solved,
      constraintsForSolve({ ...feature, constraints: [...existing, ...kept] }),
      [],
      { derived },
    ).catch(() => null);
    if (attempt) {
      solved = attempt.entities;
      break;
    }
    // The set does not solve as a whole: the least important class goes, and
    // what is left gets its own attempt.
    const worst = DROP_ORDER.find((type) => kept.some((constraint) => constraint.type === type));
    if (!worst) break;
    kept = kept.filter((constraint) => constraint.type !== worst);
    if (kept.length === 0) break;
  }

  return {
    ok: true,
    commit: {
      feature: {
        ...feature,
        entities: solved,
        constraints: [...existing, ...kept],
      },
      createdIds,
      addedConstraintIds: kept.map((constraint) => constraint.id),
    },
  };
}
