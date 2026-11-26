import { expect, test, type Page } from '@playwright/test';

/**
 * The clipboard (ADR 0059), end to end: Cmd/Ctrl+C puts the selected geometry
 * on the system clipboard as JSON, and a paste waits under the pointer until a
 * click places it.
 */

// The system clipboard is what makes a copy travel between tabs and browsers;
// the test reads it back, which the browser only allows with these.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

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

const line = (id: string, x1: number, y1: number, x2: number, y2: number) => ({
  id,
  type: 'line',
  construction: false,
  x1,
  y1,
  x2,
  y2,
});

async function seed(page: Page, sketchId: string, entities: unknown[]) {
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
      const feature = model.features.find((candidate) => candidate.id === id)!;
      state.apply({ type: 'feature/replace', feature: { ...feature, entities: next } });
    },
    { id: sketchId, next: entities },
  );
}

async function select(page: Page, ids: string[]) {
  await page.evaluate(async (selection) => {
    const url = (name: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((entry) => entry.includes(name));
    const ui = await import(url('/src/stores/uiStore.ts') ?? '/src/stores/uiStore.ts');
    ui.useUiStore.getState().setSketchSelection(selection);
  }, ids);
}

async function state(page: Page, sketchId: string) {
  return page.evaluate(async (id) => {
    const url = (name: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((entry) => entry.includes(name));
    const doc = await import(url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts');
    const ui = await import(url('/src/stores/uiStore.ts') ?? '/src/stores/uiStore.ts');
    const store = doc.useDocumentStore.getState();
    const model = store.project.superObjects.find(
      (candidate: { id: string }) => candidate.id === store.project.activeSuperObjectId,
    ) as {
      features: Array<{
        id: string;
        entities: Array<{
          id: string;
          type: string;
          x1?: number;
          y1?: number;
          x2?: number;
          y2?: number;
        }>;
      }>;
    };
    const feature = model.features.find((candidate) => candidate.id === id);
    return {
      entities: feature?.entities ?? [],
      selection: ui.useUiStore.getState().sketchSelectionIds,
    };
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

test('copies the selected geometry as JSON for the system clipboard', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await seed(page, sketchId, [line('a', 0, 0, 40, 0)]);
  await page.waitForTimeout(300);
  await select(page, ['a']);

  await page.keyboard.press('Control+c');
  await expect
    .poll(
      async () =>
        page.evaluate(() => navigator.clipboard.readText().catch(() => '')).catch(() => ''),
      { timeout: 15_000 },
    )
    .toContain('icancad.sketch-geometry');

  const payload = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(payload).toMatchObject({ kind: 'icancad.sketch-geometry', version: 1 });
  expect(payload.entities).toHaveLength(1);
  expect(payload.entities[0]).toMatchObject({ type: 'line', x1: 0, y1: 0, x2: 40, y2: 0 });
});

test('pastes under the pointer and selects what landed', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await seed(page, sketchId, [line('a', 0, 0, 40, 0)]);
  await page.waitForTimeout(300);
  await select(page, ['a']);

  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  // The armed paste is a ghost: nothing has been added to the sketch yet.
  await expect.poll(async () => (await state(page, sketchId)).entities.length).toBe(1);

  const target = await screenPoint(page, sketchId, [20, 10]);
  await page.mouse.move(target.x, target.y);
  await page.waitForTimeout(250);
  await expect(page.locator('.sketch-hint')).toContainText('Click to place');
  expect((await state(page, sketchId)).entities).toHaveLength(1);

  await page.mouse.click(target.x, target.y);
  await expect
    .poll(async () => (await state(page, sketchId)).entities.length, { timeout: 15_000 })
    .toBe(2);

  const { entities, selection } = await state(page, sketchId);
  const pasted = entities.find((entity) => entity.id !== 'a')!;
  // The centre of the copy follows the pointer: the line keeps its length and
  // lands around the clicked place, to within the pixel a screen click resolves.
  expect(pasted.type).toBe('line');
  expect(pasted.x2! - pasted.x1!).toBeCloseTo(40, 6);
  expect((pasted.x1! + pasted.x2!) / 2).toBeCloseTo(20, 0);
  expect(pasted.y1!).toBeCloseTo(10, 0);
  // What landed is what is selected, and the old selection is gone.
  expect(selection).toEqual([pasted.id]);
  await expect(page.locator('.toast-error')).toHaveCount(0);
});

test('Shift keeps the paste armed, and the selection accumulates', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await seed(page, sketchId, [line('a', 0, 0, 40, 0)]);
  await page.waitForTimeout(300);
  await select(page, ['a']);

  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');

  const first = await screenPoint(page, sketchId, [20, 10]);
  await page.mouse.move(first.x, first.y);
  await page.waitForTimeout(250);
  await page.keyboard.down('Shift');
  await page.mouse.click(first.x, first.y);
  await page.keyboard.up('Shift');
  await expect
    .poll(async () => (await state(page, sketchId)).entities.length, { timeout: 15_000 })
    .toBe(2);
  // The paste is still armed, so the next click places another copy.
  await expect(page.locator('.sketch-hint')).toContainText('Shift keeps pasting');

  const second = await screenPoint(page, sketchId, [20, -10]);
  await page.mouse.move(second.x, second.y);
  await page.waitForTimeout(250);
  await page.mouse.click(second.x, second.y);
  await expect
    .poll(async () => (await state(page, sketchId)).entities.length, { timeout: 15_000 })
    .toBe(3);

  const { entities, selection } = await state(page, sketchId);
  // Every object the run placed is selected, and the paste is over.
  expect(selection).toEqual(
    entities.filter((entity) => entity.id !== 'a').map((entity) => entity.id),
  );
  expect(selection).toHaveLength(2);
  // Each copy is an object of its own: a run never writes one id twice.
  expect(new Set(entities.map((entity) => entity.id)).size).toBe(entities.length);
  await expect(page.locator('.sketch-hint')).not.toContainText('Shift keeps pasting');
});

test('drops an armed paste on Escape', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await seed(page, sketchId, [line('a', 0, 0, 40, 0)]);
  await page.waitForTimeout(300);
  await select(page, ['a']);

  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  const target = await screenPoint(page, sketchId, [20, 10]);
  await page.mouse.move(target.x, target.y);
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(400);
  expect((await state(page, sketchId)).entities).toHaveLength(1);
});

test('pastes from the context menu where the menu was opened', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await seed(page, sketchId, [line('a', 0, 0, 40, 0)]);
  await page.waitForTimeout(300);
  await select(page, ['a']);

  await page.keyboard.press('Control+c');
  const spot = await screenPoint(page, sketchId, [20, -10]);
  await page.mouse.click(spot.x, spot.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Paste' }).click();
  await expect
    .poll(async () => (await state(page, sketchId)).entities.length, { timeout: 15_000 })
    .toBe(2);

  const { entities, selection } = await state(page, sketchId);
  const pasted = entities.find((entity) => entity.id !== 'a')!;
  expect(pasted.y1!).toBeCloseTo(-10, 0);
  expect(pasted.x2! - pasted.x1!).toBeCloseTo(40, 6);
  expect(selection).toEqual([pasted.id]);
});

test('offers both Copy and Paste on the geometry menu', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await seed(page, sketchId, [line('a', 0, 0, 40, 0)]);
  await page.waitForTimeout(300);

  const onLine = await screenPoint(page, sketchId, [20, 0]);
  await page.mouse.click(onLine.x, onLine.y, { button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Copy' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Copy' }).click();
  await expect
    .poll(
      async () =>
        page.evaluate(() => navigator.clipboard.readText().catch(() => '')).catch(() => ''),
      { timeout: 15_000 },
    )
    .toContain('icancad.sketch-geometry');
});
