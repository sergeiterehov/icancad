import { expect, test, type Page } from '@playwright/test';

/**
 * The polygon tool, end to end: a centre, a radius, then the pointer that counts
 * the corners — and the figure that comes out is a closed ring of equal lines
 * held on a construction circle.
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

async function startPolygon(page: Page) {
  await page.evaluate(async () => {
    const url = (name: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((entry) => entry.includes(name));
    const ui = await import(url('/src/stores/uiStore.ts') ?? '/src/stores/uiStore.ts');
    ui.useUiStore.getState().setSketchTool('polygon');
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
      const projected = handle.getViewport()!.projectSketchPoint(frame, value)!;
      const canvas = document.querySelector('[data-testid="viewport-canvas"]')!;
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + projected.x, y: rect.top + projected.y };
    },
    { id: sketchId, value: point },
  );
}

/** A finger that comes down, travels and lifts, through the browser's own touch
 * input, so the page sees the pointer events a tablet would send. */
async function touchDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const client = await page.context().newCDPSession(page);
  const point = (x: number, y: number) => [{ x, y, radiusX: 4, radiusY: 4, force: 1 }];
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: point(from.x, from.y),
  });
  for (let step = 1; step <= 8; step += 1) {
    const x = from.x + ((to.x - from.x) * step) / 8;
    const y = from.y + ((to.y - from.y) * step) / 8;
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: point(x, y),
    });
    await page.waitForTimeout(20);
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

/** A pen tap: the browser reports `pointerType: 'pen'` for it, not a mouse. */
async function penTap(page: Page, at: { x: number; y: number }) {
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: at.x,
    y: at.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
    pointerType: 'pen',
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: at.x,
    y: at.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
    pointerType: 'pen',
  });
  await client.detach();
  await page.waitForTimeout(350);
}

async function clickAt(page: Page, sketchId: string, point: [number, number]) {
  const screen = await screenPoint(page, sketchId, point);
  await page.mouse.move(screen.x, screen.y);
  await page.waitForTimeout(150);
  await page.mouse.click(screen.x, screen.y);
  await page.waitForTimeout(250);
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
          y1?: number;
          x2?: number;
          y2?: number;
          cx?: number;
          cy?: number;
          r?: number;
        }>;
        constraints: Array<{ type: string }>;
      }>;
    };
    const found = model.features.find((candidate) => candidate.id === id);
    return { entities: found?.entities ?? [], constraints: found?.constraints ?? [] };
  }, sketchId);
}

test('draws a hexagon out of lines held on a construction circle', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await startPolygon(page);
  await expect(page.locator('.sketch-hint')).toBeVisible();

  await clickAt(page, sketchId, [0, 0]);
  await clickAt(page, sketchId, [12, 0]);
  // A sixth of a turn between the radius and the pointer is six corners.
  await clickAt(page, sketchId, [6, 10.3923]);

  await expect
    .poll(async () => (await feature(page, sketchId)).entities.length, { timeout: 15_000 })
    .toBe(7);

  const { entities, constraints } = await feature(page, sketchId);
  const lines = entities.filter((entity) => entity.type === 'line');
  const circles = entities.filter((entity) => entity.type === 'circle');
  expect(lines).toHaveLength(6);
  expect(circles).toHaveLength(1);
  // The circle is a helper, the figure itself is the lines.
  expect(circles[0]?.construction).toBe(true);
  expect(lines.every((line) => line.construction === false)).toBe(true);

  // Six joints where the edges meet, all edges equal, every corner on the
  // circle — and one more joint, because the centre was clicked on the origin
  // and the figure stays there.
  const types = constraints.map((constraint) => constraint.type);
  expect(types.filter((type) => type === 'coincident')).toHaveLength(7);
  expect(types.filter((type) => type === 'equal')).toHaveLength(5);
  expect(types.filter((type) => type === 'point-on-circle')).toHaveLength(6);

  // Every corner stands on the circle, and every edge is the same length.
  const radius = circles[0]!.r!;
  expect(radius).toBeGreaterThan(8);
  for (const line of lines) {
    expect(Math.hypot(line.x1! - 0, line.y1! - 0)).toBeCloseTo(radius, 1);
    expect(Math.hypot(line.x2! - line.x1!, line.y2! - line.y1!)).toBeCloseTo(radius, 1);
  }
  await expect(page.locator('.toast-error')).toHaveCount(0);
});

test('reads one number per step while it is drawn', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await startPolygon(page);

  await clickAt(page, sketchId, [0, 0]);
  // The radius step reads the radius and nothing else: the count is not being
  // set yet.
  const radius = await screenPoint(page, sketchId, [12, 0]);
  await page.mouse.move(radius.x, radius.y);
  await page.waitForTimeout(250);
  const chip = page.locator('[data-testid="sketch-live-measure"]');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('mm');
  await expect(chip).not.toContainText('corners');

  // Once the radius is named the chip swaps to the count, which follows the
  // pointer, and the radius is no longer read.
  await page.mouse.click(radius.x, radius.y);
  await page.waitForTimeout(250);
  const sides = await screenPoint(page, sketchId, [6, 10.3923]);
  await page.mouse.move(sides.x, sides.y, { steps: 10 });
  await page.waitForTimeout(250);
  await expect(chip).toContainText('6 corners');
  await expect(chip).not.toContainText('mm');
});

test('Shift makes the radius the distance to the edges', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await startPolygon(page);

  await clickAt(page, sketchId, [0, 0]);
  // Held for the click that names the radius, so the figure is built inside out
  // — and letting go of it afterwards must not undo that.
  await page.keyboard.down('Shift');
  await clickAt(page, sketchId, [12, 0]);
  await page.keyboard.up('Shift');
  await clickAt(page, sketchId, [6, 10.3923]);

  await expect
    .poll(async () => (await feature(page, sketchId)).entities.length, { timeout: 15_000 })
    .toBe(7);

  const { entities } = await feature(page, sketchId);
  const lines = entities.filter((entity) => entity.type === 'line');
  expect(lines).toHaveLength(6);
  // The corners stand further out than the radius pointed at, so that the middle
  // of every edge is that distance from the centre.
  const corners = lines.map((line) => Math.hypot(line.x1! - 0, line.y1! - 0));
  const apothem = corners[0]! * Math.cos(Math.PI / 6);
  // A screen click resolves to about a tenth of a millimetre here, so the radius
  // is 12 to within the pixel it was aimed at.
  expect(corners[0]).toBeGreaterThan(13);
  expect(apothem).toBeCloseTo(12, 0);
  await expect(page.locator('.toast-error')).toHaveCount(0);
});

test.describe('on a touch screen', () => {
  // A finger has neither a hover nor a key: the same three steps are taps, and
  // the hints say so.
  test.use({ hasTouch: true });

  test('draws a polygon with taps and asks for no key', async ({ page }) => {
    await openApp(page);
    const sketchId = await openSketch(page);
    await startPolygon(page);

    const tap = async (point: [number, number]) => {
      const at = await screenPoint(page, sketchId, point);
      await page.touchscreen.tap(at.x, at.y);
      await page.waitForTimeout(350);
    };

    await tap([0, 0]);
    const hint = page.locator('.sketch-hint');
    // The radius step teaches the gesture a finger has instead of Shift.
    await expect(hint).toContainText('Drag out from the centre');
    await expect(hint).not.toContainText('Shift');

    await tap([12, 0]);
    await expect(hint).toContainText('lift your finger');
    await expect(hint).not.toContainText('click');

    await tap([6, 10.3923]);
    await expect
      .poll(async () => (await feature(page, sketchId)).entities.length, { timeout: 15_000 })
      .toBe(7);
    const { entities, constraints } = await feature(page, sketchId);
    expect(entities.filter((entity) => entity.type === 'line')).toHaveLength(6);
    expect(entities.filter((entity) => entity.type === 'circle')).toHaveLength(1);
    // The figure is tied the same way a mouse would tie it.
    const types = constraints.map((constraint) => constraint.type);
    expect(types.filter((type) => type === 'equal')).toHaveLength(5);
    expect(types.filter((type) => type === 'point-on-circle')).toHaveLength(6);
    await expect(page.locator('.toast-error')).toHaveCount(0);
  });

  test('takes the centre and the radius from one drag of a finger', async ({ page }) => {
    await openApp(page);
    const sketchId = await openSketch(page);
    await startPolygon(page);

    // A finger that travels from the centre names the centre and the radius in
    // one gesture, so the next tap only has to count the corners.
    const centre = await screenPoint(page, sketchId, [0, 0]);
    const radius = await screenPoint(page, sketchId, [12, 0]);
    await touchDrag(page, centre, radius);
    await page.waitForTimeout(400);
    expect((await feature(page, sketchId)).entities).toHaveLength(0);

    const sides = await screenPoint(page, sketchId, [6, 10.3923]);
    await page.touchscreen.tap(sides.x, sides.y);
    await expect
      .poll(async () => (await feature(page, sketchId)).entities.length, { timeout: 15_000 })
      .toBe(7);
    const { entities } = await feature(page, sketchId);
    const lines = entities.filter((entity) => entity.type === 'line');
    expect(lines).toHaveLength(6);
    // The radius is the drag's own length, and the corners stand on it.
    const circle = entities.find((entity) => entity.type === 'circle');
    expect(circle?.r).toBeCloseTo(12, 0);
  });
});

test('takes a pen like a finger, and reads its hints the same way', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await startPolygon(page);

  const hint = page.locator('.sketch-hint');
  await penTap(page, await screenPoint(page, sketchId, [0, 0]));
  // A pen has no keyboard either: the step asks for a gesture, not for a key.
  await expect(hint).toContainText('Drag out from the centre');
  await expect(hint).not.toContainText('Shift');

  await penTap(page, await screenPoint(page, sketchId, [12, 0]));
  await penTap(page, await screenPoint(page, sketchId, [6, 10.3923]));
  await expect
    .poll(async () => (await feature(page, sketchId)).entities.length, { timeout: 15_000 })
    .toBe(7);
});

test('stays on, so the next polygon starts with a click', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await startPolygon(page);

  await clickAt(page, sketchId, [0, 0]);
  await clickAt(page, sketchId, [12, 0]);
  await clickAt(page, sketchId, [6, 10.3923]);
  await expect
    .poll(async () => (await feature(page, sketchId)).entities.length, { timeout: 15_000 })
    .toBe(7);

  const tool = await page.evaluate(async () => {
    const url = (name: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((entry) => entry.includes(name));
    const ui = await import(url('/src/stores/uiStore.ts') ?? '/src/stores/uiStore.ts');
    return ui.useUiStore.getState().sketchTool;
  });
  expect(tool).toBe('polygon');

  // A triangle this time, beside the first figure.
  // A third of a turn this time, so the second figure is a triangle.
  await clickAt(page, sketchId, [30, 0]);
  await clickAt(page, sketchId, [38, 0]);
  await clickAt(page, sketchId, [26, 6.9282]);
  // Seven entities for the hexagon and four for the triangle beside it.
  await expect
    .poll(async () => (await feature(page, sketchId)).entities.length, { timeout: 15_000 })
    .toBe(11);
  const { entities } = await feature(page, sketchId);
  expect(entities.filter((entity) => entity.type === 'line')).toHaveLength(9);
  expect(entities.filter((entity) => entity.type === 'circle')).toHaveLength(2);
});
