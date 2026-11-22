import type { SketchConstraint, SketchEntity } from '@icancad/model';
import { describe, expect, it, vi } from 'vitest';
import { solveSketch } from './planegcsSolve';

vi.mock('../src/sketch/client', () => import('./planegcsSolve'));

const { applyAutoConstraints } = await import('../src/sketch/autoApply');

const line = (id: string, x1: number, y1: number, x2: number, y2: number): SketchEntity => ({
  id,
  type: 'line',
  construction: false,
  x1,
  y1,
  x2,
  y2,
});

const con = (
  id: string,
  type: SketchConstraint['type'],
  refs: SketchConstraint['refs'],
  extra: Partial<SketchConstraint> = {},
): SketchConstraint => ({ id, type, refs, ...extra });

describe('applyAutoConstraints', () => {
  it('drops an older automatic constraint another one now implies', async () => {
    const entities = [line('L1', 0, 0, 10, 0), line('L2', 0, 0, 5, 5)];
    const existing = [
      con('pol', 'point-on-line', [{ entityId: 'L2', pointIndex: 0 }, { entityId: 'L1' }], {
        auto: true,
      }),
    ];
    const added = [
      con(
        'co',
        'coincident',
        [
          { entityId: 'L2', pointIndex: 0 },
          { entityId: 'L1', pointIndex: 0 },
        ],
        { auto: true },
      ),
    ];
    const result = await applyAutoConstraints({ entities, constraints: existing, added });
    expect(result?.removed).toEqual(['pol']);
    expect(result?.added.map((constraint) => constraint.id)).toEqual(['co']);
    const final = await solveSketch(entities, [...added], [], {});
    expect(final.conflicting).toEqual([]);
  });

  it('stores an automatic constraint the solver says is redundant only once', async () => {
    const entities = [line('L1', 0, 0, 10, 0), line('L2', 0, 5, 10, 5)];
    const existing = [
      con('h1', 'horizontal', [{ entityId: 'L1' }]),
      con('par', 'parallel', [{ entityId: 'L1' }, { entityId: 'L2' }]),
    ];
    const added = [con('h2', 'horizontal', [{ entityId: 'L2' }], { auto: true })];
    const result = await applyAutoConstraints({ entities, constraints: existing, added });
    expect(result?.added).toEqual([]);
    expect(result?.removed).toEqual([]);
  });

  it('keeps a coincidence and an alignment on a closing line', async () => {
    const entities = [
      line('L1', 0, 0, 10, 0),
      line('L2', 10, 0, 10, 8),
      line('L3', 10, 8, 0, 8),
      line('L4', 0, 8, 0, 0),
    ];
    const existing = [
      con('h1', 'horizontal', [{ entityId: 'L1' }], { auto: true }),
      con(
        'j1',
        'coincident',
        [
          { entityId: 'L1', pointIndex: 1 },
          { entityId: 'L2', pointIndex: 0 },
        ],
        { auto: true },
      ),
      con('v2', 'vertical', [{ entityId: 'L2' }], { auto: true }),
      con(
        'j2',
        'coincident',
        [
          { entityId: 'L2', pointIndex: 1 },
          { entityId: 'L3', pointIndex: 0 },
        ],
        { auto: true },
      ),
      con('h3', 'horizontal', [{ entityId: 'L3' }], { auto: true }),
    ];
    const added = [
      con(
        'co',
        'coincident',
        [
          { entityId: 'L4', pointIndex: 1 },
          { entityId: 'L1', pointIndex: 0 },
        ],
        { auto: true },
      ),
      con('v4', 'vertical', [{ entityId: 'L4' }], { auto: true }),
      con(
        'j3',
        'coincident',
        [
          { entityId: 'L3', pointIndex: 1 },
          { entityId: 'L4', pointIndex: 0 },
        ],
        { auto: true },
      ),
    ];
    const result = await applyAutoConstraints({ entities, constraints: existing, added });
    expect(result?.added.map((constraint) => constraint.id).sort()).toEqual(['co', 'j3', 'v4']);
    const solved = result!.entities.find((entity) => entity.id === 'L4')!;
    expect(solved.type).toBe('line');
    if (solved.type !== 'line') return;
    expect(solved.x1).toBeCloseTo(solved.x2);
    expect(solved.x2).toBeCloseTo(0);
    expect(solved.y2).toBeCloseTo(0);
  });
});
