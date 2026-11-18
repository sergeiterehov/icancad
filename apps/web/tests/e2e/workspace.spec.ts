import { expect, test, type Page } from '@playwright/test';

async function waitForWorkspace(page: Page) {
  await expect(page.getByTestId('app-skeleton')).toHaveCount(0, { timeout: 120_000 });
  await expect(page.getByTestId('viewport-skeleton')).toHaveCount(0, { timeout: 120_000 });
}

/** The default shell: the docks start open, then tuck themselves away. */
async function openApp(page: Page) {
  await page.goto('/');
  await waitForWorkspace(page);
}

/** The modeling tests keep the docks on screen instead. */
async function openAppWithPinnedDocks(page: Page) {
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

async function commitOperation(page: Page) {
  const markers = page.locator(PREVIEW_MARKS);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if ((await editingFeatureId(page)) === null && (await markers.count()) === 0) return;
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  expect(await editingFeatureId(page)).toBeNull();
  await expect(markers).toHaveCount(0);
}

async function addBox(page: Page) {
  await toolRail(page).getByRole('button', { name: 'Primitives' }).click();
  await page.getByRole('menuitem', { name: 'Cube' }).click();
  await expect(
    page.getByTestId('inspector').getByRole('textbox', { name: 'Width (X) · mm' }),
  ).toHaveValue('20');
  await commitOperation(page);
}

async function activeModelInfo(page: Page) {
  return page.evaluate(async () => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const doc = await import(url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts');
    const state = doc.useDocumentStore.getState();
    const model = state.project.superObjects.find(
      (superObject: { id: string; name: string }) =>
        superObject.id === state.project.activeSuperObjectId,
    ) as { id: string; name: string; bodies: { id: string }[] };
    return { id: model.id, name: model.name, bodyIds: model.bodies.map((body) => body.id) };
  });
}

test.describe('workspace', () => {
  test('folds a run of operations into a folder', async ({ page }) => {
    await openAppWithPinnedDocks(page);
    await addBox(page);
    await addBox(page);

    const ops = page.locator('.timeline-op');
    await expect(ops).toHaveCount(2);
    await ops.nth(0).click();
    await ops.nth(1).click({ modifiers: ['Shift'] });
    await expect(page.locator('.timeline-op.selected')).toHaveCount(2);

    await ops.nth(1).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Group' }).click();
    const group = page.locator('.timeline-op.timeline-group');
    await expect(group).toHaveCount(1);
    await expect(ops).toHaveCount(1);

    // A second press opens the folder; the level names it and can rename it.
    await group.dblclick();
    await expect(page.locator('.timeline-level-name')).toHaveText('Group');
    await expect(ops).toHaveCount(2);
    await page.locator('.timeline-level-name').dblclick();
    const rename = page.locator('.timeline-level').getByRole('textbox', { name: 'Name' });
    await rename.fill('Base');
    await rename.press('Enter');
    await expect(page.locator('.timeline-level-name')).toHaveText('Base');

    await page.getByRole('button', { name: 'Leave the group' }).click();
    await expect(group).toHaveAttribute('aria-label', 'Base');
    await group.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Ungroup' }).click();
    await expect(page.locator('.timeline-op.timeline-group')).toHaveCount(0);
    await expect(ops).toHaveCount(2);
  });

  test('keeps each model apart and deletes one with confirmation', async ({ page }) => {
    await openAppWithPinnedDocks(page);
    await addBox(page);
    const firstModel = await activeModelInfo(page);

    const switcher = page.getByTestId('model-switcher');
    await switcher.getByRole('button', { name: 'Model', exact: true }).click();
    await switcher.getByRole('button', { name: 'Add' }).click();
    await page.getByRole('menuitem', { name: 'Model', exact: true }).click();
    const rename = switcher.getByRole('textbox', { name: 'Model name' });
    await rename.fill('Part B');
    await rename.press('Enter');
    await expect(page.locator('.tree-row')).toHaveCount(0);

    await addBox(page);
    const secondModel = await activeModelInfo(page);
    expect(secondModel.id).not.toBe(firstModel.id);
    expect(secondModel.bodyIds).not.toEqual(firstModel.bodyIds);

    const modelRows = switcher.locator('.model-row');
    await modelRows.filter({ hasText: 'Model' }).first().locator('.tree-main').click();
    await expect(page.locator('.tree-row')).toHaveCount(1);
    expect((await activeModelInfo(page)).id).toBe(firstModel.id);

    await modelRows.filter({ hasText: 'Part B' }).first().locator('.tree-main').click();
    await expect(page.locator('.tree-row')).toHaveCount(1);
    expect((await activeModelInfo(page)).id).toBe(secondModel.id);

    await modelRows.filter({ hasText: 'Part B' }).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete model' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete model?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete model' }).click();
    await expect(switcher.locator('.model-row')).toHaveCount(1);
    expect((await activeModelInfo(page)).id).toBe(firstModel.id);
    await expect(page.locator('.tree-row')).toHaveCount(1);
  });

  test('switches between local projects', async ({ page }) => {
    await openAppWithPinnedDocks(page);
    const projectName = page.getByRole('textbox', { name: 'Project name' });
    await projectName.fill('Alpha');
    await projectName.press('Enter');
    await addBox(page);

    await page.getByRole('button', { name: 'Project menu' }).click();
    await page.getByRole('menuitem', { name: 'New project' }).click();
    await expect(projectName).toHaveValue('Untitled project');
    await expect(page.locator('.tree-row')).toHaveCount(0);
    await projectName.fill('Beta');
    await projectName.press('Enter');
    await addBox(page);

    const openLocal = async (name: string) => {
      await page.getByRole('button', { name: 'Project menu' }).click();
      await page.getByRole('menuitem', { name: 'Local projects' }).hover();
      await page.getByRole('menuitem', { name, exact: true }).click();
      await waitForWorkspace(page);
    };

    await openLocal('Alpha');
    await expect(projectName).toHaveValue('Alpha');
    await expect(page.locator('.tree-row')).toHaveCount(1);

    await openLocal('Beta');
    await expect(projectName).toHaveValue('Beta');
    await expect(page.locator('.tree-row')).toHaveCount(1);
  });

  test('rotates a sketch plane and keeps the angle', async ({ page }) => {
    await openAppWithPinnedDocks(page);
    await toolRail(page).getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await page.waitForTimeout(600);
    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();
    await page.getByRole('button', { name: 'Line', exact: true }).click();
    await page.mouse.click(box!.x + 400, box!.y + 300);
    await page.waitForTimeout(320);
    await page.mouse.click(box!.x + 600, box!.y + 300);
    await page.waitForTimeout(320);
    await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
    await expect(page.locator('.sketch-overlay')).toHaveCount(0);

    await page.locator('.timeline-op').first().click();
    const inspector = page.getByTestId('inspector');
    const rotation = inspector.getByRole('switch', { name: 'Rotation' });
    await expect(rotation).not.toHaveAttribute('aria-checked', 'true');
    await rotation.click();
    const aroundZ = inspector.getByRole('textbox', { name: 'Rotation around Z' });
    await expect(aroundZ).toHaveValue('0');
    await aroundZ.fill('30');
    await aroundZ.press('Enter');
    await commitOperation(page);

    await page.reload();
    await waitForWorkspace(page);
    await page.locator('.timeline-op').first().click();
    await expect(
      page.getByTestId('inspector').getByRole('textbox', { name: 'Rotation around Z' }),
    ).toHaveValue('30');
  });
});

test.describe('floating docks', () => {
  test('tucks the panels away and holds them when pinned', async ({ page }) => {
    await openApp(page);
    const left = page.locator('.dock-left');
    const right = page.locator('.dock-right');
    await expect(left).toHaveAttribute('data-open', 'false', { timeout: 10_000 });
    await expect(right).toHaveAttribute('data-open', 'false');

    // A cursor opens a panel from the edge of the workspace.
    await page.mouse.move(4, 320);
    await expect(left).toHaveAttribute('data-open', 'true');
    await page.mouse.move(640, 320);
    await expect(left).toHaveAttribute('data-open', 'false', { timeout: 5_000 });

    await page.getByRole('button', { name: 'Project menu' }).click();
    await page.getByRole('menuitem', { name: 'Panels' }).hover();
    await page.getByRole('menuitem', { name: 'Pin' }).click();
    await page.keyboard.press('Escape');
    await expect(left).toHaveAttribute('data-open', 'true');
    await expect(right).toHaveAttribute('data-open', 'true');
    await expect(left).toHaveAttribute('data-tab', 'false');
    await page.mouse.move(640, 320);
    await page.waitForTimeout(1500);
    await expect(left).toHaveAttribute('data-open', 'true');
    await expect(right).toHaveAttribute('data-open', 'true');
  });
});

test.describe('a finger', () => {
  test.use({ viewport: { width: 600, height: 800 }, hasTouch: true, isMobile: true });

  test('opens a dock by its tab and selects in the tree', async ({ page }) => {
    await openApp(page);
    const left = page.locator('.dock-left');
    await expect(left).toHaveAttribute('data-open', 'false', { timeout: 10_000 });

    await page.evaluate(async () => {
      const url = (suffix: string) =>
        performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .find((name) => name.includes(suffix));
      const doc = await import(
        url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts'
      );
      doc.useDocumentStore.getState().addPrimitive('Cube', 'box');
      doc.useDocumentStore.getState().endFeatureEdit();
      doc.useDocumentStore.getState().select(null);
    });

    await left.locator('.dock-tab').tap();
    await expect(left).toHaveAttribute('data-open', 'true');
    const row = page.locator('.tree-row').first();
    await expect(row).toHaveCount(1);
    await row.locator('.tree-main').tap();
    await expect(page.locator('.tree-row.selected')).toHaveCount(1);

    // Close both docks before tapping the scene: on a 600 px screen two open
    // panels would cover the whole workspace.
    await left.locator('.dock-tab').tap();
    await expect(left).toHaveAttribute('data-open', 'false');
    const right = page.locator('.dock-right');
    if ((await right.getAttribute('data-open')) === 'true') {
      await right.locator('.dock-tab').tap();
      await expect(right).toHaveAttribute('data-open', 'false');
    }

    // The scene reports the empty tap.
    await page.touchscreen.tap(550, 400);
    await expect(page.locator('.tree-row.selected')).toHaveCount(0);
  });
});
