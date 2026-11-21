import { expect, test, type Page } from '@playwright/test';

async function waitForWorkspace(page: Page) {
  await expect(page.getByTestId('app-skeleton')).toHaveCount(0, { timeout: 120_000 });
  await expect(page.getByTestId('viewport-skeleton')).toHaveCount(0, { timeout: 120_000 });
}

async function openApp(page: Page) {
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

async function waitForKernelIdle(page: Page) {
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
          return (
            state.interactiveReady &&
            !state.tasks.some((task: { key: string | null }) => task.key === 'rebuild')
          );
        }),
      { timeout: 120_000 },
    )
    .toBe(true);
}

async function commitOperation(page: Page) {
  const markers = page.locator(PREVIEW_MARKS);
  for (let attempt = 0; attempt < 8; attempt += 1) {
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

async function addBox(page: Page, x = 0) {
  await page
    .getByRole('navigation', { name: 'Tools' })
    .getByRole('button', { name: 'Primitives' })
    .click();
  await page.getByRole('menuitem', { name: 'Cube' }).click();
  const inspector = page.getByTestId('inspector');
  await expect(inspector.getByRole('textbox', { name: 'Width (X) · mm' })).toHaveValue('20');
  if (x !== 0) {
    const positionX = inspector.getByRole('textbox', { name: 'Position X · mm' });
    await positionX.fill(String(x));
    await positionX.press('Enter');
  }
  await commitOperation(page);
}

/** An empty sketch is discarded when it is left, so a line keeps it alive. */
async function drawLine(page: Page) {
  const canvas = page.getByTestId('viewport-canvas');
  const box = await canvas.boundingBox();
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await page.mouse.click(box!.x + 360, box!.y + 320);
  await page.waitForTimeout(320);
  await page.mouse.click(box!.x + 530, box!.y + 320);
  await page.waitForTimeout(320);
}

function inspectorTitle(page: Page) {
  return page.getByTestId('inspector').locator('.panel-header > span').first();
}

function treeRows(page: Page) {
  return page.getByTestId('left').locator('.tree-row');
}

interface BodyScreen {
  id: string;
  bbox: { min: [number, number, number]; max: [number, number, number] };
}

async function bodyScreens(page: Page): Promise<BodyScreen[]> {
  return page.evaluate(async () => {
    const loaded = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => name.includes('/src/stores/kernelStore.ts'));
    const kernel = await import(loaded ?? '/src/stores/kernelStore.ts');
    return Object.entries(
      kernel.useKernelStore.getState().meshes as Record<string, { bbox: BodyScreen['bbox'] }>,
    ).map(([id, mesh]) => ({ id, bbox: mesh.bbox }));
  });
}

async function sketchData(page: Page): Promise<{
  frames: Record<string, { origin: number[] }>;
  overrides: Record<string, Array<{ type: string; x1?: number }>>;
  authored: Array<{ type: string; x1?: number }>;
}> {
  return page.evaluate(async () => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const kernel = await import(url('/src/stores/kernelStore.ts') ?? '/src/stores/kernelStore.ts');
    const doc = await import(url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts');
    const state = kernel.useKernelStore.getState();
    const project = doc.useDocumentStore.getState().project;
    const model = project.superObjects.find(
      (superObject: { id: string }) => superObject.id === project.activeSuperObjectId,
    ) as { features: Array<{ type: string; entities?: Array<{ type: string; x1?: number }> }> };
    const sketch = model.features.find((feature) => feature.type === 'sketch');
    return {
      frames: state.sketchFrames as Record<string, { origin: number[] }>,
      overrides: state.sketchOverrides as Record<string, Array<{ type: string; x1?: number }>>,
      authored: (sketch?.entities ?? []) as Array<{ type: string; x1?: number }>,
    };
  });
}

async function sketchFrames(page: Page): Promise<Record<string, { origin: number[] }>> {
  return page.evaluate(async () => {
    const loaded = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => name.includes('/src/stores/kernelStore.ts'));
    const kernel = await import(loaded ?? '/src/stores/kernelStore.ts');
    return kernel.useKernelStore.getState().sketchFrames as Record<string, { origin: number[] }>;
  });
}

async function handleIds(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const loaded = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => name.includes('/src/viewport/handle.ts'));
    const module = await import(loaded ?? '/src/viewport/handle.ts');
    return ((module.getViewport()?.getHandles?.() ?? []) as Array<{ id: string }>).map(
      (handle) => handle.id,
    );
  });
}

function transformField(page: Page, label: string) {
  return page.getByTestId('inspector').getByRole('textbox', { name: label });
}

/** The operation is offered by the objects themselves, not by the tool rail. */
async function startTransform(page: Page, row = 0) {
  await treeRows(page).nth(row).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Transform', exact: true }).click();
}

async function setField(page: Page, label: string, value: string) {
  const field = transformField(page, label);
  await field.fill(value);
  await field.press('Enter');
}

test.describe('transform operations', () => {
  test('moves a body by its position', async ({ page }) => {
    await openApp(page);
    await addBox(page);

    const [before] = await bodyScreens(page);
    expect(before!.bbox.min[0]).toBeCloseTo(0, 3);
    expect(before!.bbox.max[0]).toBeCloseTo(20, 3);

    await startTransform(page);
    await expect(inspectorTitle(page)).toHaveText(/transform/i);
    // The picked body is what the operation moves, so it opens configured.
    await expect(
      page.getByTestId('inspector').locator('.panel-section').filter({ hasText: 'Objects' }),
    ).toContainText(/body|cube|box/i);
    // The operation offers its handles where the rebuild measured its pivot.
    await expect.poll(async () => (await handleIds(page)).length, { timeout: 30_000 }).toBe(8);
    expect((await handleIds(page)).filter((id) => id.includes(':rotate:'))).toHaveLength(3);

    await setField(page, 'Position X · mm', '30');
    // The body is drawn where the operation puts it, without being committed.
    await expect
      .poll(async () => (await bodyScreens(page))[0]?.bbox.min[0] ?? 0, { timeout: 30_000 })
      .toBeCloseTo(30, 3);
    await commitOperation(page);

    const [after] = await bodyScreens(page);
    expect(after!.id).toBe(before!.id);
    expect(after!.bbox.min[0]).toBeCloseTo(30, 3);
    expect(after!.bbox.max[0]).toBeCloseTo(50, 3);
    // The movement is an operation of its own in the history.
    await expect(page.locator('.timeline-op')).toHaveCount(2);

    // Editing it again is idempotent: the body starts from its own shape.
    await page
      .getByTestId('timeline')
      .getByRole('button', { name: 'Transform', exact: true })
      .click();
    await setField(page, 'Position X · mm', '40');
    await commitOperation(page);
    const [edited] = await bodyScreens(page);
    expect(edited!.bbox.min[0]).toBeCloseTo(40, 3);
    expect(edited!.bbox.max[0]).toBeCloseTo(60, 3);
  });

  test('turns and scales a body around its own centre', async ({ page }) => {
    await openApp(page);
    await addBox(page);
    await startTransform(page);

    await setField(page, 'Rotation around Z', '90');
    await setField(page, 'Scale', '200');
    await commitOperation(page);

    // The cube is anchored at a corner, so its centre is (10, 10, 10): a factor
    // of two around it spans −10…30 on every axis.
    const [body] = await bodyScreens(page);
    for (const axis of [0, 1, 2]) {
      expect(body!.bbox.min[axis]).toBeCloseTo(-10, 3);
      expect(body!.bbox.max[axis]).toBeCloseTo(30, 3);
    }
  });

  test('scales the whole selection around the centre of its box', async ({ page }) => {
    await openApp(page);
    await addBox(page);
    await addBox(page, 60);
    const bodyIds = (await bodyScreens(page)).map((body) => body.id);
    // Two objects are one selection, and it turns and scales as a whole.
    await page.evaluate(async (ids: string[]) => {
      const url = (suffix: string) =>
        performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .find((name) => name.includes(suffix));
      const doc = await import(
        url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts'
      );
      doc.useDocumentStore.getState().addTransform('Transform', { bodyIds: ids });
    }, bodyIds);
    await expect(inspectorTitle(page)).toHaveText(/transform/i);

    // Each cube spans 20 mm; the second one starts 60 mm along X.
    const spans = async () => {
      const rows = await bodyScreens(page);
      return rows
        .map(
          (row) =>
            [
              Math.round(row.bbox.min[0] * 10) / 10,
              Math.round(row.bbox.max[0] * 10) / 10,
            ] as const,
        )
        .sort((left, right) => left[0] - right[0]);
    };

    await setField(page, 'Scale', '200');
    await commitOperation(page);
    // Everything doubles around the middle of the pair, at x = 40.
    await expect.poll(spans, { timeout: 120_000 }).toEqual([
      [-40, 0],
      [80, 120],
    ]);
  });

  test('moves a sketch as its result', async ({ page }) => {
    await openApp(page);
    const tools = page.getByRole('navigation', { name: 'Tools' });
    await tools.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await page.waitForTimeout(700);
    await drawLine(page);
    await page.getByRole('button', { name: 'Finish sketch' }).click();
    await commitOperation(page);

    const sketchId = Object.keys(await sketchFrames(page))[0]!;
    expect((await sketchFrames(page))[sketchId]!.origin[2]).toBeCloseTo(0, 3);

    await startTransform(page);
    await expect(inspectorTitle(page)).toHaveText(/transform/i);
    await setField(page, 'Position Z · mm', '25');
    await commitOperation(page);

    // The drawing itself is untouched; the plane it lies on is what moved.
    await expect
      .poll(async () => (await sketchFrames(page))[sketchId]?.origin[2], { timeout: 30_000 })
      .toBeCloseTo(25, 3);

    // Scaling moves the drawing as the scene draws it, while the sketch keeps
    // the coordinates the user drew.
    const drawnBefore = (await sketchData(page)).authored[0]!.x1!;
    await page
      .getByTestId('timeline')
      .getByRole('button', { name: 'Transform', exact: true })
      .click();
    await setField(page, 'Scale', '200');
    await commitOperation(page);
    await expect
      .poll(async () => (await sketchData(page)).overrides[sketchId]?.[0]?.x1, {
        timeout: 30_000,
      })
      .toBeCloseTo(drawnBefore * 2, 3);
    expect((await sketchData(page)).authored[0]!.x1).toBeCloseTo(drawnBefore, 6);
  });
});
