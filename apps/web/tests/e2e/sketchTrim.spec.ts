import { expect, test, type Page } from '@playwright/test';

/**
 * The trim tool, end to end: the pointer picks the piece between the crossings
 * it stands over, the click cuts it away, and the curve is left as the pieces
 * on either side of the gap — with the relations of the curve following them.
 */

async function openApp(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('icancad.pinnedPanels', 'true');
    } catch {
      // Storage can be unavailable in private mode.
    }
  });
  await page.goto('/');
  await expect(page.getByTestId('app-skeleton')).toHaveCount(0, { timeout: 120_000 });
  await expect(page.getByTestId('viewport-skeleton')).toHaveCount(0, { timeout: 120_000 });
}

async function openSketch(page: Page): Promise<string> {
  await page
    .getByRole('navigation', { name: 'Tools' })
    .getByRole('button', { name: 'Sketch', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'XY plane' }).click();
  await expect(page.locator('.sketch-overlay')).toBeVisible();
  await page.waitForTimeout(600);
  const sketchId = await page.evaluate(async () => {
    const url = (name: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((entry) => entry.includes(name));
    const ui = await import(url('/src/stores/uiStore.ts') ?? '/src/stores/uiStore.ts');
    return ui.useUiStore.getState().activeSketchId as string | null;
  });
  if (!sketchId) throw new Error('NO_SKETCH');
  return sketchId;
}

async function replaceEntities(
  page: Page,
  sketchId: string,
  entities: unknown[],
  constraints: unknown[] = [],
) {
  await page.evaluate(
    async ({ id, next, joins }) => {
      const url = (name: string) =>
        performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .find((entry) => entry.includes(name));
      const doc = await import(
        url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts'
      );
      const state = doc.useDocumentStore.getState();
      const model = state.project.superObjects.find(
        (candidate: { id: string }) => candidate.id === state.project.activeSuperObjectId,
      ) as { features: Array<{ id: string; type: string }> };
      const feature = model.features.find((candidate) => candidate.id === id)!;
      state.apply({
        type: 'feature/replace',
        feature: { ...feature, entities: next, constraints: joins },
      });
    },
    { id: sketchId, next: entities, joins: constraints },
  );
}

async function startTool(page: Page, tool: 'trim') {
  await page.evaluate(async (next) => {
    const url = (name: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((entry) => entry.includes(name));
    const ui = await import(url('/src/stores/uiStore.ts') ?? '/src/stores/uiStore.ts');
    ui.useUiStore.getState().setSketchTool(next);
  }, tool);
}

type TrimEntity = {
  id: string;
  type: string;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  r?: number;
};

async function feature(page: Page, sketchId: string) {
  return page.evaluate(async (id) => {
    const url = (name: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((entry) => entry.includes(name));
    const doc = await import(url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts');
    const state = doc.useDocumentStore.getState();
    const model = state.project.superObjects.find(
      (candidate: { id: string }) => candidate.id === state.project.activeSuperObjectId,
    ) as {
      features: Array<{
        id: string;
        entities: TrimEntity[];
        constraints: Array<{ id: string; type: string; refs: Array<{ entityId: string }> }>;
      }>;
    };
    const found = model.features.find((candidate) => candidate.id === id);
    return { entities: found?.entities ?? [], constraints: found?.constraints ?? [] };
  }, sketchId);
}

async function screenPoint(page: Page, sketchId: string, point: [number, number]) {
  return page.evaluate(
    async ({ id, value }) => {
      const url = (name: string) =>
        performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .find((entry) => entry.includes(name));
      const kernel = await import(
        url('/src/stores/kernelStore.ts') ?? '/src/stores/kernelStore.ts'
      );
      const handle = await import(url('/src/viewport/handle.ts') ?? '/src/viewport/handle.ts');
      const frame = kernel.useKernelStore.getState().sketchFrames[id];
      const projected = handle.getViewport()!.projectSketchPoint(frame, value)!;
      const canvas = document.querySelector('[data-testid="viewport-canvas"]')!;
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + projected.x, y: rect.top + projected.y };
    },
    { id: sketchId, value: point },
  );
}

const line = (id: string, x1: number, y1: number, x2: number, y2: number) => ({
  id,
  type: 'line',
  construction: false,
  x1,
  y1,
  x2,
  y2,
});

/** A long line crossed at x = 10 and x = 30, with a stub joined to its far end. */
const crossed = () => [
  line('h', 0, 0, 40, 0),
  line('v1', 10, -10, 10, 10),
  line('v2', 30, -10, 30, 10),
  line('stub', 40, 0, 40, -10),
];

const spans = (entities: TrimEntity[]) =>
  entities
    .filter((entity) => entity.type === 'line')
    .map((entity) => [entity.x1, entity.x2])
    .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0));

test('cuts the piece the pointer stands over and leaves the rest', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, crossed());
  await page.waitForTimeout(300);
  await startTool(page, 'trim');
  await expect(page.locator('.sketch-hint')).toBeVisible();

  const middle = await screenPoint(page, sketchId, [20, 0]);
  await page.mouse.move(middle.x, middle.y);
  await page.waitForTimeout(250);
  await page.mouse.click(middle.x, middle.y);
  await expect
    .poll(async () => (await feature(page, sketchId)).entities.length, { timeout: 15_000 })
    .toBe(5);

  const { entities } = await feature(page, sketchId);
  // The cut line is gone and two pieces stand in its place: the middle one,
  // between the crossings, is what the pointer was on.
  expect(entities.some((entity) => entity.id === 'h')).toBe(true);
  expect(spans(entities)).toEqual([
    [0, 10],
    [10, 10],
    [30, 30],
    [30, 40],
    [40, 40],
  ]);
  await expect(page.locator('.toast-error')).toHaveCount(0);
});

test('refuses a curve nothing crosses', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, [line('a', 0, 0, 30, 0)]);
  await page.waitForTimeout(300);
  await startTool(page, 'trim');

  const middle = await screenPoint(page, sketchId, [15, 0]);
  await page.mouse.move(middle.x, middle.y);
  await page.waitForTimeout(250);
  await page.mouse.click(middle.x, middle.y);
  await expect(page.locator('.toast-error').first()).toBeVisible({ timeout: 15_000 });

  const { entities } = await feature(page, sketchId);
  expect(entities).toHaveLength(1);
  expect(entities[0]?.x2).toBe(30);
});

test('moves the relations of the cut curve onto the pieces that carry them', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(
    page,
    sketchId,
    crossed(),
    [
      {
        id: 'end',
        type: 'coincident',
        refs: [
          { entityId: 'h', pointIndex: 1 },
          { entityId: 'stub', pointIndex: 0 },
        ],
      },
      {
        id: 'start',
        type: 'coincident',
        refs: [
          { entityId: 'h', pointIndex: 0 },
          { entityId: 'v1', pointIndex: 0 },
        ],
      },
    ],
  );
  await page.waitForTimeout(300);
  await startTool(page, 'trim');
  // The pointer stands on the piece before the first crossing, so the end the
  // joint `start` names is the one that goes.
  const first = await screenPoint(page, sketchId, [5, 0]);
  await page.mouse.move(first.x, first.y);
  await page.waitForTimeout(250);
  await page.mouse.click(first.x, first.y);
  await expect
    .poll(async () => (await feature(page, sketchId)).entities.length, { timeout: 15_000 })
    .toBe(5);

  const { entities, constraints } = await feature(page, sketchId);
  expect(constraints.map((constraint) => constraint.id)).toEqual(['end']);
  // The joint that named the far end now names a piece that really ends there.
  const joint = constraints[0]!;
  const piece = entities.find((entity) => entity.id === joint.refs[0]?.entityId)!;
  expect(piece.x2).toBeCloseTo(40, 6);
  await expect(page.locator('.toast-error')).toHaveCount(0);
});

test('turns a cut circle into the arcs that are left', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, [
    { id: 'c', type: 'circle', construction: false, cx: 0, cy: 0, r: 15 },
    line('a', -25, 0, 25, 0),
  ]);
  await page.waitForTimeout(300);
  await startTool(page, 'trim');
  // The upper half is cut, so the lower half stays as one arc.
  const upper = await screenPoint(page, sketchId, [0, 15]);
  await page.mouse.move(upper.x, upper.y);
  await page.waitForTimeout(250);
  await page.mouse.click(upper.x, upper.y);
  await expect
    .poll(async () => (await feature(page, sketchId)).entities.filter((e) => e.type === 'arc').length, {
      timeout: 15_000,
    })
    .toBe(1);

  const { entities } = await feature(page, sketchId);
  const arc = entities.find((entity) => entity.type === 'arc')!;
  expect(arc.r).toBeCloseTo(15, 6);
  expect(arc.id).toBe('c');
  await expect(page.locator('.toast-error')).toHaveCount(0);
});
