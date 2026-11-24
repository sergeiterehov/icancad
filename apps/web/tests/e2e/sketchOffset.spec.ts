import { expect, test, type Page } from '@playwright/test';

/**
 * The offset and contour tools, end to end: the hint stays clear of the
 * operations dock, a corner that fits is rounded at every width, only Shift
 * makes it sharp, a stroke wider than the radius of its own arc still builds,
 * and the result arrives without a wait.
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
      ) as { features: Array<{ id: string; type: string; entities: Array<{ id: string }> }> };
      const feature = model.features.find((candidate) => candidate.id === id);
      if (!feature) throw new Error('NO_FEATURE');
      state.apply({
        type: 'feature/replace',
        feature: { ...feature, entities: next, constraints: [] },
      });
    },
    { id: sketchId, next: entities },
  );
}

/** Selects curves by id, the way a click on each of them would. */
async function select(page: Page, ids: string[]) {
  await page.evaluate(async (next) => {
    const url = (name: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((entry) => entry.includes(name));
    const ui = await import(url('/src/stores/uiStore.ts') ?? '/src/stores/uiStore.ts');
    ui.useUiStore.getState().setSketchSelection(next);
  }, ids);
}

async function startTool(page: Page, tool: 'offset' | 'outline') {
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
        entities: Array<{ id: string; type: string; r?: number }>;
        constraints: Array<{ type: string }>;
      }>;
    };
    const found = model.features.find((candidate) => candidate.id === id);
    return {
      entities: found?.entities ?? [],
      constraints: found?.constraints ?? [],
    };
  }, sketchId);
}

/** Screen position of a sketch point, in page coordinates. */
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

/** Applies the tool at a sketch point and waits for the geometry it creates. */
async function applyAt(
  page: Page,
  sketchId: string,
  point: [number, number],
  options: { shift?: boolean } = {},
) {
  const before = (await feature(page, sketchId)).entities.length;
  const target = await screenPoint(page, sketchId, point);
  if (options.shift) await page.keyboard.down('Shift');
  await page.mouse.move(target.x, target.y);
  await page.waitForTimeout(120);
  await page.mouse.click(target.x, target.y);
  if (options.shift) await page.keyboard.up('Shift');
  await expect
    .poll(async () => (await feature(page, sketchId)).entities.length, { timeout: 15_000 })
    .toBeGreaterThan(before);
  await page.waitForTimeout(200);
  return (await feature(page, sketchId)).entities.slice(before);
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

/** A chain with two corners: one at 45°, one at 45° the other way. */
const bent = () => [
  line('a', 0, 0, 20, 0),
  line('b', 20, 0, 30, 10),
  line('c', 30, 10, 30, 30),
];

/** Two lines joined by an arc of r ≈ 8.63 that meets both of them tangentially. */
const tangentChain = () => [
  line('a', 11.516910393054463, 13.490584289736725, 20.861496908757797, 35.44943377046296),
  line('b', 32.9464195797937, 39.63922291300685, 65.94641957979371, 21.568155101141365),
  {
    id: 'arc',
    type: 'arc',
    construction: false,
    cx: 28.801715349339897,
    cy: 32.07048536711116,
    r: 8.629273503406258,
    startAngle: -3.543927831711292,
    endAngle: -5.213394173084436,
  },
];

const roundArcs = (entities: Array<{ type: string; r?: number }>, width: number) =>
  entities.filter(
    (entity) => entity.type === 'arc' && Math.abs((entity.r ?? 0) - width) < 0.5,
  ).length;

test('keeps the hint clear of the operations dock', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, bent());
  await page.waitForTimeout(300);
  await select(page, ['a', 'b', 'c']);
  await page.waitForTimeout(200);

  // Starting the tool through the menu is the path a user takes.
  const rail = page.locator('.tool-rail-sketch');
  await rail.getByRole('button', { name: 'Tools' }).click();
  await page.getByRole('menuitem', { name: 'Outline' }).click();
  await expect(page.locator('.sketch-hint')).toBeVisible();

  const centre = await screenPoint(page, sketchId, [10, 10]);
  await page.mouse.move(centre.x, centre.y);
  await page.waitForTimeout(200);

  const boxes = await page.evaluate(() => {
    const hint = document.querySelector('.sketch-hint')!.getBoundingClientRect();
    const dock = document.querySelector('.operations-dock')!.getBoundingClientRect();
    return {
      hint: { top: hint.top, bottom: hint.bottom, left: hint.left, right: hint.right },
      dock: { top: dock.top, bottom: dock.bottom, left: dock.left, right: dock.right },
    };
  });
  const overlaps =
    boxes.hint.left < boxes.dock.right &&
    boxes.dock.left < boxes.hint.right &&
    boxes.hint.top < boxes.dock.bottom &&
    boxes.dock.top < boxes.hint.bottom;
  expect(overlaps, JSON.stringify(boxes)).toBe(false);
  expect(boxes.hint.bottom).toBeLessThanOrEqual(boxes.dock.top + 0.5);
});

test('rounds the corners of a contour at every width and only Shift sharpens them', async ({
  page,
}) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, bent());
  await page.waitForTimeout(300);
  const ids = ['a', 'b', 'c'];

  for (const width of [4, 6, 8]) {
    await replaceEntities(page, sketchId, bent());
    await page.waitForTimeout(100);
    await select(page, ids);
    await startTool(page, 'outline');
    const created = await applyAt(page, sketchId, [10, width]);
    // Two caps and two rounded corners, all of the requested width. The inside
    // of each corner meets at the crossing of the offset curves, so the count
    // of the pieces around the ring depends on the geometry.
    expect(roundArcs(created, width), `width ${width}`).toBeGreaterThanOrEqual(4);
  }

  // Shift asks for sharp corners: the caps and the joins become straight.
  await replaceEntities(page, sketchId, bent());
  await page.waitForTimeout(100);
  await select(page, ids);
  await startTool(page, 'outline');
  const sharp = await applyAt(page, sketchId, [10, 6], { shift: true });
  expect(roundArcs(sharp, 6)).toBe(0);
  expect(sharp.every((entity) => entity.type === 'line')).toBe(true);
});

test('builds a contour wider than the radius of its own arc', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, tangentChain());
  await page.waitForTimeout(300);
  await select(page, ['a', 'b', 'arc']);
  await startTool(page, 'outline');
  const target = await screenPoint(page, sketchId, [44.6, 21.8]);
  await page.mouse.move(target.x, target.y);
  await page.waitForTimeout(250);
  const label = await page.getByTestId('sketch-live-measure').innerText();
  const width = Number(/([0-9]+[.,][0-9]+)/.exec(label)?.[1]?.replace(',', '.') ?? 0);
  // The arc is 8.6 wide; a wider stroke has no inner side of its own there, so
  // the arc is swallowed and the lines meet across it instead of failing.
  expect(width).toBeGreaterThan(9);
  await page.mouse.click(target.x, target.y);
  await expect
    .poll(async () => (await feature(page, sketchId)).entities.length, { timeout: 15_000 })
    .toBeGreaterThan(3);
  await page.waitForTimeout(200);
  const created = (await feature(page, sketchId)).entities.slice(3);
  expect(created.length).toBeGreaterThanOrEqual(7);
  expect(roundArcs(created, width)).toBeGreaterThanOrEqual(2);
  await expect(page.locator('.toast-error')).toHaveCount(0);
});

test('lands the contour with joint constraints and driving dimensions', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, tangentChain());
  await page.waitForTimeout(300);
  await select(page, ['a', 'b', 'arc']);
  await startTool(page, 'outline');
  const created = await applyAt(page, sketchId, [40, 30]);
  const constraints = (await feature(page, sketchId)).constraints.map(
    (constraint) => constraint.type,
  );
  // Eight joints of the ring, plus the two that keep the offset arcs concentric
  // with their source. The contour has to be held together, not just drawn.
  expect(constraints.filter((type) => type === 'coincident')).toHaveLength(10);
  // A joint carries no tangency: the coincidences and the pieces' own dimensions
  // already hold the angle, and a repeated relation makes the solver spend
  // seconds and paint geometry that still moves as fully constrained.
  expect(constraints.filter((type) => type === 'tangent')).toHaveLength(0);
  expect(created.length).toBeGreaterThanOrEqual(8);
  expect(constraints.some((type) => type === 'distance')).toBe(true);
  expect(constraints.some((type) => type === 'diameter')).toBe(true);
});

test('creates the contour without a wait', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, tangentChain());
  await page.waitForTimeout(300);
  await select(page, ['a', 'b', 'arc']);
  await startTool(page, 'outline');

  const target = await screenPoint(page, sketchId, [40, 34]);
  await page.mouse.move(target.x, target.y);
  await page.waitForTimeout(200);
  // The probe runs in the page, so the measurement is the time the app itself
  // takes from the click to the committed geometry, not a round trip.
  await page.evaluate(async (id) => {
    const url = (name: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((entry) => entry.includes(name));
    const doc = await import(
      url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts'
    );
    const find = (project: {
      superObjects: Array<{ id: string; features: Array<{ id: string; entities: unknown[] }> }>;
      activeSuperObjectId: string;
    }) =>
      project.superObjects
        .find((candidate) => candidate.id === project.activeSuperObjectId)
        ?.features.find((candidate) => candidate.id === id);
    const probe = { click: 0, ready: 0 };
    (window as unknown as { __offsetProbe: typeof probe }).__offsetProbe = probe;
    window.addEventListener(
      'pointerdown',
      () => {
        probe.click = performance.now();
      },
      { capture: true, once: true },
    );
    const baseline = find(doc.useDocumentStore.getState().project)?.entities.length ?? 0;
    const stop = doc.useDocumentStore.subscribe((next: { project: never }) => {
      const count = find(next.project)?.entities.length ?? 0;
      if (count > baseline && !probe.ready) {
        probe.ready = performance.now();
        stop();
      }
    });
  }, sketchId);
  await page.mouse.click(target.x, target.y);
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            (window as unknown as { __offsetProbe: { ready: number } }).__offsetProbe.ready,
        ),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
  const timing = await page.evaluate(() => {
    const probe = (window as unknown as { __offsetProbe: { click: number; ready: number } })
      .__offsetProbe;
    return probe.ready - probe.click;
  });
  expect(timing).toBeGreaterThan(0);
  // The commit is one plain solve of the generated set. Asking the solver which
  // constraints are implied costs a hundred milliseconds and more, so it is not
  // done here: the contour has to land under the click.
  expect(timing).toBeLessThan(600);
});
