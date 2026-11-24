import { expect, test, type Page } from '@playwright/test';

/**
 * The extend tool, end to end: a click takes hold of a curve, the pointer says
 * how far it grows, a second click ends it, and it stops at the first curve in
 * its way.
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

async function startExtend(page: Page) {
  await page.evaluate(async () => {
    const url = (name: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((entry) => entry.includes(name));
    const ui = await import(url('/src/stores/uiStore.ts') ?? '/src/stores/uiStore.ts');
    ui.useUiStore.getState().setSketchTool('extend');
  });
}

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
        entities: Array<{
          id: string;
          type: string;
          construction: boolean;
          x1?: number;
          x2?: number;
        }>;
        constraints: Array<{
          type: string;
          refs: Array<{ entityId: string; pointIndex?: number }>;
        }>;
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

/** Fit more of the sketch on the screen, so no click lands under a panel. */
async function zoomOut(page: Page, factor = 2.5) {
  await page.evaluate(async (scale) => {
    const url = (name: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((entry) => entry.includes(name));
    const handle = await import(url('/src/viewport/handle.ts') ?? '/src/viewport/handle.ts');
    const viewport = handle.getViewport()!;
    const pose = viewport.getCameraState();
    viewport.setCameraState({ ...pose, distance: pose.distance * scale });
  }, factor);
  await page.waitForTimeout(300);
}

/** A click that chooses the curve, a move outwards, and a click that ends it. */
async function stretch(page: Page, sketchId: string, from: [number, number], to: [number, number]) {
  const start = await screenPoint(page, sketchId, from);
  const end = await screenPoint(page, sketchId, to);
  await page.mouse.move(start.x, start.y);
  await page.waitForTimeout(150);
  await page.mouse.click(start.x, start.y);
  await page.waitForTimeout(250);
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.waitForTimeout(250);
  await page.mouse.click(end.x, end.y);
  await page.waitForTimeout(400);
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

test('stretches the end the click took hold of, and stays on for the next', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, [line('a', 0, 0, 40, 0)]);
  await page.waitForTimeout(300);
  await zoomOut(page);
  await startExtend(page);
  await expect(page.locator('.sketch-hint')).toBeVisible();

  // The first click lands near the far end; the pointer then goes further along
  // the line until the second click ends the stretch.
  await stretch(page, sketchId, [38, 0], [55, 0]);
  await expect
    .poll(
      async () => {
        const { entities } = await feature(page, sketchId);
        const grown = entities.find((entity) => entity.id === 'a');
        return grown?.x2 ?? 0;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(50);

  const tool = await page.evaluate(async () => {
    const url = (name: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((entry) => entry.includes(name));
    const ui = await import(url('/src/stores/uiStore.ts') ?? '/src/stores/uiStore.ts');
    return ui.useUiStore.getState().sketchTool;
  });
  expect(tool).toBe('extend');

  // The other end grows the same way, from the same tool.
  await stretch(page, sketchId, [2, 0], [-15, 0]);
  await expect
    .poll(
      async () => {
        const { entities } = await feature(page, sketchId);
        return entities.find((entity) => entity.id === 'a')?.x1 ?? 0;
      },
      { timeout: 15_000 },
    )
    .toBeLessThan(-10);

  const { entities, constraints } = await feature(page, sketchId);
  expect(entities).toHaveLength(1);
  expect(constraints).toHaveLength(0);
  await expect(page.locator('.toast-error')).toHaveCount(0);
});

test('stops at the curve in the way and joins it', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, [
    line('a', 0, 0, 40, 0),
    line('wall', 50, -20, 50, 20),
  ]);
  await page.waitForTimeout(300);
  await zoomOut(page);
  await startExtend(page);

  // The pointer goes past the wall; the curve stops on it all the same.
  await stretch(page, sketchId, [38, 0], [56, 0]);
  await expect
    .poll(
      async () => {
        const { constraints } = await feature(page, sketchId);
        return constraints.length;
      },
      { timeout: 15_000 },
    )
    .toBe(1);

  const { entities, constraints } = await feature(page, sketchId);
  const grown = entities.find((entity) => entity.id === 'a');
  expect(grown?.x2).toBeCloseTo(50, 0);
  expect(constraints[0]).toMatchObject({
    type: 'point-on-line',
    refs: [
      { entityId: 'a', pointIndex: 1 },
      { entityId: 'wall' },
    ],
  });
  await expect(page.locator('.toast-error')).toHaveCount(0);
});

test('choosing a curve changes nothing until the stretch is ended', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, [line('a', 0, 0, 40, 0)]);
  await page.waitForTimeout(300);
  await zoomOut(page);
  await startExtend(page);

  // The first click only takes hold of the curve, and the hint says so.
  const point = await screenPoint(page, sketchId, [38, 0]);
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(200);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(400);
  const after = await feature(page, sketchId);
  expect(after.entities).toHaveLength(1);
  expect(after.entities[0]?.x2).toBeCloseTo(40, 6);
  await expect(page.locator('.sketch-hint')).toContainText('click to finish');

  // Escape lets the curve go instead of leaving the tool.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const tool = await page.evaluate(async () => {
    const url = (name: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((entry) => entry.includes(name));
    const ui = await import(url('/src/stores/uiStore.ts') ?? '/src/stores/uiStore.ts');
    return ui.useUiStore.getState().sketchTool;
  });
  expect(tool).toBe('extend');
});
