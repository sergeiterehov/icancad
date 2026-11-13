import { expect, test, type Page } from '@playwright/test';

async function waitForWorkspace(page: Page) {
  await expect(page.getByTestId('app-skeleton')).toHaveCount(0, { timeout: 120_000 });
  await expect(page.getByTestId('viewport-skeleton')).toHaveCount(0, { timeout: 120_000 });
}

async function openApp(page: Page) {
  await page.goto('/');
  await waitForWorkspace(page);
}

const PREVIEW_MARKS =
  '.tree-row.preview-added, .tree-row.preview-modified, .tree-row.preview-removed';

async function commitOperation(page: Page) {
  const markers = page.locator(PREVIEW_MARKS);
  const canvas = page.getByTestId('viewport-canvas');
  const box = await canvas.boundingBox();
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await page.mouse.click(box!.x + 12, box!.y + 12);
    await page.waitForTimeout(200);
    if ((await markers.count()) === 0) return;
  }
  await expect(markers).toHaveCount(0);
}

async function addBox(page: Page) {
  await page.getByRole('button', { name: 'Add object' }).click();
  await page.getByRole('menuitem', { name: 'Box' }).click();
  await expect(page.getByText('20 × 20 × 20 mm')).toBeVisible();
  await commitOperation(page);
}

function inspectorTitle(page: Page) {
  return page.getByTestId('inspector').locator('.panel-header > span').first();
}

interface HandleScreen {
  id: string;
  originX: number;
  originY: number;
  tipX: number;
  tipY: number;
  value: number;
}

async function handleScreens(page: Page): Promise<HandleScreen[]> {
  return page.evaluate(async () => {
    const loaded = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => name.includes('/src/viewport/handle.ts'));
    const module = await import(loaded ?? '/src/viewport/handle.ts');
    return (module.getViewport()?.getHandles?.() ?? []) as HandleScreen[];
  });
}

async function dragHandle(
  page: Page,
  direction: number,
  pixels: number,
  index = 0,
  kind: 'extrude' | 'treatment' = 'extrude',
) {
  // A face offers both operations, so the id tells the arrows apart.
  const handles = (await handleScreens(page)).filter((handle) =>
    kind === 'treatment'
      ? handle.id.startsWith('edge-treatment:')
      : !handle.id.startsWith('edge-treatment:'),
  );
  const handle = handles[index];
  expect(handle).toBeTruthy();
  const dx = handle!.tipX - handle!.originX;
  const dy = handle!.tipY - handle!.originY;
  const length = Math.hypot(dx, dy) || 1;
  const ux = (dx / length) * direction;
  const uy = (dy / length) * direction;
  await page.mouse.move(handle!.tipX, handle!.tipY);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(
      handle!.tipX + (ux * pixels * step) / 8,
      handle!.tipY + (uy * pixels * step) / 8,
    );
    await page.waitForTimeout(35);
  }
  await page.mouse.up();
}

interface GhostInfo {
  id: string;
  color: string;
  bbox: { min: [number, number, number]; max: [number, number, number] };
}

async function ghostScreens(page: Page): Promise<GhostInfo[]> {
  return page.evaluate(async () => {
    const loaded = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => name.includes('/src/viewport/handle.ts'));
    const module = await import(loaded ?? '/src/viewport/handle.ts');
    return (module.getViewport()?.getGhosts?.() ?? []) as GhostInfo[];
  });
}

interface BodyInfo {
  id: string;
  createdBy: string;
  name?: string;
  color?: string;
  bbox?: { min: [number, number, number]; max: [number, number, number] };
}

async function bodyInfos(page: Page): Promise<BodyInfo[]> {
  return page.evaluate(async () => {
    const url = (s: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(s));
    const doc = await import(url('/src/stores/documentStore.ts')!);
    const kernel = await import(url('/src/stores/kernelStore.ts')!);
    const store = doc.useDocumentStore.getState();
    const meshes = kernel.useKernelStore.getState().meshes;
    return store.project.bodies.map((body: { id: string; createdBy: string }) => {
      const metadata = store.project.metadata[body.id];
      return {
        id: body.id,
        createdBy: body.createdBy,
        ...(metadata?.name ? { name: metadata.name } : {}),
        ...(metadata?.color ? { color: metadata.color } : {}),
        ...(meshes[body.id] ? { bbox: meshes[body.id].bbox } : {}),
      };
    });
  });
}

function boxVolume(bbox: { min: [number, number, number]; max: [number, number, number] }) {
  return (
    (bbox.max[0] - bbox.min[0]) *
    (bbox.max[1] - bbox.min[1]) *
    (bbox.max[2] - bbox.min[2])
  );
}

test.describe('quick operations', () => {
  test('drills into a face and creates a focused extrude', async ({ page }) => {
    await openApp(page);
    await addBox(page);

    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();
    const centerX = box!.x + box!.width / 2;
    const centerY = box!.y + box!.height / 2;

    // First click selects the object, the next one opens its face.
    await page.mouse.click(centerX, centerY);
    await expect(inspectorTitle(page)).toHaveText('Body');
    // The drill-down click must not be read as the second half of a double click.
    await page.waitForTimeout(420);
    await page.mouse.click(centerX + 60, centerY + 40);
    await expect(page.getByText('Quick operation')).toBeVisible();

    // A face offers the extrusion arrow and the edge treatment arrow on its
    // first rim edge (ADR 0015). Handles are withheld while the model
    // recalculates, so wait for them instead of reading one frame.
    await expect
      .poll(async () => (await handleScreens(page)).length, { timeout: 15_000 })
      .toBe(2);
    const faceHandles = await handleScreens(page);
    expect(
      faceHandles.filter((handle) => !handle.id.startsWith('edge-treatment:')),
    ).toHaveLength(1);
    expect(
      faceHandles.filter((handle) => handle.id.startsWith('edge-treatment:')),
    ).toHaveLength(1);
    await dragHandle(page, 1, 60);
    await expect(page.locator('.timeline-op')).toHaveCount(2);
    await expect(page.locator('.timeline-op.selected')).toHaveCount(1);
    await expect(inspectorTitle(page)).toHaveText('Extrusion');

    const distance = page
      .getByTestId('inspector')
      .getByRole('textbox', { name: 'Distance' });
    const firstDistance = await distance.inputValue();
    expect(Number(firstDistance)).toBeGreaterThan(0);

    // The focused operation owns the handle, and its tooltip says what it edits.
    const focused = (await handleScreens(page)).find(
      (handle) => !handle.id.startsWith('edge-treatment:'),
    );
    expect(focused?.id).toMatch(/^extrude:feat_/);
    await page.mouse.move(
      (focused!.tipX + focused!.originX) / 2,
      (focused!.tipY + focused!.originY) / 2,
    );
    await expect(page.getByTestId('handle-tooltip')).toContainText('Extrude distance');

    // A join keeps the base body as it is and only tints the added material.
    const ghosts = await ghostScreens(page);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]!.color).toBe('#22c55e');
    const [base] = await bodyInfos(page);
    expect(boxVolume(ghosts[0]!.bbox)).toBeLessThan(boxVolume(base!.bbox!) * 0.5);

    // Dragging back past the anchor keeps the method and flips the direction.
    await dragHandle(page, -1, 110);
    await expect(page.locator('.timeline-op')).toHaveCount(2);
    await expect(
      page.getByTestId('inspector').getByRole('button', { name: 'Add', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    const secondDistance = await distance.inputValue();
    expect(Number(secondDistance)).not.toBe(Number(firstDistance));
  });

  test('offers a handle per direction and hides the through-all one', async ({ page }) => {
    await openApp(page);
    await addBox(page);

    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();
    const centerX = box!.x + box!.width / 2;
    const centerY = box!.y + box!.height / 2;
    await page.mouse.click(centerX, centerY);
    await expect(inspectorTitle(page)).toHaveText('Body');
    await page.waitForTimeout(420);
    await page.mouse.click(centerX + 60, centerY + 40);
    await expect(page.getByText('Quick operation')).toBeVisible();
    await dragHandle(page, 1, 60);
    await expect(inspectorTitle(page)).toHaveText('Extrusion');

    const inspector = page.getByTestId('inspector');
    const distances = inspector.getByRole('textbox', { name: 'Distance' });
    const primaryDistance = await distances.first().inputValue();

    // The second direction gets its own handle, opposite the primary one.
    await inspector.getByRole('switch', { name: 'Second direction' }).click();
    const arrows = async () =>
      (await handleScreens(page)).filter((handle) => !handle.id.startsWith('edge-treatment:'));
    await expect.poll(async () => (await arrows()).length).toBe(2);
    const [primary, second] = await arrows();
    expect(second!.originX).toBeCloseTo(primary!.originX);
    expect(second!.originY).toBeCloseTo(primary!.originY);
    const secondBefore = second!.value;
    await dragHandle(page, 1, 50, 1);
    const after = await arrows();
    expect(after).toHaveLength(2);
    expect(after[0]!.value).toBeCloseTo(primary!.value);
    expect(after[1]!.value).toBeGreaterThan(secondBefore);
    await expect
      .poll(async () => Number(await distances.first().inputValue()))
      .toBeCloseTo(Number(primaryDistance));
    await expect
      .poll(async () => Number(await distances.nth(1).inputValue()))
      .toBeGreaterThan(secondBefore);

    // A through-all extent has no free distance, so its handle disappears.
    await inspector.getByRole('button', { name: 'Cut', exact: true }).click();
    await inspector.getByRole('button', { name: 'Through all' }).first().click();
    await expect.poll(async () => (await arrows()).length).toBe(1);
    await inspector.getByRole('switch', { name: 'Second direction' }).click();
    // Both directions have no free distance, so the focused operation offers
    // no handle at all; the edge treatment track belongs to the face, which is
    // not selected while the operation is.
    await expect.poll(async () => (await handleScreens(page)).length).toBe(0);
  });

  test('splits a body when a through cut separates it', async ({ page }) => {
    await openApp(page);
    await addBox(page);
    const before = await bodyInfos(page);
    expect(before).toHaveLength(1);

    const tools = page.getByRole('navigation', { name: 'Tools' });
    const inspector = page.getByTestId('inspector');
    const canvas = page.getByTestId('viewport-canvas');
    const view = await canvas.boundingBox();

    // Sketch a thin band across the top face.
    await tools.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Select face' }).click();
    await page.mouse.click(
      view!.x + view!.width / 2,
      view!.y + view!.height / 2 - 60,
    );
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await page.waitForTimeout(800);

    await page.getByRole('button', { name: 'Line', exact: true }).click();
    const originX = view!.x + view!.width / 2;
    const originY = view!.y + view!.height / 2;
    const corners: Array<[number, number]> = [
      [originX - 250, originY - 30],
      [originX + 250, originY - 30],
      [originX + 250, originY + 30],
      [originX - 250, originY + 30],
    ];
    for (let index = 0; index < corners.length; index += 1) {
      const start = corners[index]!;
      const end = corners[(index + 1) % corners.length]!;
      await page.mouse.click(start[0], start[1]);
      await page.waitForTimeout(320);
      await page.mouse.click(end[0], end[1]);
      await page.waitForTimeout(320);
    }
    await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
    await expect(page.locator('.sketch-overlay')).toHaveCount(0);

    // Cut the band through the body, into the material.
    await page
      .locator('.tree-row')
      .filter({ hasText: 'Sketch' })
      .first()
      .locator('.tree-main')
      .click();
    await tools.getByRole('button', { name: 'Extrude', exact: true }).click();
    await inspector.getByRole('button', { name: 'Cut', exact: true }).click();
    await inspector.getByRole('button', { name: 'Through all', exact: true }).first().click();
    await inspector.getByRole('button', { name: 'Reverse direction' }).click();
    await commitOperation(page);

    const after = await bodyInfos(page);
    expect(after).toHaveLength(2);
    const original = after.find((body) => body.id === before[0]!.id);
    // The largest part keeps the original body and its look.
    expect(original?.name).toBe(before[0]!.name);
    expect(original?.color).toBe(before[0]!.color);
    const created = after.find((body) => body.id !== before[0]!.id);
    expect(created?.name).toBeTruthy();
    expect(created?.createdBy).not.toBe(original?.createdBy);

    // The parts are independent: their boxes do not touch on any axis.
    const [first, second] = after;
    const separated = [0, 1, 2].some(
      (axis) =>
        first!.bbox!.max[axis]! < second!.bbox!.min[axis]! - 1e-6 ||
        second!.bbox!.max[axis]! < first!.bbox!.min[axis]! - 1e-6,
    );
    expect(separated).toBe(true);

    // Turning the cut away from the material joins the body back together and
    // the independent body disappears with it.
    await page
      .getByTestId('timeline')
      .getByRole('button', { name: 'Extrude', exact: true })
      .click();
    await inspector.getByRole('button', { name: 'Reverse direction' }).click();
    await commitOperation(page);
    expect(await bodyInfos(page)).toHaveLength(1);
  });

  test('selects an edge and offers the edge treatment arrow instead', async ({ page }) => {
    await openApp(page);
    await addBox(page);

    // Select a real B-rep edge of the body; the drill-down resolver that turns a
    // 6 px click into this selection is covered by the unit tests.
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const url = (s: string) =>
            performance
              .getEntriesByType('resource')
              .map((entry) => entry.name)
              .find((name) => name.includes(s));
          const kernel = await import(url('/src/stores/kernelStore.ts')!);
          const state = kernel.useKernelStore.getState();
          const body = Object.values(state.meshes)[0] as { edges?: unknown[] } | undefined;
          return body?.edges?.length ?? 0;
        }),
      )
      .toBeGreaterThan(0);

    await page.evaluate(async () => {
      const url = (s: string) =>
        performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .find((name) => name.includes(s));
      const doc = await import(url('/src/stores/documentStore.ts')!);
      const kernel = await import(url('/src/stores/kernelStore.ts')!);
      const selection = await import(url('/src/stores/selection.ts')!);
      const store = doc.useDocumentStore.getState();
      const body = store.project.bodies[0]!;
      const edge = kernel.useKernelStore.getState().meshes[body.id]!.edges![0]!;
      store.select({ kind: 'edge', id: selection.bodyEdgeId(body.id, edge.id) });
    });

    await expect(
      page.getByText('Drag the arrow to chamfer these edges, hold Shift to round them.'),
    ).toBeVisible();
    // An edge offers the edge treatment arrow, never an extrude arrow.
    const handles = await handleScreens(page);
    expect(handles).toHaveLength(1);
    expect(handles[0]?.id.startsWith('edge-treatment:')).toBe(true);
  });

  test('offers a handle for a selected sketch only while it is visible', async ({ page }) => {
    await openApp(page);
    const tools = page.getByRole('navigation', { name: 'Tools' });
    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();

    await tools.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Line', exact: true }).click();
    const corners: [number, number][] = [
      [300, 250],
      [520, 250],
      [520, 420],
      [300, 420],
    ];
    for (let index = 0; index < corners.length; index += 1) {
      const start = corners[index]!;
      const end = corners[(index + 1) % corners.length]!;
      await page.mouse.click(box!.x + start[0], box!.y + start[1]);
      await page.waitForTimeout(320);
      await page.mouse.click(box!.x + end[0], box!.y + end[1]);
      await page.waitForTimeout(320);
    }
    await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
    await expect(page.locator('.sketch-overlay')).toHaveCount(0);

    const row = page.locator('.tree-row').first();
    await row.locator('.tree-main').click();
    await expect.poll(async () => (await handleScreens(page)).length).toBe(1);
    expect((await handleScreens(page))[0]?.id).toMatch(/^extrude:new:/);

    // A hidden sketch is not drawn, so an arrow over it would hang in the air.
    await row.getByRole('button', { name: 'Hide' }).click();
    await row.locator('.tree-main').click();
    await expect.poll(async () => (await handleScreens(page)).length).toBe(0);

    await row.getByRole('button', { name: 'Show' }).click();
    await row.locator('.tree-main').click();
    await expect.poll(async () => (await handleScreens(page)).length).toBe(1);
  });
});
