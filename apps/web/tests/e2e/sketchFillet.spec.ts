import { expect, test, type Page } from '@playwright/test';

/**
 * Rounding a corner, end to end: the tool asks for two connected lines, the
 * pointer rides the arc it describes, and the committed corner shortens both
 * lines while a new arc takes their joint — with the relations that keep it a
 * corner under a drag.
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
      ) as { features: Array<{ id: string; type: string; entities: Array<{ id: string }> }> };
      const feature = model.features.find((candidate) => candidate.id === id);
      if (!feature) throw new Error('NO_FEATURE');
      state.apply({
        type: 'feature/replace',
        feature: { ...feature, entities: next, constraints: joins },
      });
    },
    { id: sketchId, next: entities, joins: constraints },
  );
}

/** What the solver makes of the sketch as it stands: no conflict, no redundancy. */
async function diagnose(page: Page, sketchId: string) {
  return page.evaluate(async (id) => {
    const url = (name: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((entry) => entry.includes(name));
    const doc = await import(url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts');
    const client = await import(url('/src/sketch/client.ts') ?? '/src/sketch/client.ts');
    const state = doc.useDocumentStore.getState();
    const model = state.project.superObjects.find(
      (candidate: { id: string }) => candidate.id === state.project.activeSuperObjectId,
    ) as {
      features: Array<{ id: string; entities: unknown[]; constraints: unknown[] }>;
    };
    const feature = model.features.find((candidate) => candidate.id === id)!;
    const solved = await client.solveSketch(feature.entities, feature.constraints, [], {
      diagnose: true,
    });
    return { conflicting: solved.conflicting, redundant: solved.redundant };
  }, sketchId);
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

async function startTool(page: Page, tool: 'offset' | 'outline' | 'fillet') {
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

type SketchEntity = {
  id: string;
  type: string;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  cx?: number;
  cy?: number;
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
        entities: SketchEntity[];
        constraints: Array<{ id: string; type: string }>;
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

const line = (id: string, x1: number, y1: number, x2: number, y2: number) => ({
  id,
  type: 'line',
  construction: false,
  x1,
  y1,
  x2,
  y2,
});

/** A right-angled corner at the origin, then a line that leaves it at 45°. */
const squareCorner = () => [line('a', -20, 0, 0, 0), line('b', 0, 0, 10, 10)];

/** A U: two right-angled corners, one at each end of the middle line. */
const chain = () => [line('a', -20, 0, 0, 0), line('b', 0, 0, 0, 20), line('c', 0, 20, -20, 20)];

/** The corner of `a` and `b`, where both of them meet. */
const CORNER: [number, number] = [0, 0];
/** The bisector of that corner: the pointer travels along it. */
const BISECTOR: [number, number] = [-0.38268343, 0.92387953];
const bisectorLength = Math.hypot(BISECTOR[0], BISECTOR[1]);
const along = (distance: number): [number, number] => [
  CORNER[0] + (BISECTOR[0] / bisectorLength) * distance,
  CORNER[1] + (BISECTOR[1] / bisectorLength) * distance,
];

const RADIUS = /([0-9]+[.,][0-9]+)/;

/** Rides the arc until the chip reads a radius in the range the test wants. */
async function rideToRadius(page: Page, sketchId: string, from: number, to: number) {
  for (const distance of [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.2, 1.5, 2]) {
    const target = await screenPoint(page, sketchId, along(distance));
    await page.mouse.move(target.x, target.y);
    await page.waitForTimeout(200);
    const chip = page.getByTestId('sketch-live-measure');
    if ((await chip.count()) === 0) continue;
    const radius = Number(RADIUS.exec(await chip.innerText())?.[1]?.replace(',', '.') ?? 0);
    if (radius >= from && radius <= to) return { radius, target };
  }
  throw new Error('NO_RADIUS');
}

test('starts only where the selection is a corner', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, [line('a', -20, 0, 0, 0)]);
  await page.waitForTimeout(300);

  // A line on its own has no corner at either of its ends.
  await select(page, ['a']);
  await page.waitForTimeout(200);
  await page.locator('.tool-rail-sketch').getByRole('button', { name: 'Tools' }).click();
  await expect(page.getByRole('menuitem', { name: 'Round corners' })).toBeDisabled();
});

test('starts from one segment that meets another at its end', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, squareCorner());
  await page.waitForTimeout(300);

  // Only one of the two lines is selected: the corner is still there, because
  // the line it is rounded with does not have to be in the selection.
  await select(page, ['a']);
  await page.waitForTimeout(200);
  const rail = page.locator('.tool-rail-sketch');
  await rail.getByRole('button', { name: 'Tools' }).click();
  await expect(page.getByRole('menuitem', { name: 'Round corners' })).toBeEnabled();
  await page.getByRole('menuitem', { name: 'Round corners' }).click();
  await expect(page.locator('.sketch-hint')).toBeVisible();
});

test('rounds the corner, shortening both lines and adding the arc', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, squareCorner());
  await page.waitForTimeout(300);
  await select(page, ['a', 'b']);
  await page.waitForTimeout(200);
  await startTool(page, 'fillet');

  // The pointer rides the middle of the arc, so its distance is the radius.
  const { radius, target } = await rideToRadius(page, sketchId, 4, 20);
  await page.mouse.click(target.x, target.y);
  await expect
    .poll(async () => (await feature(page, sketchId)).entities.filter((e) => e.type === 'arc').length, {
      timeout: 15_000,
    })
    .toBe(1);
  await page.waitForTimeout(300);

  const { entities, constraints } = await feature(page, sketchId);
  const arc = entities.find((entity) => entity.type === 'arc')!;
  // The corner of the fixture holds a radius in this range, and the arc the
  // click committed is one of them. Its exact value is a pixel of pointer
  // travel at this zoom — a shallow corner scales the pointer up by twelve —
  // so what the test pins is the geometry, not the chip: the arc is tangent to
  // both lines, and its tangent points are where the trim put them.
  expect(arc.r!).toBeGreaterThan(2);
  expect(arc.r!).toBeLessThan(radius * 2);
  const a = entities.find((entity) => entity.id === 'a')!;
  const b = entities.find((entity) => entity.id === 'b')!;
  const toLine = (entity: typeof a) => {
    const dx = entity.x2! - entity.x1!;
    const dy = entity.y2! - entity.y1!;
    return Math.abs((arc.cx! - entity.x1!) * dy - (arc.cy! - entity.y1!) * dx) / Math.hypot(dx, dy);
  };
  expect(Math.abs(toLine(a) - arc.r!)).toBeLessThan(0.01);
  expect(Math.abs(toLine(b) - arc.r!)).toBeLessThan(0.01);

  // The tangent points sit `R / tan(θ/2)` from the corner, and both lines are
  // shortened to them instead of being replaced: a fillet keeps its source.
  const trim = arc.r! / Math.tan((3 * Math.PI) / 8);
  const distanceTo = (x: number, y: number) => Math.hypot(x - CORNER[0], y - CORNER[1]);
  expect(distanceTo(a.x2!, a.y2!)).toBeCloseTo(trim, 0);
  expect(distanceTo(b.x1!, b.y1!)).toBeCloseTo(trim, 0);
  expect(distanceTo(a.x1!, a.y1!)).toBeCloseTo(20, 0);
  expect(distanceTo(b.x2!, b.y2!)).toBeCloseTo(14.14, 0);

  // Two joints hold the arc to the lines, its radius is a dimension, and the
  // angle keeps the corner: no tangency, which would repeat a relation the
  // joints and the radius already imply and starve the solver of rank.
  const types = constraints.map((constraint) => constraint.type);
  expect(types.filter((type) => type === 'coincident')).toHaveLength(2);
  expect(types.filter((type) => type === 'radius')).toHaveLength(1);
  expect(types.filter((type) => type === 'angle')).toHaveLength(1);
  expect(types.filter((type) => type === 'tangent')).toHaveLength(0);
  await expect(page.locator('.toast-error')).toHaveCount(0);
});

test('rounds both corners of one selected segment with the same radius', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, chain());
  await page.waitForTimeout(300);

  // One pick, on the middle line: both of its ends are corners to round.
  await select(page, ['b']);
  await page.waitForTimeout(200);
  await startTool(page, 'fillet');
  const { target } = await rideToRadius(page, sketchId, 3, 6);
  await page.mouse.click(target.x, target.y);
  await expect
    .poll(async () => (await feature(page, sketchId)).entities.filter((e) => e.type === 'arc').length, {
      timeout: 15_000,
    })
    .toBe(2);
  await page.waitForTimeout(300);

  const { entities, constraints } = await feature(page, sketchId);
  const arcs = entities.filter((entity) => entity.type === 'arc');
  expect(arcs).toHaveLength(2);
  // One pointer, one radius, and the middle line shortened at both of its ends.
  expect(Math.abs(arcs[0]!.r! - arcs[1]!.r!)).toBeLessThan(0.001);
  const middle = entities.find((entity) => entity.id === 'b')!;
  const trim = arcs[0]!.r! / Math.tan(Math.PI / 4);
  expect(middle.y1).toBeCloseTo(trim, 0);
  expect(middle.y2).toBeCloseTo(20 - trim, 0);

  const types = constraints.map((constraint) => constraint.type);
  expect(types.filter((type) => type === 'coincident')).toHaveLength(4);
  expect(types.filter((type) => type === 'radius')).toHaveLength(2);
  expect(types.filter((type) => type === 'angle')).toHaveLength(2);
  await expect(page.locator('.toast-error')).toHaveCount(0);
});

test('refuses a radius the corner cannot hold', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, squareCorner());
  await page.waitForTimeout(300);
  await select(page, ['a', 'b']);
  await page.waitForTimeout(200);
  await startTool(page, 'fillet');

  // Far enough along the bisector that the tangent points would run past the
  // end of the short line: there is no corner of that size to cut out.
  const target = await screenPoint(page, sketchId, along(6));
  await page.mouse.move(target.x, target.y);
  await page.waitForTimeout(250);
  await expect(page.getByTestId('sketch-live-measure')).toHaveCount(0);
  await page.mouse.click(target.x, target.y);
  await expect(page.locator('.toast-error').first()).toBeVisible({ timeout: 15_000 });

  const { entities, constraints } = await feature(page, sketchId);
  expect(entities.filter((entity) => entity.type === 'arc')).toHaveLength(0);
  expect(constraints).toHaveLength(0);
  const a = entities.find((entity) => entity.id === 'a')!;
  expect(a.x2).toBeCloseTo(0, 6);
});

test('takes the joint apart and leaves the rest of the profile alone', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  // A profile as a sketch really holds it: the corners are joints, and a line
  // away from the corner must stay exactly as long as it was.
  await replaceEntities(
    page,
    sketchId,
    [...chain(), line('keep', 40, 0, 60, 0)],
    [
      {
        id: 'joint1',
        auto: true,
        type: 'coincident',
        refs: [
          { entityId: 'a', pointIndex: 1 },
          { entityId: 'b', pointIndex: 0 },
        ],
      },
      {
        id: 'joint2',
        auto: true,
        type: 'coincident',
        refs: [
          { entityId: 'b', pointIndex: 1 },
          { entityId: 'c', pointIndex: 0 },
        ],
      },
    ],
  );
  await page.waitForTimeout(300);
  await select(page, ['b']);
  await page.waitForTimeout(200);
  await startTool(page, 'fillet');
  const { target } = await rideToRadius(page, sketchId, 3, 6);
  await page.mouse.click(target.x, target.y);
  await expect
    .poll(async () => (await feature(page, sketchId)).entities.filter((e) => e.type === 'arc').length, {
      timeout: 15_000,
    })
    .toBe(2);
  await page.waitForTimeout(400);

  const { entities, constraints } = await feature(page, sketchId);
  // The joints the corners were made of are gone, replaced by the fillets' own
  // joints: leaving them would say both tangent points of an arc are one point.
  expect(constraints.map((constraint) => constraint.id)).not.toContain('joint1');
  expect(constraints.map((constraint) => constraint.id)).not.toContain('joint2');
  const types = constraints.map((constraint) => constraint.type);
  expect(types.filter((type) => type === 'coincident')).toHaveLength(4);
  expect(types.filter((type) => type === 'radius')).toHaveLength(2);
  expect(types.filter((type) => type === 'angle')).toHaveLength(2);

  // A sketch the solver can hold: no conflict, nothing redundant, and the line
  // the fillet had nothing to do with is the same line.
  expect(await diagnose(page, sketchId)).toEqual({ conflicting: [], redundant: [] });
  const keep = entities.find((entity) => entity.id === 'keep')!;
  expect(Math.hypot(keep.x2! - keep.x1!, keep.y2! - keep.y1!)).toBeCloseTo(20, 6);
  await expect(page.locator('.toast-error')).toHaveCount(0);
});
