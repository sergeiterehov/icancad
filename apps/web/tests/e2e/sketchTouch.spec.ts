import { expect, test, type Page } from '@playwright/test';

test.use({ hasTouch: true });

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
  await page.waitForTimeout(700);
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

async function replaceEntities(page: Page, sketchId: string, entities: unknown[]) {
  await page.evaluate(
    async ({ id, next }) => {
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
      const feature = model.features.find(
        (candidate: { id: string; type: string }) =>
          candidate.id === id && candidate.type === 'sketch',
      );
      if (!feature) throw new Error('NO_FEATURE');
      state.apply({
        type: 'feature/replace',
        feature: { ...feature, entities: next, constraints: [] },
      });
    },
    { id: sketchId, next: entities },
  );
}

async function entities(page: Page, sketchId: string) {
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
    ) as { features: Array<{ id: string; entities?: unknown[] }> };
    return (model.features.find((feature) => feature.id === id)?.entities ?? []) as Array<
      Record<string, number | string>
    >;
  }, sketchId);
}

async function selection(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const url = (name: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((entry) => entry.includes(name));
    const ui = await import(url('/src/stores/uiStore.ts') ?? '/src/stores/uiStore.ts');
    return ui.useUiStore.getState().sketchSelectionIds as string[];
  });
}

async function sketchTool(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const url = (name: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((entry) => entry.includes(name));
    const ui = await import(url('/src/stores/uiStore.ts') ?? '/src/stores/uiStore.ts');
    return ui.useUiStore.getState().sketchTool as string;
  });
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
      const projected = handle.getViewport()!.projectSketchPoint(frame, value);
      const canvas = document.querySelector('[data-testid="viewport-canvas"]')!;
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + projected!.x, y: rect.top + projected!.y };
    },
    { id: sketchId, value: point },
  );
}

/**
 * A finger gesture. The DevTools session is kept for the whole gesture, because
 * a move only belongs to the touch that started in the same session.
 */
async function gesture(page: Page) {
  const client = await page.context().newCDPSession(page);
  const send = (type: string, points: Array<{ x: number; y: number }>) =>
    client.send('Input.dispatchTouchEvent', {
      type: type as 'touchStart',
      touchPoints: points.map((point, index) => ({ ...point, id: index })),
    });
  return {
    start: (points: Array<{ x: number; y: number }>) => send('touchStart', points),
    move: (points: Array<{ x: number; y: number }>) => send('touchMove', points),
    end: () => send('touchEnd', []),
    close: () => client.detach(),
  };
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

test('opens a variant list by holding the tool group', async ({ page }) => {
  await openApp(page);
  await openSketch(page);
  const main = page.getByTestId('sketch-tool-circle');
  const group = (await main.boundingBox())!;
  const hold = { x: group.x + group.width / 2, y: group.y + group.height / 2 };

  const press = await gesture(page);
  await press.start([hold]);
  await page.waitForTimeout(800);
  await press.end();
  await press.close();
  await expect(page.getByRole('menuitem', { name: 'Ellipse' })).toBeVisible();
  // The hold opens the list; it does not also start the tool.
  expect(await sketchTool(page)).toBe('select');

  await page.getByRole('menuitem', { name: 'Ellipse' }).tap();
  await expect.poll(() => sketchTool(page)).toBe('ellipse');
});

test('a tap still starts the base tool', async ({ page }) => {
  await openApp(page);
  await openSketch(page);
  await page.getByTestId('sketch-tool-circle').tap();
  await expect.poll(() => sketchTool(page)).toBe('circle');
});

test('a two-finger pinch selects nothing', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, [
    line('a', -10, 0, 10, 0),
    line('b', -10, 8, 10, 8),
    { id: 'dot', type: 'point', construction: false, x: 0, y: 4 },
  ]);
  await page.waitForTimeout(400);

  // One finger begins a box on empty space and travels far enough for the box
  // to catch geometry, then a second finger joins and pinches the view.
  const empty = await screenPoint(page, sketchId, [-20, -12]);
  const across = await screenPoint(page, sketchId, [14, 12]);
  const pinch = await gesture(page);
  await pinch.start([empty]);
  await page.waitForTimeout(80);
  await pinch.move([{ x: empty.x + 20, y: empty.y + 20 }]);
  await page.waitForTimeout(80);
  await pinch.move([across]);
  await page.waitForTimeout(120);
  const partner = { x: empty.x - 40, y: empty.y - 40 };
  await pinch.start([across, partner]);
  await page.waitForTimeout(80);
  await pinch.move([
    { x: across.x + 60, y: across.y + 60 },
    { x: partner.x - 60, y: partner.y - 60 },
  ]);
  await page.waitForTimeout(150);
  await pinch.end();
  await pinch.close();

  expect(await selection(page)).toEqual([]);
});

test('a finger drags the whole set it pressed', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, [line('a', 0, 0, 10, 0), line('b', 0, 10, 10, 10)]);
  await page.waitForTimeout(400);

  // Select both with a crossing box, then drag one of them.
  const from = await screenPoint(page, sketchId, [15, 15]);
  const to = await screenPoint(page, sketchId, [-5, -5]);
  const box = await gesture(page);
  await box.start([from]);
  await page.waitForTimeout(80);
  await box.move([to]);
  await page.waitForTimeout(80);
  await box.end();
  await box.close();
  await expect.poll(() => selection(page)).toEqual(['a', 'b']);

  const before = await entities(page, sketchId);
  const grab = await screenPoint(page, sketchId, [5, 0]);
  const target = await screenPoint(page, sketchId, [15, 0]);
  const dragSet = await gesture(page);
  await dragSet.start([grab]);
  await page.waitForTimeout(80);
  await dragSet.move([{ x: grab.x + 12, y: grab.y }]);
  await page.waitForTimeout(80);
  await dragSet.move([target]);
  await page.waitForTimeout(150);
  await dragSet.end();
  await dragSet.close();
  await page.waitForTimeout(400);

  const after = await entities(page, sketchId);
  const first = after.find((entity) => entity.id === 'a')!;
  const second = after.find((entity) => entity.id === 'b')!;
  const beforeFirst = before.find((entity) => entity.id === 'a')!;
  const beforeSecond = before.find((entity) => entity.id === 'b')!;
  const deltaFirst = Number(first.x1) - Number(beforeFirst.x1);
  const deltaSecond = Number(second.x1) - Number(beforeSecond.x1);
  expect(deltaFirst).toBeGreaterThan(5);
  expect(deltaSecond).toBeCloseTo(deltaFirst, 1);
  // The set survives the drag, and the curve under the finger stays in it.
  expect((await selection(page)).sort()).toEqual(['a', 'b']);
});

test('a finger tap on a member of a set takes it out', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, [line('a', 0, 0, 10, 0), line('b', 0, 10, 10, 10)]);
  await page.waitForTimeout(400);

  await page.evaluate(async () => {
    const url = (name: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((entry) => entry.includes(name));
    const ui = await import(url('/src/stores/uiStore.ts') ?? '/src/stores/uiStore.ts');
    ui.useUiStore.getState().setSketchSelection(['a', 'b']);
  });
  const onA = await screenPoint(page, sketchId, [5, 0]);
  await page.touchscreen.tap(onA.x, onA.y);
  await expect.poll(() => selection(page)).toEqual(['b']);
});
