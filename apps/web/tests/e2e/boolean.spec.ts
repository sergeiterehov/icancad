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

function inspectorTitle(page: Page) {
  return page.getByTestId('inspector').locator('.panel-header > span').first();
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

/** Body refs in creation order; a consumed body keeps its ref in the document. */
async function bodyIds(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const doc = await import(url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts');
    const state = doc.useDocumentStore.getState();
    const model = state.project.superObjects.find(
      (superObject: { id: string }) => superObject.id === state.project.activeSuperObjectId,
    ) as { bodies: Array<{ id: string }> };
    return model.bodies.map((body) => body.id);
  });
}

interface GhostScreen {
  id: string;
  color: string;
  bbox: { min: [number, number, number]; max: [number, number, number] };
}

async function ghostScreens(page: Page): Promise<GhostScreen[]> {
  return page.evaluate(async () => {
    const loaded = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => name.includes('/src/viewport/handle.ts'));
    const module = await import(loaded ?? '/src/viewport/handle.ts');
    return (module.getViewport()?.getGhosts?.() ?? []) as GhostScreen[];
  });
}

function treeRows(page: Page) {
  return page.getByTestId('left').locator('.tree-row');
}

test.describe('boolean operations', () => {
  test('unions into the first body and consumes the tool', async ({ page }) => {
    await openApp(page);
    await addBox(page);
    await addBox(page, 10);

    await expect(treeRows(page)).toHaveCount(2);
    const targets = await bodyIds(page);
    const rail = page.getByRole('navigation', { name: 'Tools' });
    await rail.getByRole('button', { name: 'Boolean' }).click();
    await expect(inspectorTitle(page)).toHaveText(/boolean/i);
    // Subtraction is the default operation.
    await expect(page.getByRole('button', { name: 'Subtract' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Union' }).click();
    await expect(page.getByRole('button', { name: 'Union' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // The first list picks bodies from the tree; it opens with the tool.
    await treeRows(page).nth(0).click();
    const inspector = page.getByTestId('inspector');
    const toolsSection = inspector.locator('.panel-section').filter({ hasText: 'Tools' });
    await toolsSection.getByRole('button', { name: 'Pick tools' }).click();
    await treeRows(page).nth(1).click();

    // The preview changes the target and marks the tool as removed. The added
    // material is a green delta over the unchanged target.
    await expect(page.locator('.tree-row.preview-modified')).toHaveCount(1);
    await expect(page.locator('.tree-row.preview-removed')).toHaveCount(1);
    await expect.poll(async () => (await ghostScreens(page)).length, { timeout: 15_000 }).toBe(1);
    const [added] = await ghostScreens(page);
    expect(added!.color).toBe('#22c55e');
    // 0…20 is the target; the second cube adds 20…30.
    expect(added!.bbox.min[0]).toBeCloseTo(20, 3);
    expect(added!.bbox.max[0]).toBeCloseTo(30, 3);
    await commitOperation(page);

    // The first body takes the result, so its identity, name and colour stay;
    // the tool leaves the model.
    await expect(treeRows(page)).toHaveCount(1);
    await expect(page.locator('.timeline-op')).toHaveCount(3);
    const [united] = await bodyScreens(page);
    expect(united!.id).toBe(targets[0]);
    // Cubes are anchored at their corner: 0…20 plus 10…30.
    expect(united!.bbox.min[0]).toBeCloseTo(0, 3);
    expect(united!.bbox.max[0]).toBeCloseTo(30, 3);

    // Opening the finished operation shows its delta at once, without any
    // parameter being touched: the cached snapshot has no ghost in it.
    await page
      .getByTestId('timeline')
      .getByRole('button', { name: 'Boolean', exact: true })
      .click();
    await expect(inspectorTitle(page)).toHaveText(/boolean/i);
    await expect.poll(async () => (await ghostScreens(page)).length, { timeout: 15_000 }).toBe(1);
    expect((await ghostScreens(page))[0]!.color).toBe('#22c55e');
  });

  test('subtracts the second list from the first', async ({ page }) => {
    await openApp(page);
    await addBox(page);
    await addBox(page, 10);

    await page
      .getByRole('navigation', { name: 'Tools' })
      .getByRole('button', { name: 'Boolean' })
      .click();
    const inspector = page.getByTestId('inspector');
    await inspector.getByRole('button', { name: 'Subtract' }).click();
    await treeRows(page).nth(0).click();
    const toolsSection = inspector.locator('.panel-section').filter({ hasText: 'Tools' });
    await toolsSection.getByRole('button', { name: 'Pick tools' }).click();
    await treeRows(page).nth(1).click();
    const targets = await bodyIds(page);
    // The removed material is a red delta over the target: 10…20 is cut away,
    // and 0…10 stays.
    await expect.poll(async () => (await ghostScreens(page)).length, { timeout: 15_000 }).toBe(1);
    const [removed] = await ghostScreens(page);
    expect(removed!.color).toBe('#ef4444');
    expect(removed!.bbox.min[0]).toBeCloseTo(10, 3);
    expect(removed!.bbox.max[0]).toBeCloseTo(20, 3);
    await commitOperation(page);

    await expect(treeRows(page)).toHaveCount(1);
    const [cut] = await bodyScreens(page);
    expect(cut!.id).toBe(targets[0]);
    // 0…20 minus 10…30 leaves 0…10.
    expect(cut!.bbox.min[0]).toBeCloseTo(0, 3);
    expect(cut!.bbox.max[0]).toBeCloseTo(10, 3);
  });

  test('starts from the selection: first body first, the rest second', async ({ page }) => {
    await openApp(page);
    await addBox(page);
    await addBox(page, 10);

    // A range keeps the tree order: the first row opens the first list and the
    // second row joins the second one.
    await treeRows(page).nth(0).click();
    await treeRows(page)
      .nth(1)
      .click({ modifiers: ['Shift'] });
    await page
      .getByRole('navigation', { name: 'Tools' })
      .getByRole('button', { name: 'Boolean' })
      .click();

    const created = await page.evaluate(async () => {
      const url = (suffix: string) =>
        performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .find((name) => name.includes(suffix));
      const doc = await import(
        url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts'
      );
      const ui = await import(url('/src/stores/uiStore.ts') ?? '/src/stores/uiStore.ts');
      const state = doc.useDocumentStore.getState();
      const model = state.project.superObjects.find(
        (superObject: { id: string }) => superObject.id === state.project.activeSuperObjectId,
      ) as {
        bodies: Array<{ id: string }>;
        features: Array<{ type: string; bodyIds?: string[]; toolIds?: string[] }>;
      };
      const feature = model.features.find((candidate) => candidate.type === 'boolean')!;
      const uiState = ui.useUiStore.getState();
      return {
        bodies: model.bodies.map((body) => body.id),
        bodyIds: feature.bodyIds ?? [],
        toolIds: feature.toolIds ?? [],
        picking: Boolean(uiState.pickingBooleanBodies || uiState.pickingBooleanTools),
      };
    });

    expect(created.bodyIds).toEqual([created.bodies[0]!]);
    expect(created.toolIds).toEqual([created.bodies[1]!]);
    // Both lists already hold a body, so no picker is left open.
    expect(created.picking).toBe(false);
    await commitOperation(page);
    const [united] = await bodyScreens(page);
    expect(united!.id).toBe(created.bodies[0]);
  });

  test('shows the material an intersection removes', async ({ page }) => {
    await openApp(page);
    await addBox(page);
    await addBox(page, 10);

    await page
      .getByRole('navigation', { name: 'Tools' })
      .getByRole('button', { name: 'Boolean' })
      .click();
    const inspector = page.getByTestId('inspector');
    await inspector.getByRole('button', { name: 'Intersect' }).click();
    await treeRows(page).nth(0).click();
    const toolsSection = inspector.locator('.panel-section').filter({ hasText: 'Tools' });
    await toolsSection.getByRole('button', { name: 'Pick tools' }).click();
    await treeRows(page).nth(1).click();

    // The common part is 10…20; the target's remaining 0…10 is removed and
    // drawn in red.
    await expect.poll(async () => (await ghostScreens(page)).length, { timeout: 15_000 }).toBe(1);
    const [removed] = await ghostScreens(page);
    expect(removed!.color).toBe('#ef4444');
    expect(removed!.bbox.min[0]).toBeCloseTo(0, 3);
    expect(removed!.bbox.max[0]).toBeCloseTo(10, 3);
    // Consumed bodies are not drawn at all, and the removed volume is twice as
    // faint as the default delta.
    const faint = await page.evaluate(async () => {
      const url = (suffix: string) =>
        performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .find((name) => name.includes(suffix));
      const kernel = await import(
        url('/src/stores/kernelStore.ts') ?? '/src/stores/kernelStore.ts'
      );
      const preview = kernel.useKernelStore.getState().preview;
      return {
        removed: (preview?.bodies ?? [])
          .filter((body: { kind: string }) => body.kind === 'removed')
          .map((body: { hidden?: boolean }) => body.hidden),
        ghosts: (preview?.ghosts ?? []).map((ghost: { color: string; opacity?: number }) => ({
          color: ghost.color,
          opacity: ghost.opacity,
        })),
      };
    });
    expect(faint.removed).toEqual([true]);
    expect(faint.ghosts).toEqual([{ color: '#ef4444', opacity: 0.2 }]);
    await commitOperation(page);

    await expect(treeRows(page)).toHaveCount(1);
    const [common] = await bodyScreens(page);
    expect(common!.bbox.min[0]).toBeCloseTo(10, 3);
    expect(common!.bbox.max[0]).toBeCloseTo(20, 3);
  });

  test('reports an empty intersection and keeps its inputs', async ({ page }) => {
    await openApp(page);
    await addBox(page);
    await addBox(page, 100);

    await page
      .getByRole('navigation', { name: 'Tools' })
      .getByRole('button', { name: 'Boolean' })
      .click();
    const inspector = page.getByTestId('inspector');
    await inspector.getByRole('button', { name: 'Intersect' }).click();
    await treeRows(page).nth(0).click();
    const toolsSection = inspector.locator('.panel-section').filter({ hasText: 'Tools' });
    await toolsSection.getByRole('button', { name: 'Pick tools' }).click();
    await treeRows(page).nth(1).click();
    await commitOperation(page);

    // Nothing is left, so the operation fails — but it did not consume the
    // bodies it could not combine.
    await expect(treeRows(page)).toHaveCount(2);
    await expect(page.locator('.timeline-op.error')).toHaveCount(1);
    await page
      .getByTestId('timeline')
      .getByRole('button', { name: 'Boolean', exact: true })
      .click();
    await expect(inspector).toContainText('leaves nothing');
  });

  test('Keep brings the source bodies back', async ({ page }) => {
    await openApp(page);
    await addBox(page);
    await addBox(page, 10);

    const rail = page.getByRole('navigation', { name: 'Tools' });
    await rail.getByRole('button', { name: 'Boolean' }).click();
    await treeRows(page).nth(0).click();
    const inspector = page.getByTestId('inspector');
    const toolsSection = inspector.locator('.panel-section').filter({ hasText: 'Tools' });
    await toolsSection.getByRole('button', { name: 'Pick tools' }).click();
    await treeRows(page).nth(1).click();
    await commitOperation(page);
    await expect(treeRows(page)).toHaveCount(1);

    // Both headers carry the switch, off by default; turn both on.
    await page
      .getByTestId('timeline')
      .getByRole('button', { name: 'Boolean', exact: true })
      .click();
    await expect(inspectorTitle(page)).toHaveText(/boolean/i);
    const keep = inspector.getByRole('switch', { name: 'Keep' });
    await expect(keep).toHaveCount(2);
    await expect(keep.first()).toHaveAttribute('aria-checked', 'false');
    await keep.nth(0).click();
    await keep.nth(1).click();
    // The kept originals stay and only the operation's delta is drawn, not the
    // copies the operation will create.
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const loaded = performance
              .getEntriesByType('resource')
              .map((entry) => entry.name)
              .find((name) => name.includes('/src/stores/kernelStore.ts'));
            const kernel = await import(loaded ?? '/src/stores/kernelStore.ts');
            return (kernel.useKernelStore.getState().preview?.bodies ?? []).filter(
              (body: { ghostOnly?: boolean }) => body.ghostOnly,
            ).length;
          }),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
    await commitOperation(page);

    // Two originals plus the copy the operation changed.
    await expect(treeRows(page)).toHaveCount(3);
    const ids = (await bodyScreens(page)).map((body) => body.id);
    expect(ids).toHaveLength(3);
    expect(ids).toContain((await bodyIds(page))[0]);
    expect(ids).toContain((await bodyIds(page))[1]);
  });
});
