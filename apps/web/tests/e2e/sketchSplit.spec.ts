import { expect, test, type Page } from '@playwright/test';

/**
 * The split tool, end to end: the pointer picks the place, the curve becomes two
 * pieces that meet at a new point, and the tool stays on for the next point.
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
      state.apply({ type: 'feature/replace', feature: { ...feature, entities: next, constraints: joins } });
    },
    { id: sketchId, next: entities, joins: constraints },
  );
}

async function startTool(page: Page, tool: 'split') {
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
      performance.getEntriesByType('resource')
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
          r?: number;
          cx?: number;
          cy?: number;
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

const line = (id: string, x1: number, y1: number, x2: number, y2: number) => ({
  id,
  type: 'line',
  construction: false,
  x1,
  y1,
  x2,
  y2,
});

const spans = (entities: Array<{ type: string; x1?: number; x2?: number }>) =>
  entities
    .filter((entity) => entity.type === 'line')
    .map((entity) => [entity.x1, entity.x2])
    .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));

test('splits a curve where the pointer stands and joins the pieces', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, [line('a', 0, 0, 40, 0)]);
  await page.waitForTimeout(300);
  await startTool(page, 'split');
  await expect(page.locator('.sketch-hint')).toBeVisible();

  const target = await screenPoint(page, sketchId, [15, 0]);
  await page.mouse.move(target.x, target.y);
  await page.waitForTimeout(250);
  await page.mouse.click(target.x, target.y);
  await expect
    .poll(async () => (await feature(page, sketchId)).entities.length, { timeout: 15_000 })
    .toBe(2);

  const { entities, constraints } = await feature(page, sketchId);
  // The point lands where the pointer stood, to within the pixel a screen click
  // can resolve; the ends of the curve are untouched.
  const pieces = spans(entities);
  expect(pieces).toHaveLength(2);
  expect(pieces[0]?.[0]).toBeCloseTo(0, 6);
  expect(pieces[1]?.[1]).toBeCloseTo(40, 6);
  expect(pieces[0]?.[1]).toBeCloseTo(15, 0);
  expect(pieces[1]?.[0]).toBeCloseTo(pieces[0]?.[1] ?? -1, 9);
  // The first piece keeps the curve's id, and the two are joined at the point.
  expect(entities.some((entity) => entity.id === 'a')).toBe(true);
  expect(constraints.filter((constraint) => constraint.type === 'coincident')).toHaveLength(1);
  await expect(page.locator('.toast-error')).toHaveCount(0);
});

test('stays on, so a line can be divided again and again', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, [line('a', 0, 0, 40, 0)]);
  await page.waitForTimeout(300);
  await startTool(page, 'split');

  const first = await screenPoint(page, sketchId, [10, 0]);
  await page.mouse.move(first.x, first.y);
  await page.waitForTimeout(250);
  await page.mouse.click(first.x, first.y);
  await expect
    .poll(async () => (await feature(page, sketchId)).entities.length, { timeout: 15_000 })
    .toBe(2);

  const tool = await page.evaluate(async () => {
    const url = (name: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((entry) => entry.includes(name));
    const ui = await import(url('/src/stores/uiStore.ts') ?? '/src/stores/uiStore.ts');
    return ui.useUiStore.getState().sketchTool;
  });
  expect(tool).toBe('split');

  const second = await screenPoint(page, sketchId, [30, 0]);
  await page.mouse.move(second.x, second.y);
  await page.waitForTimeout(250);
  await page.mouse.click(second.x, second.y);
  await expect
    .poll(async () => (await feature(page, sketchId)).entities.length, { timeout: 15_000 })
    .toBe(3);
  const { entities } = await feature(page, sketchId);
  expect(spans(entities)).toHaveLength(3);
});

test('refuses a point on an end of the curve', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, [line('a', 0, 0, 40, 0)]);
  await page.waitForTimeout(300);
  await startTool(page, 'split');

  const end = await screenPoint(page, sketchId, [0.05, 0]);
  await page.mouse.move(end.x, end.y);
  await page.waitForTimeout(250);
  await page.mouse.click(end.x, end.y);
  await expect(page.locator('.toast-error').first()).toBeVisible({ timeout: 15_000 });

  const { entities } = await feature(page, sketchId);
  expect(entities).toHaveLength(1);
});

test('splits an arc into two arcs that stay one arc', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  // A quarter arc tangent to a line at its start, the way a profile holds one.
  await replaceEntities(
    page,
    sketchId,
    [
      {
        id: 'arc',
        type: 'arc',
        construction: false,
        cx: 0,
        cy: 10,
        r: 10,
        startAngle: -Math.PI / 2,
        endAngle: 0,
      },
      line('tail', 0, 0, -15, 0),
    ],
    [
      {
        id: 'joint',
        type: 'coincident',
        refs: [
          { entityId: 'arc', pointIndex: 1 },
          { entityId: 'tail', pointIndex: 0 },
        ],
      },
      {
        id: 'touch',
        type: 'tangent',
        refs: [{ entityId: 'tail' }, { entityId: 'arc' }],
      },
    ],
  );
  await page.waitForTimeout(300);
  await startTool(page, 'split');

  // The middle of the arc: 45° round from its start.
  // The arc runs from (0, 0) round to (10, 10), so its middle stands at -45°.
  const middle = await screenPoint(page, sketchId, [
    10 * Math.cos(-Math.PI / 4),
    10 + 10 * Math.sin(-Math.PI / 4),
  ]);
  await page.mouse.move(middle.x, middle.y);
  await page.waitForTimeout(250);
  await page.mouse.click(middle.x, middle.y);
  await expect
    .poll(async () => (await feature(page, sketchId)).entities.filter((e) => e.type === 'arc').length, {
      timeout: 15_000,
    })
    .toBe(2);

  // The joint names the pieces' own ends: an arc's points are its centre, then
  // its start and its end, so the new point is index 2 of one and 1 of other.
  const { constraints } = await feature(page, sketchId);
  const [first, second] = (await feature(page, sketchId)).entities.filter((e) => e.type === 'arc');
  const joint = constraints.find(
    (constraint) =>
      constraint.type === 'coincident' &&
      constraint.refs.some((ref) => ref.entityId === first?.id) &&
      constraint.refs.some((ref) => ref.entityId === second?.id),
  )!;
  expect(joint).toBeTruthy();
  const indices = joint.refs
    .filter((ref) => ref.entityId === first?.id || ref.entityId === second?.id)
    .map((ref) => ref.pointIndex)
    .sort();
  expect(indices).toEqual([1, 2]);

  // The pieces are held on one circle: the same centre and the same radius.
  const types = constraints.map((constraint) => constraint.type);
  expect(types.filter((type) => type === 'equal')).toHaveLength(1);
  const centres = constraints.filter(
    (constraint) =>
      constraint.type === 'coincident' &&
      constraint.refs.length === 2 &&
      constraint.refs.every((ref) => ref.pointIndex === 0),
  );
  expect(centres).toHaveLength(1);

  // Dragging the far end of the tail moves the arc, and the two pieces stay one
  // arc instead of collapsing.
  await startTool(page, 'split');
  await page.evaluate(async () => {
    const url = (name: string) =>
      performance.getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((entry) => entry.includes(name));
    const ui = await import(url('/src/stores/uiStore.ts') ?? '/src/stores/uiStore.ts');
    ui.useUiStore.getState().setSketchTool('select');
  });
  const tail = await screenPoint(page, sketchId, [-15, 0]);
  await page.mouse.move(tail.x, tail.y);
  await page.waitForTimeout(200);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(tail.x, tail.y + step * 3);
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await page.waitForTimeout(800);

  const arcs = (await feature(page, sketchId)).entities.filter((entity) => entity.type === 'arc');
  expect(arcs).toHaveLength(2);
  for (const arc of arcs) expect(arc.r!).toBeGreaterThan(2);
  // One circle, not two that happen to meet: the same centre and radius.
  const [a, b] = arcs;
  expect(Math.abs((a?.r ?? 0) - (b?.r ?? 0))).toBeLessThan(1e-6);
  expect(Math.abs((a?.cx ?? 0) - (b?.cx ?? 0))).toBeLessThan(1e-6);
  expect(Math.abs((a?.cy ?? 0) - (b?.cy ?? 0))).toBeLessThan(1e-6);
});

test('splits a construction curve only while Shift is held', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, [
    line('a', 0, 0, 40, 0),
    { ...line('helper', 0, 10, 40, 10), construction: true },
  ]);
  await page.waitForTimeout(300);
  await startTool(page, 'split');

  // Without Shift the helper is not part of the picture: the solid line is the
  // one nearest the pointer.
  const nearHelper = await screenPoint(page, sketchId, [20, 9]);
  await page.mouse.move(nearHelper.x, nearHelper.y);
  await page.waitForTimeout(250);
  await page.mouse.click(nearHelper.x, nearHelper.y);
  await expect
    .poll(async () => (await feature(page, sketchId)).entities.length, { timeout: 15_000 })
    .toBe(3);

  // With Shift the pointer splits the helper itself.
  await page.keyboard.down('Shift');
  const onHelper = await screenPoint(page, sketchId, [30, 10]);
  await page.mouse.move(onHelper.x, onHelper.y);
  await page.waitForTimeout(250);
  await page.mouse.click(onHelper.x, onHelper.y);
  await page.keyboard.up('Shift');
  await expect
    .poll(async () => (await feature(page, sketchId)).entities.length, { timeout: 15_000 })
    .toBe(4);
  // The helper itself is in two at x = 30, and its flag is kept.
  const helpers = (await feature(page, sketchId)).entities.filter(
    (entity) => entity.type === 'line' && entity.construction,
  );
  const helperPieces = spans(helpers);
  expect(helperPieces).toHaveLength(2);
  expect(helperPieces[0]?.[0]).toBeCloseTo(0, 6);
  expect(helperPieces[1]?.[1]).toBeCloseTo(40, 6);
  expect(helperPieces[0]?.[1]).toBeCloseTo(30, 0);
  expect(helperPieces[1]?.[0]).toBeCloseTo(helperPieces[0]?.[1] ?? -1, 9);
});
