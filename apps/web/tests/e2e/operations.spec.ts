import { expect, test, type Page } from '@playwright/test';

async function waitForWorkspace(page: Page) {
  await expect(page.getByTestId('app-skeleton')).toHaveCount(0, { timeout: 120_000 });
  await expect(page.getByTestId('viewport-skeleton')).toHaveCount(0, { timeout: 120_000 });
}

async function openApp(page: Page) {
  // Keep both docks on screen: these tests drive the model, not the shell.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('icancad.pinnedPanels', 'true');
    } catch {
      // Storage can be unavailable in private mode.
    }
  });
  await page.goto('/');
  await waitForWorkspace(page);
}

/** The tool rail and the timeline both use operation names, so scope tools. */
function toolRail(page: Page) {
  return page.getByRole('navigation', { name: 'Tools' });
}

const PREVIEW_MARKS =
  '.tree-row.preview-added, .tree-row.preview-modified, .tree-row.preview-removed';

async function editingFeatureId(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const doc = await import(url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts');
    return doc.useDocumentStore.getState().editingFeatureId as string | null;
  });
}


/** Wait until the final rebuild after leaving an operation has published. */
async function waitForKernelIdle(page: Page) {
  // A rebuild is scheduled by a short debounce; give it time to claim the
  // queue before reading an idle state that is only a gap.
  await page.waitForTimeout(250);
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const url = (suffix: string) =>
            performance
              .getEntriesByType('resource')
              .map((entry) => entry.name)
              .find((name) => name.includes(suffix));
          const kernel = await import(
            url('/src/stores/kernelStore.ts') ?? '/src/stores/kernelStore.ts'
          );
          const state = kernel.useKernelStore.getState();
          return state.interactiveReady && !state.tasks.some((task: { key: string | null }) => task.key === 'rebuild');
        }),
      { timeout: 120_000 },
    )
    .toBe(true);
}

async function commitOperation(page: Page) {
  const markers = page.locator(PREVIEW_MARKS);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if ((await editingFeatureId(page)) === null && (await markers.count()) === 0) {
      await waitForKernelIdle(page);
      return;
    }
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  expect(await editingFeatureId(page)).toBeNull();
  await expect(markers).toHaveCount(0);
  await waitForKernelIdle(page);
}

async function addBox(page: Page) {
  await toolRail(page).getByRole('button', { name: 'Primitives' }).click();
  await page.getByRole('menuitem', { name: 'Cube' }).click();
  await expect(
    page.getByTestId('inspector').getByRole('textbox', { name: 'Width (X) · mm' }),
  ).toHaveValue('20');
  await commitOperation(page);
}

interface BodyInfo {
  id: string;
  createdBy: string;
  name?: string;
  bbox?: { min: [number, number, number]; max: [number, number, number] };
}

async function bodyInfos(page: Page): Promise<BodyInfo[]> {
  return page.evaluate(async () => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const doc = await import(url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts');
    const kernel = await import(url('/src/stores/kernelStore.ts') ?? '/src/stores/kernelStore.ts');
    const state = doc.useDocumentStore.getState();
    const model = state.project.superObjects.find(
      (superObject: { id: string }) => superObject.id === state.project.activeSuperObjectId,
    )!;
    const meshes = kernel.useKernelStore.getState().meshes;
    return model.bodies.map((body: { id: string; createdBy: string }) => {
      const metadata = model.metadata[body.id];
      return {
        id: body.id,
        createdBy: body.createdBy,
        ...(metadata?.name ? { name: metadata.name } : {}),
        ...(meshes[body.id] ? { bbox: meshes[body.id].bbox } : {}),
      };
    });
  });
}

async function faceCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const kernel = await import(url('/src/stores/kernelStore.ts') ?? '/src/stores/kernelStore.ts');
    const mesh = Object.values(kernel.useKernelStore.getState().meshes)[0] as
      { faceIds?: Uint32Array } | undefined;
    return mesh?.faceIds?.length ?? 0;
  });
}

/** A closed rectangle in the sketch plane, for a revolve profile. */
async function addRectangleSketch(page: Page) {
  await page.evaluate(async () => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const doc = await import(url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts');
    const store = doc.useDocumentStore.getState();
    const sketchId = store.addSketch('Sketch', 'XZ');
    const state = doc.useDocumentStore.getState();
    const model = state.project.superObjects.find(
      (superObject: { id: string }) => superObject.id === state.project.activeSuperObjectId,
    )!;
    const sketch = model.features.find(
      (feature: { id: string }) => feature.id === sketchId,
    ) as unknown as Record<string, unknown>;
    state.apply({
      type: 'feature/replace',
      feature: {
        ...sketch,
        entities: [
          { id: 'edge-1', type: 'line', construction: false, x1: 5, y1: -2, x2: 15, y2: -2 },
          { id: 'edge-2', type: 'line', construction: false, x1: 15, y1: -2, x2: 15, y2: 2 },
          { id: 'edge-3', type: 'line', construction: false, x1: 15, y1: 2, x2: 5, y2: 2 },
          { id: 'edge-4', type: 'line', construction: false, x1: 5, y1: 2, x2: 5, y2: -2 },
        ],
        constraints: [],
      } as never,
    });
    state.endFeatureEdit();
  });
  await expect(page.locator('.tree-row').filter({ hasText: 'Sketch' })).toHaveCount(1);
}

test.describe('modeling operations', () => {
  test('steps a numeric field with the wheel and shows every step', async ({ page }) => {
  await openApp(page);
  await toolRail(page).getByRole('button', { name: 'Primitives' }).click();
  await page.getByRole('menuitem', { name: 'Cube' }).click();

  const input = page
    .getByTestId('inspector')
    .getByRole('textbox', { name: 'Width (X) · mm' });
  await expect(input).toHaveValue('20');
  await input.click();
  const box = await input.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);

  // One notch of the mouse wheel steps the typed precision. The field has to
  // show the value it committed, and the next notch starts from there.
  await page.mouse.wheel(0, -100);
  await expect(input).toHaveValue('21');
  await page.mouse.wheel(0, -100);
  await expect(input).toHaveValue('22');
  await page.mouse.wheel(0, 100);
  await expect(input).toHaveValue('21');
});

test('repeats a body in a straight array', async ({ page }) => {
    await openApp(page);
    await addBox(page);

    const rows = page.locator('.tree-row');
    await expect(rows).toHaveCount(1);
    await rows.first().locator('.tree-main').click();
    await toolRail(page).getByRole('button', { name: 'Array' }).click();

    const inspector = page.getByTestId('inspector');
    await expect(inspector.getByText('Repeat', { exact: true })).toBeVisible();
    await expect(inspector.locator('.selection-item')).toContainText('Cube');
    await expect(inspector.getByRole('textbox', { name: 'Quantity' })).toHaveValue('3');
    const step = inspector.getByRole('textbox', { name: 'Step' });
    await expect(step).toHaveValue('10');
    await step.fill('25');
    await step.press('Enter');
    await commitOperation(page);

    await expect(page.locator('.timeline-op[aria-label="Array"]')).toHaveCount(1);
    await expect.poll(async () => (await bodyInfos(page)).length).toBe(3);
    await expect(rows).toHaveCount(3);

    const bodies = await bodyInfos(page);
    const mins = bodies.map((body) => body.bbox!.min[0]).sort((left, right) => left - right);
    expect(mins[1]! - mins[0]!).toBeCloseTo(25, 1);
    expect(mins[2]! - mins[1]!).toBeCloseTo(25, 1);
  });

  test('hollows a body into a shell', async ({ page }) => {
    await openApp(page);
    await addBox(page);

    const rows = page.locator('.tree-row');
    await rows.first().locator('.tree-main').click();
    await toolRail(page).getByRole('button', { name: 'Shell' }).click();

    const inspector = page.getByTestId('inspector');
    await expect(inspector.getByRole('button', { name: 'Cavity' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const thickness = inspector.getByRole('textbox', { name: 'Wall thickness' });
    await expect(thickness).toHaveValue('2');
    await thickness.fill('1');
    await thickness.press('Enter');
    await commitOperation(page);

    await expect(page.locator('.timeline-op[aria-label="Shell"]')).toHaveCount(1);
    await expect.poll(async () => (await bodyInfos(page)).length).toBe(1);
    // The outer box is untouched; the cavity adds walls inside it.
    const [body] = await bodyInfos(page);
    expect(body!.bbox).toEqual({ min: [0, 0, 0], max: [20, 20, 20] });
    await expect.poll(() => faceCount(page)).toBeGreaterThan(6);
    await expect(rows).toHaveCount(1);
  });

  test('revolves a profile around a world axis', async ({ page }) => {
    await openApp(page);
    await addRectangleSketch(page);

    await page
      .locator('.tree-row')
      .filter({ hasText: 'Sketch' })
      .first()
      .locator('.tree-main')
      .click();
    await toolRail(page).getByRole('button', { name: 'Extrude', exact: true }).click();

    const inspector = page.getByTestId('inspector');
    await inspector.getByRole('button', { name: 'Revolve' }).click();
    await expect(inspector.getByRole('textbox', { name: 'Start angle' })).toHaveValue('0');
    await expect(inspector.getByRole('textbox', { name: 'End angle' })).toHaveValue('360');
    await expect(
      inspector.getByRole('group', { name: 'Revolve axis' }).getByRole('button', { name: 'Z' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await commitOperation(page);

    await expect.poll(async () => (await bodyInfos(page)).length).toBe(1);
    const [body] = await bodyInfos(page);
    const bbox = body!.bbox!;
    // The profile sits 5..15 mm from Z, so a full turn reaches both sides and
    // keeps the profile height.
    expect(bbox.min[0]).toBeLessThan(-10);
    expect(bbox.max[0]).toBeGreaterThan(10);
    expect(bbox.max[2] - bbox.min[2]).toBeCloseTo(4, 1);
  });
});
