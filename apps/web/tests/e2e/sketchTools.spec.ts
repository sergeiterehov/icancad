import { expect, test, type Page } from '@playwright/test';

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

/** Opens a sketch on the XY plane and returns its id. */
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
      ) as { features: Array<{ id: string; type: string }> };
      const feature = model.features.find(
        (candidate: { id: string; type: string }) =>
          candidate.id === id && candidate.type === 'sketch',
      );
      if (!feature) {
        throw new Error(
          `NO_FEATURE ${id} active=${state.project.activeSuperObjectId} models=${state.project.superObjects
            .map(
              (item: { id: string; features: unknown[] }) => `${item.id}[${item.features.length}]`,
            )
            .join(',')}`,
        );
      }
      state.apply({
        type: 'feature/replace',
        feature: { ...feature, entities: next, constraints: [] },
      });
    },
    { id: sketchId, next: entities },
  );
}

/** Replaces the sketch geometry and its reference values in one edit. */
async function replaceReferences(page: Page, sketchId: string, references: unknown[]) {
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
      ) as { features: Array<{ id: string; type: string; references: unknown[] }> };
      const feature = model.features.find(
        (candidate: { id: string; type: string }) =>
          candidate.id === id && candidate.type === 'sketch',
      );
      if (!feature) throw new Error('NO_FEATURE');
      state.apply({ type: 'feature/replace', feature: { ...feature, references: next } });
    },
    { id: sketchId, next: references },
  );
}

/** Sketch-plane coordinates of a page point. */
async function planePointAt(page: Page, x: number, y: number) {
  return page.evaluate(
    async ({ x: pageX, y: pageY }) => {
      const url = (name: string) =>
        performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .find((entry) => entry.includes(name));
      const handle = await import(url('/src/viewport/handle.ts') ?? '/src/viewport/handle.ts');
      return handle.getViewport()?.sketchPointAt(pageX, pageY) ?? null;
    },
    { x, y },
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
    ) as { features: Array<{ id: string; type: string; entities?: unknown[] }> };
    const feature = model.features.find((candidate) => candidate.id === id);
    return (feature?.entities ?? []) as Array<Record<string, number | string>>;
  }, sketchId);
}

async function constraints(page: Page, sketchId: string) {
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
    ) as { features: Array<{ id: string; type: string; constraints?: unknown[] }> };
    const feature = model.features.find((candidate) => candidate.id === id);
    return (feature?.constraints ?? []) as Array<{
      type: string;
      refs: Array<{ entityId: string; pointIndex?: number }>;
    }>;
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

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
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

test('selects with a window and a crossing box', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, [
    line('a', 0, 0, 10, 0),
    line('b', 0, 10, 10, 10),
    line('c', 40, 10, 50, 20),
    { id: 'dot', type: 'point', construction: false, x: 5, y: 5 },
  ]);
  await page.waitForTimeout(300);

  const from = await screenPoint(page, sketchId, [-5, -5]);
  const to = await screenPoint(page, sketchId, [15, 15]);
  await drag(page, from, to);
  expect((await selection(page)).sort()).toEqual(['a', 'b', 'dot']);

  // Right to left takes what it only touches.
  const crossingFrom = await screenPoint(page, sketchId, [5, -5]);
  const crossingTo = await screenPoint(page, sketchId, [-5, 5]);
  await drag(page, crossingFrom, crossingTo);
  expect(await selection(page)).toEqual(['a']);
  await expect(page.locator('.sketch-marquee')).toHaveCount(0);
});

test('takes the control point a window covers, not the whole curve', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, [line('a', 0, 0, 20, 0)]);
  await page.waitForTimeout(300);

  await drag(
    page,
    await screenPoint(page, sketchId, [18, -3]),
    await screenPoint(page, sketchId, [23, 3]),
  );
  expect(await selection(page)).toEqual(['a#1']);

  // A box that holds the whole line keeps the line and drops its ends.
  await drag(
    page,
    await screenPoint(page, sketchId, [-3, -3]),
    await screenPoint(page, sketchId, [23, 3]),
  );
  expect(await selection(page)).toEqual(['a']);
});

test('keeps reference values under the geometry and out of a drag', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, [line('a', -20, 0, 20, 0)]);
  await replaceReferences(page, sketchId, [{ id: 'ref', entityId: 'a', measure: 'length' }]);
  await page.waitForTimeout(600);

  const chip = page.locator('[data-testid^="sketch-reference-"]').first();
  const box = (await chip.boundingBox())!;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  // A chip over empty canvas takes the pointer and names itself in a tooltip.
  await page.mouse.move(center.x, center.y - 40);
  await page.mouse.move(center.x, center.y);
  await page.mouse.move(center.x + 2, center.y + 1);
  await expect(chip).toHaveAttribute('data-hit', 'true');
  await expect(page.getByRole('tooltip')).toHaveCount(1);

  // Geometry under a chip keeps the pointer: the curve is hovered instead. The
  // second line carries no value of its own, so moving it leaves the chip be.
  const plane = (await planePointAt(page, center.x, center.y))!;
  await replaceEntities(page, sketchId, [
    line('a', -20, 0, 20, 0),
    line('b', plane[0] - 20, plane[1], plane[0] + 20, plane[1]),
  ]);
  await replaceReferences(page, sketchId, [{ id: 'ref', entityId: 'a', measure: 'length' }]);
  await page.waitForTimeout(700);
  await page.mouse.move(center.x, center.y - 40);
  await page.mouse.move(center.x, center.y);
  await expect.poll(async () => (await chip.getAttribute('data-hit')) ?? 'gone').toBe('gone');

  // A press that starts on the canvas turns every chip transparent, so a drag
  // passing over a value keeps running.
  const from = await screenPoint(page, sketchId, [plane[0] - 15, plane[1] + 8]);
  const to = await screenPoint(page, sketchId, [plane[0] + 15, plane[1] - 8]);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await expect(page.locator('.sketch-annotations')).toHaveAttribute('data-transparent', 'true');
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.sketch-annotations')).not.toHaveAttribute('data-transparent', 'true');
});

test('turns the finish button green when the sketch is fully constrained', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, [line('a', -10, 0, 10, 0)]);
  await page.waitForTimeout(500);
  // A free line still has degrees of freedom.
  await expect(page.locator('.tool-rail-sketch .is-solved')).toHaveCount(0);

  // Pinning both ends leaves the sketch nothing to move.
  await page.evaluate(async (id) => {
    const url = (name: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((entry) => entry.includes(name));
    const doc = await import(url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts');
    const state = doc.useDocumentStore.getState();
    const model = state.project.superObjects.find(
      (candidate: { id: string }) => candidate.id === state.project.activeSuperObjectId,
    ) as { features: Array<{ id: string; type: string; constraints: unknown[] }> };
    const feature = model.features.find(
      (candidate: { id: string; type: string }) =>
        candidate.id === id && candidate.type === 'sketch',
    )!;
    state.apply({
      type: 'feature/replace',
      feature: {
        ...feature,
        constraints: [
          { id: 'f1', type: 'fix', refs: [{ entityId: 'a', pointIndex: 0 }], x: -10, y: 0 },
          { id: 'f2', type: 'fix', refs: [{ entityId: 'a', pointIndex: 1 }], x: 10, y: 0 },
        ],
      },
    });
  }, sketchId);
  await expect(page.locator('.tool-rail-sketch .is-solved')).toHaveCount(1);
});

test('anchors both ends of an arc that snap to an axis', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await page.getByRole('button', { name: 'Arc', exact: true }).click();

  for (const point of [
    [0, 18],
    [-14, 0.6],
    [15, -0.6],
  ] as Array<[number, number]>) {
    const at = await screenPoint(page, sketchId, point);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(250);
  }
  // The automatic relations are written once the solver answers, and on a busy
  // machine that answer arrives well after the last click, so the count is
  // waited for rather than slept through.
  const axisRelations = async () => {
    const arc = (await entities(page, sketchId)).find((entity) => entity.type === 'arc');
    if (!arc) return 0;
    return (await constraints(page, sketchId)).filter(
      (constraint) =>
        constraint.type === 'point-on-line' &&
        constraint.refs.some(
          (ref) => ref.entityId === arc.id && (ref.pointIndex === 1 || ref.pointIndex === 2),
        ) &&
        constraint.refs.some((ref) => ref.entityId === 'sketch:x-axis'),
    ).length;
  };
  // Both ends sit on the axis they snapped to, and each carries its own
  // constraint: a tangency would have let one of them slide away.
  await expect
    .poll(axisRelations, { message: 'both arc ends anchored to the axis', timeout: 15_000 })
    .toBe(2);

  const arc = (await entities(page, sketchId)).find((entity) => entity.type === 'arc')!;
  expect(arc).toBeDefined();
  const cx = Number(arc.cx);
  const cy = Number(arc.cy);
  const r = Number(arc.r);
  for (const angle of [Number(arc.startAngle), Number(arc.endAngle)]) {
    expect(Math.abs(cy + Math.sin(angle) * r)).toBeLessThan(0.05);
    expect(Math.abs(cx + Math.cos(angle) * r)).toBeGreaterThan(5);
  }
});

test('draws an ellipse from three points', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await page.getByTestId('sketch-tool-more-circle').click();
  await page.getByRole('menuitem', { name: 'Ellipse' }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const url = (name: string) =>
          performance
            .getEntriesByType('resource')
            .map((entry) => entry.name)
            .find((entry) => entry.includes(name));
        const ui = await import(url('/src/stores/uiStore.ts') ?? '/src/stores/uiStore.ts');
        return ui.useUiStore.getState().sketchTool as string;
      }),
    )
    .toBe('ellipse');

  // Centre, the end of the first half-axis, then the length of the other one.
  for (const point of [
    [10, 0],
    [20, 0],
    [10, 4],
  ] as Array<[number, number]>) {
    const screen = await screenPoint(page, sketchId, point);
    await page.mouse.click(screen.x, screen.y);
    await page.waitForTimeout(200);
  }
  await expect
    .poll(
      async () =>
        (await entities(page, sketchId)).filter((entity) => entity.type === 'ellipse').length,
    )
    .toBe(1);
  const ellipse = (await entities(page, sketchId)).find((entity) => entity.type === 'ellipse')!;
  expect(Number(ellipse.rx)).toBeCloseTo(10, 1);
  expect(Number(ellipse.ry)).toBeCloseTo(4, 1);
  expect(Number(ellipse.rotation)).toBeCloseTo(0, 1);
});

test('moves every selected entity and keeps the selection', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  await replaceEntities(page, sketchId, [line('a', 0, 0, 10, 0), line('b', 0, 10, 10, 10)]);
  await page.waitForTimeout(300);

  await drag(
    page,
    await screenPoint(page, sketchId, [-5, -5]),
    await screenPoint(page, sketchId, [15, 15]),
  );
  expect((await selection(page)).sort()).toEqual(['a', 'b']);

  const before = await entities(page, sketchId);
  const grab = await screenPoint(page, sketchId, [5, 0]);
  const target = await screenPoint(page, sketchId, [15, 0]);
  await drag(page, grab, target);
  await page.waitForTimeout(300);

  const after = await entities(page, sketchId);
  const first = after.find((entity) => entity.id === 'a')!;
  const second = after.find((entity) => entity.id === 'b')!;
  const beforeFirst = before.find((entity) => entity.id === 'a')!;
  const beforeSecond = before.find((entity) => entity.id === 'b')!;
  const deltaFirst = Number(first.x1) - Number(beforeFirst.x1);
  const deltaSecond = Number(second.x1) - Number(beforeSecond.x1);
  expect(deltaFirst).toBeGreaterThan(5);
  expect(deltaSecond).toBeCloseTo(deltaFirst, 1);
  expect(Number(first.y1)).toBeCloseTo(Number(beforeFirst.y1), 2);
  expect((await selection(page)).sort()).toEqual(['a', 'b']);
});

test('draws an elliptical arc from the arc menu', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);

  await page.getByTestId('sketch-tool-more-arc').click();
  await page.getByRole('menuitem', { name: 'Elliptical arc' }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const url = (name: string) =>
          performance
            .getEntriesByType('resource')
            .map((entry) => entry.name)
            .find((entry) => entry.includes(name));
        const ui = await import(url('/src/stores/uiStore.ts') ?? '/src/stores/uiStore.ts');
        return ui.useUiStore.getState().sketchTool as string;
      }),
    )
    .toBe('elliptical-arc');

  for (const point of [
    [30, 0],
    [40, 0],
    [30, 10],
    [40, 0],
    [30, 10],
  ] as Array<[number, number]>) {
    const screen = await screenPoint(page, sketchId, point);
    await page.mouse.click(screen.x, screen.y);
  }
  await expect
    .poll(
      async () =>
        (await entities(page, sketchId)).filter((entity) => entity.type === 'elliptical-arc')
          .length,
    )
    .toBe(1);
  const arc = (await entities(page, sketchId)).find((entity) => entity.type === 'elliptical-arc')!;
  expect(Number(arc.rx)).toBeCloseTo(10, 1);
  expect(Number(arc.ry)).toBeCloseTo(10, 1);
});

test('snaps the ends of an elliptical arc to geometry', async ({ page }) => {
  await openApp(page);
  const sketchId = await openSketch(page);
  // A line for the arc end to land on.
  await replaceEntities(page, sketchId, [line('edge', 16, 2, 24, 12)]);
  await page.waitForTimeout(400);

  await page.getByTestId('sketch-tool-more-arc').click();
  await page.getByRole('menuitem', { name: 'Elliptical arc' }).click();
  for (const point of [
    [-2, 2],
    [18, 2],
    [4, 9],
    [12, 5],
  ] as Array<[number, number]>) {
    const at = await screenPoint(page, sketchId, point);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(250);
  }
  // The end lands on the line, so a point-on-line constraint should follow it.
  // The click is a quarter of the way along, away from the midpoint the magnet
  // would otherwise name.
  const end = await screenPoint(page, sketchId, [18.1, 4.6]);
  await page.mouse.move(end.x, end.y);
  await page.waitForTimeout(300);
  await page.mouse.click(end.x, end.y);

  // The end lands on the line, so a point-on-line constraint should follow it.
  // The click is a quarter of the way along, away from the midpoint the magnet
  // would otherwise name.
  const endRelations = async () => {
    const arc = (await entities(page, sketchId)).find((entity) => entity.type === 'elliptical-arc');
    if (!arc) return 0;
    return (await constraints(page, sketchId)).filter(
      (constraint) =>
        constraint.type === 'point-on-line' &&
        constraint.refs.some((ref) => ref.entityId === arc.id && ref.pointIndex === 4) &&
        constraint.refs.some((ref) => ref.entityId === 'edge'),
    ).length;
  };
  await expect
    .poll(endRelations, { message: 'the arc end anchored to the line', timeout: 15_000 })
    .toBe(1);
});

test('keeps the circle and arc variants behind their chevrons', async ({ page }) => {
  await openApp(page);
  await openSketch(page);
  await page.getByTestId('sketch-tool-more-circle').click();
  await expect(page.getByRole('menuitem', { name: 'Circle' })).toBeVisible();
  // Pressing the same trigger again only hides the list.
  await page.getByTestId('sketch-tool-more-circle').click();
  await expect(page.getByRole('menuitem', { name: 'Circle' })).toHaveCount(0);
  await page.getByTestId('sketch-tool-more-circle').click();
  await expect(page.getByRole('menuitem', { name: 'Circle' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Ellipse' }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const url = (name: string) =>
          performance
            .getEntriesByType('resource')
            .map((entry) => entry.name)
            .find((entry) => entry.includes(name));
        const ui = await import(url('/src/stores/uiStore.ts') ?? '/src/stores/uiStore.ts');
        return ui.useUiStore.getState().sketchTool as string;
      }),
    )
    .toBe('ellipse');
  // The main part keeps the variant it shows; the base tool is what an idle
  // group starts, which the next test covers.
  await page.getByTestId('sketch-tool-circle').click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const url = (name: string) =>
          performance
            .getEntriesByType('resource')
            .map((entry) => entry.name)
            .find((entry) => entry.includes(name));
        const ui = await import(url('/src/stores/uiStore.ts') ?? '/src/stores/uiStore.ts');
        return ui.useUiStore.getState().sketchTool as string;
      }),
    )
    .toBe('ellipse');
});

test('keeps the variant a tool group shows when the group is pressed', async ({ page }) => {
  await openApp(page);
  await openSketch(page);
  await page.getByTestId('sketch-tool-more-circle').click();
  await page.getByRole('menuitem', { name: 'Ellipse' }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const url = (name: string) =>
          performance
            .getEntriesByType('resource')
            .map((entry) => entry.name)
            .find((entry) => entry.includes(name));
        const ui = await import(url('/src/stores/uiStore.ts') ?? '/src/stores/uiStore.ts');
        return ui.useUiStore.getState().sketchTool as string;
      }),
    )
    .toBe('ellipse');

  // The button shows the ellipse, so pressing it keeps the ellipse: it only
  // starts the base tool while the group shows that base tool.
  await expect(page.getByTestId('sketch-tool-circle')).toHaveAttribute('aria-label', 'Ellipse');
  await page.getByTestId('sketch-tool-circle').click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const url = (name: string) =>
          performance
            .getEntriesByType('resource')
            .map((entry) => entry.name)
            .find((entry) => entry.includes(name));
        const ui = await import(url('/src/stores/uiStore.ts') ?? '/src/stores/uiStore.ts');
        return ui.useUiStore.getState().sketchTool as string;
      }),
    )
    .toBe('ellipse');

  // Another tool hands the group back to its base tool.
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await expect(page.getByTestId('sketch-tool-circle')).toHaveAttribute('aria-label', 'Circle');
  await page.getByTestId('sketch-tool-circle').click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const url = (name: string) =>
          performance
            .getEntriesByType('resource')
            .map((entry) => entry.name)
            .find((entry) => entry.includes(name));
        const ui = await import(url('/src/stores/uiStore.ts') ?? '/src/stores/uiStore.ts');
        return ui.useUiStore.getState().sketchTool as string;
      }),
    )
    .toBe('circle');
});

test('hides a main menu on a second press of its trigger', async ({ page }) => {
  await openApp(page);
  const trigger = page
    .getByRole('navigation', { name: 'Tools' })
    .getByRole('button', { name: 'Sketch', exact: true });
  await trigger.click();
  await expect(page.getByRole('menuitem', { name: 'XY plane' })).toBeVisible();
  await trigger.click();
  await expect(page.getByRole('menuitem', { name: 'XY plane' })).toHaveCount(0);
});
