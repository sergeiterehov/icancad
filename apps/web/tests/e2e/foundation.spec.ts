import { expect, test, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Geometry pipeline check' })).toBeVisible({
    timeout: 120_000,
  });
}

function cubeStl(size: number): Buffer {
  const h = size / 2;
  const vertices: [number, number, number][] = [
    [-h, -h, 0],
    [h, -h, 0],
    [h, h, 0],
    [-h, h, 0],
    [-h, -h, size],
    [h, -h, size],
    [h, h, size],
    [-h, h, size],
  ];
  const faces: [number, number, number][] = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ];
  const buffer = Buffer.alloc(84 + faces.length * 50);
  buffer.write('ICanCAD e2e cube', 0, 'ascii');
  buffer.writeUInt32LE(faces.length, 80);
  let offset = 84;
  for (const face of faces) {
    buffer.writeFloatLE(0, offset);
    buffer.writeFloatLE(0, offset + 4);
    buffer.writeFloatLE(0, offset + 8);
    offset += 12;
    for (const index of face) {
      const vertex = vertices[index]!;
      buffer.writeFloatLE(vertex[0], offset);
      buffer.writeFloatLE(vertex[1], offset + 4);
      buffer.writeFloatLE(vertex[2], offset + 8);
      offset += 12;
    }
    offset += 2;
  }
  return buffer;
}

function cubeObj(size: number): Buffer {
  const h = size / 2;
  const vertices: [number, number, number][] = [
    [-h, -h, 0],
    [h, -h, 0],
    [h, h, 0],
    [-h, h, 0],
    [-h, -h, size],
    [h, -h, size],
    [h, h, size],
    [-h, h, size],
  ];
  const faces: [number, number, number][] = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ];
  return Buffer.from(
    [
      ...vertices.map((vertex) => `v ${vertex.join(' ')}`),
      ...faces.map((face) => `f ${face.map((index) => index + 1).join(' ')}`),
    ].join('\n'),
  );
}

async function addBox(page: Page) {
  await page.getByRole('button', { name: 'Add object' }).click();
  await page.getByRole('menuitem', { name: 'Box' }).click();
  await expect(page.getByText('20 × 20 × 20 mm')).toBeVisible();
  await commitOperation(page);
}

/** Camera views animate; clicks on precise points wait for the move to land. */
async function waitForRightView(page: Page) {
  const cube = page.getByTestId('nav-cube');
  await expect.poll(() => cube.getAttribute('data-azimuth'), { timeout: 15_000 }).toBe('0');
  await expect
    .poll(() => cube.getAttribute('data-polar'), { timeout: 15_000 })
    .toBe(String(Math.PI / 2));
}

/** The inspector names the type of the selected object in its header. */
function inspectorTitle(page: Page) {
  return page.getByTestId('inspector').locator('.panel-header > span').first();
}

const PREVIEW_MARKS =
  '.tree-row.preview-added, .tree-row.preview-modified, .tree-row.preview-removed';

// Opening an operation shows the state in front of it without moving the
// document cursor, so clicking empty space in the view simply dismisses it.
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

test.describe('ICANCad foundation', () => {
  test('creates, edits, persists and round-trips a project file', async ({ page }) => {
    await openApp(page);
    await addBox(page);

    // Selecting the operation previews the body it will create on top of the
    // state in front of it.
    await page.locator('.timeline-op').last().click();
    await expect(page.getByText('Faces')).toBeVisible();
    await expect(page.locator('.tree-row.preview-added')).toHaveCount(1);

    const width = page.getByRole('textbox', { name: 'Width (X)' });
    await width.fill('30');
    await width.press('Enter');
    await expect(page.getByText('30 × 20 × 20 mm')).toBeVisible();

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('20 × 20 × 20 mm')).toBeVisible();
    await page.getByRole('button', { name: 'Redo' }).click();
    await expect(page.getByText('30 × 20 × 20 mm')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Project' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('untitled-project.icad');
    const projectFile = await download.path();
    expect(projectFile).toBeTruthy();

    await width.fill('40');
    await width.press('Enter');
    await expect(page.getByText('40 × 20 × 20 mm')).toBeVisible();

    await page.locator('input[accept*="icad"]').setInputFiles(projectFile!);
    await expect(page.getByText('Project opened')).toBeVisible();
    await page.locator('.timeline-op').last().click();
    await expect(page.getByRole('textbox', { name: 'Width (X)' })).toHaveValue('30');
    await expect(page.getByTestId('save-state')).toHaveAttribute('data-state', 'saved');
    await page.waitForTimeout(1000);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Geometry pipeline check' })).toBeHidden({
      timeout: 120_000,
    });
    await page.locator('.timeline-op').last().click();
    await expect(page.getByRole('textbox', { name: 'Width (X)' })).toHaveValue('30');
  });

  test('keeps the user cursor while an operation is open and across a reload', async ({ page }) => {
    await openApp(page);
    await addBox(page);
    await addBox(page);

    const carets = page.locator('.timeline-caret');
    // The new operation became the cursor position.
    await expect(carets.last()).toHaveAttribute('aria-pressed', 'true');

    // Opening the first operation shows the state in front of it, but the
    // document cursor stays where the user left it.
    await page.locator('.timeline-op').first().click();
    await expect(page.locator('.tree-row.preview-added')).toHaveCount(1);
    await expect(carets.last()).toHaveAttribute('aria-pressed', 'true');
    await expect(carets.last()).toBeDisabled();

    await expect(page.getByTestId('save-state')).toHaveAttribute('data-state', 'saved');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Geometry pipeline check' })).toBeHidden({
      timeout: 120_000,
    });
    // Not on the operation that was open, but where the user was.
    await expect(page.locator('.timeline-caret').last()).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.tree-row')).toHaveCount(2);
  });

  test('shows a hidden sketch only while its operation is selected', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
    await expect(page.locator('.sketch-overlay')).toHaveCount(0);

    const sketchRow = page.locator('.tree-row').first();
    await sketchRow.getByRole('button', { name: 'Hide' }).click();
    await expect(sketchRow.getByRole('button', { name: 'Show' })).toBeVisible();

    // A sketch that cannot be seen cannot be configured, so opening its
    // operation shows it — as a view override only: once the operation is
    // dismissed the sketch is hidden again.
    await page.locator('.timeline-op').first().click();
    await expect(page.locator('.tree-row.preview-added')).toHaveCount(1);
    await commitOperation(page);
    await expect(
      page.locator('.tree-row').first().getByRole('button', { name: 'Show' }),
    ).toBeVisible();
  });

  test('edits object properties and undoes them with the keyboard', async ({ page }) => {
    await openApp(page);
    await addBox(page);

    const inspector = page.getByTestId('inspector');
    const canvas = page.getByTestId('viewport-canvas');
    const canvasBox = await canvas.boundingBox();
    const bodyRow = page.locator('.tree-row').first();
    await bodyRow.locator('.tree-main').click();
    await expect(inspectorTitle(page)).toHaveText('Body');
    await expect(inspector.getByText('Metrics')).toBeVisible();

    // The tree owns naming: a double click renames in place.
    await bodyRow.locator('.tree-main').dblclick();
    const rename = bodyRow.getByRole('textbox', { name: 'Rename' });
    await rename.fill('Base plate');
    await rename.press('Enter');
    await expect(bodyRow).toContainText('Base plate');

    // The colour comes from the context menu as a palette, and reaches the
    // object tree and the 3D view.
    await bodyRow.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Colour' }).hover();
    await expect(page.getByRole('menu').nth(1).locator('.context-palette-swatch')).toHaveCount(24);
    await page.getByRole('menuitemradio', { name: '#f7a072' }).click();
    await expect(bodyRow.locator('.tree-icon')).toHaveAttribute('style', /rgb\(247, 160, 114\)/);

    // Undo and redo work from the keyboard, not just the toolbar buttons.
    await page.mouse.click(canvasBox!.x + 10, canvasBox!.y + 10);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('.tree-row').first().locator('.tree-icon')).not.toHaveAttribute(
      'style',
      /rgb\(247, 160, 114\)/,
    );
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(page.locator('.tree-row').first().locator('.tree-icon')).toHaveAttribute(
      'style',
      /rgb\(247, 160, 114\)/,
    );

    // A box exposes its corner position, which accepts negative values and
    // survives a reload.
    await page.locator('.timeline-op').first().click();
    const positionX = inspector.getByRole('textbox', { name: 'Position X · mm' });
    await positionX.fill('-15');
    await positionX.press('Enter');
    await expect(page.getByTestId('save-state')).toHaveAttribute('data-state', 'saved');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Geometry pipeline check' })).toBeHidden({
      timeout: 120_000,
    });
    await page.locator('.timeline-op').first().click();
    await expect(inspector.getByRole('textbox', { name: 'Position X · mm' })).toHaveValue('-15');
  });

  test('leads a face back to the operation that made it', async ({ page }) => {
    await openApp(page);
    const tools = page.getByRole('navigation', { name: 'Tools' });
    const inspector = page.getByTestId('right');
    const canvas = page.getByTestId('viewport-canvas');
    await addBox(page);

    // Sketch on a face of the box and cut a hole through it, so the body comes
    // from two operations: the box and the cut.
    await tools.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Select face' }).click();
    const view = await canvas.boundingBox();
    await page.mouse.click(view!.x + view!.width / 2, view!.y + view!.height / 2 - 60);
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await page.waitForTimeout(800);

    await page.getByRole('button', { name: 'Line', exact: true }).click();
    const centered = await canvas.boundingBox();
    const originX = centered!.x + centered!.width / 2;
    const originY = centered!.y + centered!.height / 2;
    const corners: [number, number][] = [
      [originX - 50, originY - 50],
      [originX + 50, originY - 50],
      [originX + 50, originY + 50],
      [originX - 50, originY + 50],
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

    await page
      .locator('.tree-row')
      .filter({ hasText: 'Sketch' })
      .first()
      .locator('.tree-main')
      .click();
    await tools.getByRole('button', { name: 'Extrude', exact: true }).click();
    await inspector.getByRole('button', { name: 'Cut', exact: true }).click();
    await inspector.getByRole('button', { name: 'Through all', exact: true }).click();
    await commitOperation(page);
    await expect(page.locator('.timeline-op')).toHaveCount(3);

    const opAt = async () => {
      const ops = page.locator('.timeline-op');
      for (let index = 0; index < (await ops.count()); index += 1) {
        const className = (await ops.nth(index).getAttribute('class')) ?? '';
        if (className.includes('selected')) return ops.nth(index).getAttribute('aria-label');
      }
      return 'none';
    };
    const probe = async (view: 'Front' | 'Top', dx: number, dy: number) => {
      const cube = page.getByTestId('nav-cube');
      await cube.click({ button: 'right' });
      await page.getByRole('menuitem', { name: view }).click();
      await page.waitForTimeout(900);
      const box = await canvas.boundingBox();
      await page.mouse.dblclick(box!.x + box!.width / 2 + dx, box!.y + box!.height / 2 + dy);
      await expect.poll(opAt).not.toBe('none');
      const result = (await opAt()) ?? 'none';
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      return result;
    };

    // A face the cut did not touch still leads to the operation that created
    // the body; the face the hole passes through leads to the cut.
    const front = await probe('Front', 0, -60);
    const top = await probe('Top', 90, 0);
    expect(new Set([front, top])).toEqual(new Set(['Box', 'Extrude']));
  });

  test('opens the operation that produced a face on a double click', async ({ page }) => {
    await openApp(page);
    await addBox(page);
    await expect(page.locator('.timeline-op.selected')).toHaveCount(0);

    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();
    await page.mouse.dblclick(box!.x + box!.width / 2, box!.y + box!.height / 2);
    // Navigating from a face selects its operation, which opens its settings.
    await expect(page.locator('.timeline-op.selected')).toHaveCount(1);
    await expect(page.locator('.tree-row.preview-added')).toHaveCount(1);
    await expect(inspectorTitle(page)).toHaveText('Box');
  });

  test('imports and exports STL meshes', async ({ page }) => {
    await openApp(page);
    await page.setInputFiles('[data-testid="import-mesh"]', {
      name: 'cube.stl',
      mimeType: 'model/stl',
      buffer: cubeStl(20),
    });

    await commitOperation(page);
    const meshRow = page.getByTestId('left').getByRole('button', { name: /^cube/ });
    await expect(meshRow).toBeVisible();

    // An imported STL is a mesh object, not a solid body: it cannot be picked
    // as an extrude target.
    await meshRow.click();
    await expect(page.getByTestId('inspector').getByText('Mesh', { exact: true })).toBeVisible();
    await expect(page.getByText('20 × 20 × 20 mm')).toBeVisible();
    await expect(page.getByText('Watertight')).toBeVisible();
    await page.getByRole('button', { name: 'Extrude', exact: true }).click();
    const inspector = page.getByTestId('inspector');
    const bodiesSection = inspector
      .locator('.panel-section')
      .filter({ hasText: 'Apply to bodies' });
    await expect(bodiesSection).toBeVisible();
    await bodiesSection.getByRole('button', { name: 'Pick bodies in the view' }).click();
    const canvas = page.getByTestId('viewport-canvas');
    const canvasBox = await canvas.boundingBox();
    await page.mouse.click(
      canvasBox!.x + canvasBox!.width / 2,
      canvasBox!.y + canvasBox!.height / 2,
    );
    await expect(bodiesSection.locator('.selection-item')).toHaveCount(0);
    await bodiesSection.getByRole('button', { name: 'Finish picking' }).click();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('menuitem', { name: 'STL', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('untitled-project.stl');

    await expect(page.getByTestId('save-state')).toHaveAttribute('data-state', 'saved');
    await page.reload();
    const restored = page.getByTestId('left').getByRole('button', { name: /^cube/ });
    await expect(restored).toBeVisible({ timeout: 120_000 });
    await restored.click();
    await expect(page.getByText('20 × 20 × 20 mm')).toBeVisible();
  });

  test('supports rollback, language switching and themes', async ({ page }) => {
    await openApp(page);
    await addBox(page);

    await addBox(page);
    await expect(page.locator('.timeline-op')).toHaveCount(2);

    await page.getByTestId('kernel-state').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Version');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    const cube = page.getByTestId('nav-cube');
    await expect(cube).toBeVisible();
    const cubeBox = await cube.boundingBox();
    await page.mouse.move(cubeBox!.x + cubeBox!.width / 2, cubeBox!.y + cubeBox!.height / 2);
    await expect(page.getByRole('tooltip')).toContainText('Drag the cube to orbit');

    const azimuthBefore = Number(await cube.getAttribute('data-azimuth'));
    await page.mouse.click(cubeBox!.x + cubeBox!.width * 0.52, cubeBox!.y + cubeBox!.height * 0.3);
    await expect
      .poll(async () => Number(await cube.getAttribute('data-azimuth')))
      .not.toBe(azimuthBefore);

    const dragStart = Number(await cube.getAttribute('data-azimuth'));
    await page.mouse.move(cubeBox!.x + cubeBox!.width / 2, cubeBox!.y + cubeBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(cubeBox!.x + cubeBox!.width / 2 + 32, cubeBox!.y + cubeBox!.height / 2, {
      steps: 6,
    });
    await page.mouse.up();
    await expect
      .poll(async () => Number(await cube.getAttribute('data-azimuth')))
      .not.toBe(dragStart);

    await cube.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Isometric' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Top' })).toContainText('+Z');
    await page.getByRole('menuitem', { name: 'Top' }).click();
    await expect.poll(async () => Number(await cube.getAttribute('data-polar'))).toBeLessThan(0.01);
    await page.locator('.timeline-op').last().click();
    // A box exposes its corner position and its three sizes.
    await expect(page.locator('.dimension-field')).toHaveCount(6);
    await expect(page.locator('.dimension-unit')).toHaveCount(6);
    await expect(inspectorTitle(page)).toHaveText('Box');
    await commitOperation(page);

    const bodyRows = page.locator('.tree-row');
    await expect(bodyRows).toHaveCount(2);

    // Selecting an operation dims nothing; selecting an unrelated body dims it.
    await page.locator('.timeline-op').last().click();
    await expect(page.locator('.timeline-op.selected')).toHaveCount(1);
    await expect(page.locator('.timeline-op.dimmed')).toHaveCount(0);
    await commitOperation(page);
    await bodyRows.first().click();
    await expect(page.locator('.timeline-op.dimmed')).toHaveCount(1);
    await bodyRows.nth(1).click({ modifiers: ['Meta'] });
    await expect(page.locator('.selection-item')).toHaveCount(2);

    // The menu belongs to the selection, so it deletes both objects at once and
    // offers no rename for a multi-selection.
    await bodyRows.first().click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Delete 2 objects' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();

    // A single selection offers both, and Escape clears the selection.
    await bodyRows.first().click();
    await bodyRows.first().click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Delete object' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('.tree-row.selected')).toHaveCount(0);

    const caret = page.locator('.timeline-caret').nth(1);
    await caret.hover();
    await expect(page.getByRole('tooltip')).toHaveText('Go to operation #1');
    await caret.click();
    await expect(page.locator('.timeline-op.muted')).toHaveCount(1);
    await expect(bodyRows).toHaveCount(1);
    await page.locator('.timeline-caret').last().click();
    await expect(page.locator('.timeline-op.muted')).toHaveCount(0);
    await expect(bodyRows).toHaveCount(2);

    await page.locator('.timeline-caret').first().click();
    await expect(page.locator('.timeline-op.muted')).toHaveCount(2);
    await expect(bodyRows).toHaveCount(0);
    await page.locator('.timeline-caret').last().click();
    await expect(page.locator('.timeline-op.muted')).toHaveCount(0);
    await expect(bodyRows).toHaveCount(2);

    await page.getByRole('button', { name: 'Language' }).click();
    await page.getByRole('menuitem', { name: 'Русский' }).click();
    await expect(inspectorTitle(page)).toHaveText('Проект');
    await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Светлая' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.getByRole('button', { name: 'Тёмная' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.getByRole('button', { name: 'Добавить объект' }).hover();
    await expect(page.getByRole('tooltip')).toHaveText('Добавить объект');

    const canvas = page.getByTestId('viewport-canvas');
    const canvasBox = await canvas.boundingBox();
    await page.mouse.click(
      canvasBox!.x + canvasBox!.width / 2,
      canvasBox!.y + canvasBox!.height / 2,
    );
    // The panel header names the type of the selected object.
    await expect(inspectorTitle(page)).toHaveText('Тело');
    await page.mouse.click(canvasBox!.x + 18, canvasBox!.y + 18);
    await expect(inspectorTitle(page)).toHaveText('Проект');
  });
  test('adds and controls multiple section planes', async ({ page }) => {
    await openApp(page);
    await addBox(page);

    await page.getByRole('button', { name: 'Section', exact: true }).click();
    const planes = page.locator('.section-plane');
    await expect(planes).toHaveCount(1);
    await expect(
      planes.first().getByRole('button', { name: 'Plane along Y axis' }),
    ).toHaveAttribute('aria-pressed', 'true');

    const offset = planes.first().getByRole('textbox', { name: 'Offset' });
    await offset.fill('5');
    await offset.press('Enter');
    await expect(offset).toHaveValue('5');

    await page.getByRole('button', { name: 'Add plane' }).click();
    await expect(planes).toHaveCount(2);
    await expect(planes.nth(1).getByRole('button', { name: 'Plane along X axis' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await planes.nth(1).getByRole('button', { name: 'Hide plane' }).click();
    await expect(planes.nth(1).getByRole('button', { name: 'Show plane' })).toBeVisible();
    await planes.nth(1).getByRole('button', { name: 'Remove plane' }).click();
    await expect(planes).toHaveCount(1);

    const sectionTool = page.getByRole('button', { name: 'Section', exact: true });
    await sectionTool.click();
    await expect(sectionTool).not.toHaveAttribute('data-active', 'true');
    await expect(planes).toHaveCount(0);
    await sectionTool.click();
    await expect(sectionTool).toHaveAttribute('data-active', 'true');
    await expect(planes).toHaveCount(1);

    await planes.first().getByRole('button', { name: 'Hide plane' }).click();
    await expect(planes.first().getByRole('button', { name: 'Show plane' })).toBeVisible();
    await sectionTool.click();
    await expect(planes).toHaveCount(0);
    await sectionTool.click();
    await expect(planes.first().getByRole('button', { name: 'Show plane' })).toBeVisible();
    await expect(page.getByTestId('save-state')).toHaveAttribute('data-state', 'saved');

    await page.reload();
    await expect(sectionTool).toBeVisible({ timeout: 120_000 });
    await expect(sectionTool).toHaveAttribute('data-active', 'true');
    await expect(planes.first().getByRole('button', { name: 'Show plane' })).toBeVisible();

    await sectionTool.click();
    await expect(sectionTool).not.toHaveAttribute('data-active', 'true');
    await page.reload();
    await expect(sectionTool).toBeVisible({ timeout: 120_000 });
    await expect(sectionTool).not.toHaveAttribute('data-active', 'true');
    await expect(planes).toHaveCount(0);
  });

  test('does not pick the material a section removes', async ({ page }) => {
    await openApp(page);
    await addBox(page);

    // Looking from the right, +Y runs right and +Z up, so a section along Y
    // hides the left half of the box.
    await page.getByTestId('nav-cube').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Right' }).click();
    await waitForRightView(page);

    await page.getByRole('button', { name: 'Section', exact: true }).click();
    const offset = page.locator('.section-plane').first().getByRole('textbox', { name: 'Offset' });
    await offset.fill('10');
    await offset.press('Enter');
    await page.waitForTimeout(800);

    const canvas = page.getByTestId('viewport-canvas');
    const view = await canvas.boundingBox();
    const centerX = view!.x + view!.width / 2;
    const centerY = view!.y + view!.height / 2;

    await page.mouse.click(centerX + 60, centerY);
    await expect(page.locator('.tree-row.selected')).toHaveCount(1);

    // The cut-away half is empty, so a click there must not bring the body
    // back through the material the section hides.
    await page.mouse.click(centerX - 60, centerY);
    await expect(page.locator('.tree-row.selected')).toHaveCount(0);

    // While the plane waits for its face it cuts nothing, so the half the
    // section was hiding is back and a click there picks its face.
    const plane = page.locator('.section-plane').first();
    const picker = page.getByTestId('section-face-picker');
    await plane.getByRole('button', { name: 'Plane on a face' }).click();
    await expect(picker).toHaveAttribute('data-active', 'true');
    await page.waitForTimeout(600);
    await page.mouse.click(centerX - 60, centerY);
    await expect(picker).toContainText('Face');
    await expect(picker).not.toHaveAttribute('data-active', 'true');
  });

  test('sections along a face and flips its direction', async ({ page }) => {
    await openApp(page);
    await addBox(page);

    await page.getByRole('button', { name: 'Section', exact: true }).click();
    const plane = page.locator('.section-plane').first();
    const picker = page.getByTestId('section-face-picker');
    await expect(picker).toHaveCount(0);

    // The face tab brings up the picker and starts the pick by itself.
    await plane.getByRole('button', { name: 'Plane on a face' }).click();
    await expect(picker).toBeVisible();
    await expect(picker).toHaveAttribute('data-active', 'true');

    const canvas = page.getByTestId('viewport-canvas');
    const view = await canvas.boundingBox();
    await page.mouse.click(view!.x + view!.width / 2, view!.y + view!.height / 2);
    await expect(picker).toContainText('Face');
    await expect(picker).not.toHaveAttribute('data-active', 'true');
    await expect(picker).not.toHaveAttribute('data-invalid', 'true');

    // The offset now runs into the body from the picked face.
    const offset = plane.getByRole('textbox', { name: 'Offset' });
    await offset.fill('8');
    await offset.press('Enter');
    await expect(offset).toHaveValue('8');

    // The direction button stays dark until the cut is inverted.
    const invert = plane.getByRole('button', { name: 'Flip cut direction' });
    await expect(invert).not.toHaveAttribute('data-active', 'true');
    await invert.click();
    await expect(invert).toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('save-state')).toHaveAttribute('data-state', 'saved');

    // An axis tab drops the face link, so the picker goes away again.
    await plane.getByRole('button', { name: 'Plane along Z axis' }).click();
    await expect(picker).toHaveCount(0);
    await expect(plane.getByRole('button', { name: 'Plane along Z axis' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('imports OBJ meshes', async ({ page }) => {
    await openApp(page);
    await page.setInputFiles('[data-testid="import-mesh"]', {
      name: 'cube.obj',
      mimeType: 'text/plain',
      buffer: cubeObj(20),
    });

    await commitOperation(page);
    const objRow = page.getByTestId('left').getByRole('button', { name: /^cube/ });
    await expect(objRow).toBeVisible();
    await expect(page.getByTestId('left').locator('.tree-row')).toHaveCount(1);
    await objRow.click();
    await expect(page.getByText('20 × 20 × 20 mm')).toBeVisible();
    await expect(page.getByText('Watertight')).toBeVisible();
    await expect(page.getByText('Volume')).toBeVisible();
    await expect(page.getByText('Components')).toBeVisible();

    await page.getByRole('button', { name: 'Section', exact: true }).click();
    await expect(page.locator('.section-plane')).toHaveCount(1);
    const offset = page.getByRole('textbox', { name: 'Offset' });
    await offset.fill('10');
    await offset.press('Enter');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    // The item names the selection that will be exported.
    await page.getByRole('menuitem', { name: /^STL/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('untitled-project.stl');

    await expect(page.getByTestId('save-state')).toHaveAttribute('data-state', 'saved');
    await page.reload();
    await expect(page.getByTestId('left').locator('.tree-row')).toHaveCount(1, {
      timeout: 120_000,
    });
  });
  test('animates navigation cube edge views', async ({ page }) => {
    await openApp(page);
    const cube = page.getByTestId('nav-cube');
    const box = await cube.boundingBox();
    let edge: { x: number; y: number } | null = null;
    for (let row = 1; row < 12 && !edge; row += 1) {
      for (let column = 1; column < 12 && !edge; column += 1) {
        const x = box!.x + (box!.width * column) / 12;
        const y = box!.y + (box!.height * row) / 12;
        await page.mouse.move(x, y);
        const target = await cube.getAttribute('data-target');
        const polar = Number(await cube.getAttribute('data-target-polar'));
        if (target === 'edge' && Math.abs(polar - Math.PI / 4) < 0.01) edge = { x, y };
      }
    }
    expect(edge).not.toBeNull();

    // An edge is a programmatic view change, so it must ease in instead of
    // snapping the camera on click.
    await page.mouse.click(edge!.x, edge!.y);
    const during = Number(await cube.getAttribute('data-polar'));
    expect(Math.abs(during - Math.PI / 4)).toBeGreaterThan(0.1);
    await expect
      .poll(async () => Number(await cube.getAttribute('data-polar')))
      .toBeCloseTo(Math.PI / 4, 2);
  });

  test('creates and edits a sketch on a datum plane', async ({ page }) => {
    await openApp(page);
    const cube = page.getByTestId('nav-cube');
    const azimuthBefore = Number(await cube.getAttribute('data-azimuth'));
    const polarBefore = Number(await cube.getAttribute('data-polar'));

    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    // Entering a sketch animates the camera; wait so clicks map to the settled view.
    await page.waitForTimeout(600);
    await expect(page.locator('.tree-row')).toHaveCount(1);

    await page.getByRole('button', { name: 'Line', exact: true }).click();
    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();
    await page.mouse.click(box!.x + 260, box!.y + 320);
    await page.mouse.click(box!.x + 470, box!.y + 440);
    await expect(page.locator('.tree-row').first()).toContainText('Sketch');

    const topbar = page.locator('.topbar');
    await topbar.getByRole('button', { name: 'Select', exact: true }).click();
    const deleteButton = topbar.getByRole('button', { name: 'Delete', exact: true });
    await expect(deleteButton).toBeDisabled();
    await page.locator('.sketch-entity-row').click();
    await expect(deleteButton).toBeEnabled();
    await expect(page.getByText('Geometry')).toBeVisible();
    await expect(page.getByText('Constraints').first()).toBeVisible();

    await page.getByRole('button', { name: 'Finish sketch' }).click();
    await expect(page.locator('.sketch-overlay')).toHaveCount(0);
    await expect(page.locator('.tree-row').first()).toContainText('Sketch');
    await expect
      .poll(async () => Math.abs(Number(await cube.getAttribute('data-azimuth')) - azimuthBefore))
      .toBeLessThan(0.001);
    await expect
      .poll(async () => Math.abs(Number(await cube.getAttribute('data-polar')) - polarBefore))
      .toBeLessThan(0.001);

    // The sketch object is renamed from its tree row, and the operation that
    // created it takes the same name.
    const sketchRow = page.locator('.tree-row').first();
    await sketchRow.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const rename = sketchRow.getByRole('textbox', { name: 'Rename' });
    await rename.fill('Profile');
    await rename.press('Enter');
    await expect(sketchRow).toContainText('Profile');
    await expect(page.locator('.timeline-op').first()).toHaveAttribute('aria-label', 'Profile');

    // The operation keeps its own name field, which renames the same feature.
    await page.locator('.timeline-op').first().click();
    const operationName = page.getByTestId('inspector').getByRole('textbox', { name: 'Name' });
    await operationName.fill('Outline');
    await operationName.press('Enter');
    await commitOperation(page);
    await expect(sketchRow).toContainText('Outline');
    await expect(page.locator('.timeline-op').first()).toHaveAttribute('aria-label', 'Outline');
    await expect(sketchRow).not.toHaveClass(/preview-added/);

    await sketchRow.getByRole('button', { name: 'Hide', exact: true }).click();
    await expect(sketchRow.getByRole('button', { name: 'Show', exact: true })).toBeVisible();
    await sketchRow.getByRole('button', { name: 'Show', exact: true }).click();

    await sketchRow.locator('.tree-main').dblclick();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
  });

  test('creates a sketch on a planar face', async ({ page }) => {
    await openApp(page);
    await addBox(page);

    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await page.getByRole('button', { name: 'Finish sketch' }).click();
    await page.locator('.timeline-op').last().click();

    const inspector = page.getByTestId('inspector');
    const placement = inspector.locator('.panel-section').filter({ hasText: 'Placement' });
    await placement.getByRole('button', { name: 'Face', exact: true }).click();

    const picker = inspector.getByTestId('sketch-face-picker');
    await expect(picker).toBeVisible();
    await expect(picker).toHaveAttribute('data-invalid', 'true');
    // Without a face the sketch object is not built and editing is unavailable.
    await expect(page.locator('.tree-row')).toHaveCount(1);
    await expect(page.locator('.timeline-op.error')).toHaveCount(1);
    await page.locator('.timeline-op').last().dblclick();
    await expect(page.locator('.sketch-overlay')).toHaveCount(0);

    await picker.click();
    await expect(picker).toHaveAttribute('data-active', 'true');
    const canvas = page.getByTestId('viewport-canvas');
    const canvasBox = await canvas.boundingBox();
    await page.mouse.click(
      canvasBox!.x + canvasBox!.width / 2,
      canvasBox!.y + canvasBox!.height / 2,
    );

    await expect(picker).not.toHaveAttribute('data-active', 'true');
    await expect(picker).not.toHaveAttribute('data-invalid', 'true');
    await expect(page.locator('.tree-row')).toHaveCount(2);
    await expect(page.locator('.timeline-op.error')).toHaveCount(0);

    await commitOperation(page);
    const sketchRow = page.locator('.tree-row').filter({ hasText: 'Sketch' });
    await sketchRow.locator('.tree-main').dblclick();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
  });

  test('starts a face sketch from the sketch tool', async ({ page }) => {
    await openApp(page);
    await addBox(page);

    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await expect(page.getByRole('menuitem').first()).toContainText('Select face');
    await expect(page.getByRole('menuitem', { name: 'Top' })).toContainText('XY');
    await expect(page.getByRole('menuitem', { name: 'Front' })).toContainText('XZ');
    await expect(page.getByRole('menuitem', { name: 'Right' })).toContainText('YZ');

    await page.getByRole('menuitem', { name: 'Select face' }).click();
    const picker = page.getByTestId('inspector').getByTestId('sketch-face-picker');
    await expect(picker).toBeVisible();
    await expect(picker).toHaveAttribute('data-active', 'true');

    const canvas = page.getByTestId('viewport-canvas');
    const canvasBox = await canvas.boundingBox();
    await page.mouse.click(
      canvasBox!.x + canvasBox!.width / 2,
      canvasBox!.y + canvasBox!.height / 2,
    );
    await expect(page.locator('.sketch-overlay')).toBeVisible();
  });

  test('switches camera orientation between sketches', async ({ page }) => {
    await openApp(page);
    const cube = page.getByTestId('nav-cube');
    const tools = page.getByRole('navigation', { name: 'Tools' });

    const makeSketch = async (plane: 'XY plane' | 'XZ plane') => {
      await tools.getByRole('button', { name: 'Sketch', exact: true }).click();
      await page.getByRole('menuitem', { name: plane }).click();
      await expect(page.locator('.sketch-overlay')).toBeVisible();
      await page.waitForTimeout(700);
      await page.getByRole('button', { name: 'Finish sketch' }).click();
    };

    await makeSketch('XY plane');
    await makeSketch('XZ plane');

    const rows = page.locator('.tree-row');
    await expect(rows).toHaveCount(2);

    await rows.first().locator('.tree-main').dblclick();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await expect.poll(async () => Number(await cube.getAttribute('data-polar'))).toBeLessThan(0.01);
    await page.getByRole('button', { name: 'Finish sketch' }).click();

    await rows.nth(1).locator('.tree-main').dblclick();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await expect
      .poll(async () => Number(await cube.getAttribute('data-polar')))
      .toBeGreaterThan(1.5);
    await expect
      .poll(async () => Number(await cube.getAttribute('data-azimuth')))
      .toBeCloseTo(-Math.PI / 2, 1);

    // The earlier sketch is still in the rolled-back tree, so it can be opened
    // directly while the second one is being edited.
    await rows.first().locator('.tree-main').dblclick();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await expect.poll(async () => Number(await cube.getAttribute('data-polar'))).toBeLessThan(0.01);
    await page.getByRole('button', { name: 'Finish sketch' }).click();

    await rows.nth(1).locator('.tree-main').dblclick();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await expect
      .poll(async () => Number(await cube.getAttribute('data-polar')))
      .toBeGreaterThan(1.5);
  });

  test('returns to a face sketch orientation after a datum sketch', async ({ page }) => {
    await openApp(page);
    await addBox(page);
    const cube = page.getByTestId('nav-cube');
    const tools = page.getByRole('navigation', { name: 'Tools' });
    const canvas = page.getByTestId('viewport-canvas');

    await tools.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Select face' }).click();
    const picker = page.getByTestId('inspector').getByTestId('sketch-face-picker');
    await expect(picker).toHaveAttribute('data-active', 'true');
    const box = await canvas.boundingBox();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await page.waitForTimeout(700);
    const facePolar = Number(await cube.getAttribute('data-polar'));
    const faceAzimuth = Number(await cube.getAttribute('data-azimuth'));
    await page.getByRole('button', { name: 'Finish sketch' }).click();

    await tools.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XZ plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await expect
      .poll(async () => Number(await cube.getAttribute('data-polar')))
      .toBeGreaterThan(1.5);
    await page.getByRole('button', { name: 'Finish sketch' }).click();

    const sketchRows = page.locator('.tree-row').filter({ hasText: 'Sketch' });
    await sketchRows.first().locator('.tree-main').dblclick();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await expect
      .poll(async () => Number(await cube.getAttribute('data-polar')))
      .toBeCloseTo(facePolar, 1);
    await expect
      .poll(async () => Number(await cube.getAttribute('data-azimuth')))
      .toBeCloseTo(faceAzimuth, 1);
  });

  test('switches from a datum sketch to a face sketch while editing', async ({ page }) => {
    await openApp(page);
    const tools = page.getByRole('navigation', { name: 'Tools' });
    const canvas = page.getByTestId('viewport-canvas');
    const cube = page.getByTestId('nav-cube');

    await tools.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'YZ plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await page.waitForTimeout(600);

    const canvasBox = await canvas.boundingBox();
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
      await page.mouse.click(canvasBox!.x + start[0], canvasBox!.y + start[1]);
      await page.waitForTimeout(320);
      await page.mouse.click(canvasBox!.x + end[0], canvasBox!.y + end[1]);
      await page.waitForTimeout(320);
    }
    await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
    await page.locator('.tree-row').first().locator('.tree-main').click();
    await tools.getByRole('button', { name: 'Extrude', exact: true }).click();
    await expect(page.locator('.tree-row')).toHaveCount(2);

    await cube.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Isometric' }).click();
    await page.waitForTimeout(600);
    await cube.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Fit view' }).click();
    await page.waitForTimeout(700);

    // Second sketch on a face of the extruded body.
    await tools.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Select face' }).click();
    const picker = page.getByTestId('inspector').getByTestId('sketch-face-picker');
    await expect(picker).toHaveAttribute('data-active', 'true');
    await page.waitForTimeout(200);
    await page.mouse.click(
      canvasBox!.x + canvasBox!.width / 2,
      canvasBox!.y + canvasBox!.height * 0.3,
    );
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await expect.poll(async () => Number(await cube.getAttribute('data-polar'))).toBeLessThan(0.2);
    const facePolar = Number(await cube.getAttribute('data-polar'));
    const faceAzimuth = Number(await cube.getAttribute('data-azimuth'));
    await page.getByRole('button', { name: 'Finish sketch' }).click();

    const operations = page.locator('.timeline-op');
    await expect(operations).toHaveCount(3);
    await operations.nth(0).dblclick();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await expect
      .poll(async () => Number(await cube.getAttribute('data-polar')))
      .toBeGreaterThan(1.5);
    await expect
      .poll(async () => Number(await cube.getAttribute('data-azimuth')))
      .toBeCloseTo(0, 1);
    await cube.click({ button: 'right' });
    await expect(page.getByRole('menuitem').first()).toContainText('Orient to sketch');
    await page.getByRole('menuitem', { name: 'Orient to sketch' }).click();

    // Switch to the face sketch without leaving the first editor.
    await operations.nth(2).dblclick();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await expect
      .poll(async () => Number(await cube.getAttribute('data-polar')))
      .toBeCloseTo(facePolar, 1);
    await expect
      .poll(async () => Number(await cube.getAttribute('data-azimuth')))
      .toBeCloseTo(faceAzimuth, 1);
  });

  test('extrudes a sketch and turns the result into a body', async ({ page }) => {
    await openApp(page);
    const tools = page.getByRole('navigation', { name: 'Tools' });
    const canvas = page.getByTestId('viewport-canvas');

    await tools.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await page.waitForTimeout(600);

    const box = await canvas.boundingBox();
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

    await page.locator('.tree-row').first().locator('.tree-main').click();
    await tools.getByRole('button', { name: 'Extrude', exact: true }).click();

    const rows = page.locator('.tree-row');
    // While the operation is being configured, its body is a phantom.
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText('Body');
    await expect(page.locator(PREVIEW_MARKS)).toHaveCount(1);
    await commitOperation(page);

    // A new body is an object of its own, not a copy of the operation name.
    const inspector = page.getByTestId('right');
    // Statistics describe the body, not the operation.
    await rows.nth(1).locator('.tree-main').click();
    await expect(inspector.getByText('Bounds')).toBeVisible();
    await expect.poll(async () => inspector.innerText()).toContain('× 10 mm');

    // The distance is a parameter of the operation, so the body follows it.
    await page.locator('.timeline-op').last().click();
    const distance = inspector.getByRole('textbox').nth(1);
    await distance.fill('25');
    await distance.press('Enter');
    await commitOperation(page);
    await rows.nth(1).locator('.tree-main').click();
    await expect.poll(async () => inspector.innerText()).toContain('× 25 mm');

    // Turning the operation into a cut makes it create nothing, so the body is
    // no longer part of the preview at all.
    await page.locator('.timeline-op').last().click();
    await inspector.getByRole('button', { name: 'Cut', exact: true }).click();
    await expect(page.locator('.tree-row.preview-added')).toHaveCount(0);
    await expect(rows).toHaveCount(1);
    await commitOperation(page);
    await expect(rows).toHaveCount(1);

    await page.locator('.timeline-op').last().click();
    await inspector.getByRole('button', { name: 'New body', exact: true }).click();
    await commitOperation(page);
    await expect(rows).toHaveCount(2);
  });
  test('separates the sketch object from its construction operation', async ({ page }) => {
    await openApp(page);
    const tools = page.getByRole('navigation', { name: 'Tools' });
    const inspector = page.getByTestId('right');
    const canvas = page.getByTestId('viewport-canvas');

    await tools.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await page.waitForTimeout(600);

    // A closed rectangle so the sketch owns a face, four edges and four points.
    const box = await canvas.boundingBox();
    await page.getByRole('button', { name: 'Line', exact: true }).click();
    const corners: [number, number][] = [
      [300, 250],
      [500, 250],
      [500, 400],
      [300, 400],
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

    // The tree row selects the sketch object: its geometry, not the recipe.
    await page.locator('.tree-row').first().locator('.tree-main').click();
    await expect(inspector.getByText('Faces')).toBeVisible();
    await expect(inspector.getByText('Face 1')).toBeVisible();
    await expect(inspector.getByText('Edge 1')).toBeVisible();
    await expect(inspector.getByText('Point 4')).toBeVisible();
    await expect(
      inspector.locator('.panel-section-title').filter({ hasText: 'Geometry' }),
    ).toHaveCount(0);
    await expect(inspector.getByText('Placement')).toHaveCount(0);
    // A sketch object can show its construction geometry, which is hidden in
    // the 3D view until the switch is turned on.
    await expect(
      inspector.getByRole('switch', { name: 'Show construction geometry' }),
    ).toHaveAttribute('aria-checked', 'false');

    // The timeline chip selects the operation: placement and geometry.
    await page.locator('.timeline-op').first().click();
    await expect(inspector.getByText('Placement')).toBeVisible();
    await expect(
      inspector.locator('.panel-section-title').filter({ hasText: 'Geometry' }),
    ).toBeVisible();
    await expect(inspector.getByText('Faces')).toHaveCount(0);

    // Editing also targets the operation, because the recipe is what changes.
    await commitOperation(page);
    await page.locator('.tree-row').first().locator('.tree-main').dblclick();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await expect(inspector.getByText('Geometry')).toBeVisible();
    await expect(inspector.getByText('Constraints').first()).toBeVisible();
    await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
    await expect(inspector.getByText('Faces')).toBeVisible();
  });
  test('solves constraints and drags sketch handles', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    // Entering a sketch animates the camera; wait so clicks map to the settled view.
    await page.waitForTimeout(600);

    await page.getByRole('button', { name: 'Line', exact: true }).click();
    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();
    await page.mouse.click(box!.x + 260, box!.y + 320);
    await page.mouse.click(box!.x + 470, box!.y + 440);
    const topbar = page.locator('.topbar');
    await topbar.getByRole('button', { name: 'Select', exact: true }).click();

    const composition = page.locator('.panel-section', { hasText: 'Geometry' });
    const constraintsSection = page.locator('.panel-section', { hasText: 'Constraints' });
    await expect(composition).toContainText('50.6 mm');

    await page.mouse.move(box!.x + 470, box!.y + 440);
    await page.mouse.down();
    await page.mouse.move(box!.x + 600, box!.y + 440, { steps: 8 });
    await page.mouse.up();
    await expect(composition).not.toContainText('50.6 mm');

    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(composition).toContainText('50.6 mm');

    await page.mouse.move(box!.x + 365, box!.y + 380);
    await page.mouse.down();
    await page.mouse.move(box!.x + 415, box!.y + 330, { steps: 8 });
    await page.mouse.up();
    await expect(composition).toContainText('50.6 mm');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();

    await page.mouse.click(box!.x + 260, box!.y + 320);
    await topbar.getByRole('button', { name: 'Constraints', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Fix', exact: true }).click();
    await expect(constraintsSection).toContainText('Fix');

    await page.mouse.move(box!.x + 260, box!.y + 320);
    await page.mouse.down();
    await page.mouse.move(box!.x + 310, box!.y + 360, { steps: 8 });
    await page.mouse.up();
    await expect(composition).toContainText('50.6 mm');

    await page.mouse.click(box!.x + 365, box!.y + 380);
    await topbar.getByRole('button', { name: 'Constraints', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Horizontal', exact: true }).click();
    await expect(constraintsSection).toContainText('Horizontal');

    await topbar.getByRole('button', { name: 'Constraints', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Distance', exact: true }).click();
    const annotation = page.locator('.sketch-annotation').last();
    await expect(annotation).toContainText('mm');
    await annotation.dblclick();
    const value = page.locator('.sketch-annotation-input');
    await value.fill('80');
    await value.press('Enter');
    await expect(composition).toContainText('80 mm');
    await expect(annotation).toContainText('80 mm');
  });
  test('switches the toolbar with the editing context', async ({ page }) => {
    await openApp(page);
    const topbar = page.locator('.topbar');
    await expect(topbar.getByRole('button', { name: 'Select', exact: true })).toHaveCount(0);
    await expect(topbar.getByRole('button', { name: 'Section', exact: true })).toBeVisible();

    await topbar.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(topbar.getByRole('button', { name: 'Line', exact: true })).toBeVisible();
    await expect(topbar.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
    await expect(topbar.getByRole('button', { name: 'Finish sketch', exact: true })).toBeVisible();
    await expect(topbar.getByRole('button', { name: 'Section', exact: true })).toBeVisible();
    await expect(page.locator('.sketch-toolbar')).toHaveCount(0);

    // While a sketch is open the sketch plane is already a section entry.
    const sectionButton = topbar.getByRole('button', { name: 'Section', exact: true });
    await expect(page.locator('.section-plane')).toHaveCount(1);
    await sectionButton.click();
    await expect(page.locator('.section-plane')).toHaveCount(0);
    await sectionButton.click();
    await expect(page.locator('.section-plane')).toHaveCount(1);

    await topbar.getByRole('button', { name: 'Finish sketch', exact: true }).click();
    await expect(topbar.getByRole('button', { name: 'Line', exact: true })).toHaveCount(0);
    await expect(topbar.getByRole('button', { name: 'Select', exact: true })).toHaveCount(0);
  });
  test('prioritizes sketch points over curves when selecting', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    // Entering a sketch animates the camera; wait so clicks map to the settled view.
    await page.waitForTimeout(600);

    const topbar = page.locator('.topbar');
    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();
    await page.getByRole('button', { name: 'Line', exact: true }).click();
    await page.mouse.click(box!.x + 400, box!.y + 300);
    await page.mouse.click(box!.x + 500, box!.y + 400);
    await page.getByRole('button', { name: 'Point', exact: true }).click();
    await page.mouse.click(box!.x + 400, box!.y + 300);

    await topbar.getByRole('button', { name: 'Select', exact: true }).click();
    await page.mouse.click(box!.x + 400, box!.y + 300);
    await topbar.getByRole('button', { name: 'Constraints', exact: true }).click();
    await expect(page.getByRole('menuitem')).toHaveCount(1);
    await expect(page.getByRole('menuitem', { name: 'Fix', exact: true })).toBeVisible();
  });
  test('adds automatic constraints and toggles construction geometry', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    // Entering a sketch animates the camera; wait so clicks map to the settled view.
    await page.waitForTimeout(600);

    const topbar = page.locator('.topbar');
    const magnet = topbar.getByRole('button', { name: 'Magnet', exact: true });
    await expect(magnet).toHaveAttribute('data-active', 'true');
    const constraints = page.locator('.panel-section', { hasText: 'Constraints' });
    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();
    await page.getByRole('button', { name: 'Line', exact: true }).click();
    await page.mouse.click(box!.x + 300, box!.y + 300);
    await page.mouse.click(box!.x + 500, box!.y + 400);

    await page.mouse.click(box!.x + 505, box!.y + 405);
    await page.mouse.click(box!.x + 620, box!.y + 300);
    await expect(constraints).toContainText('Coincident');
    // The line tool chains segments; Escape ends the chain but stays in Line.
    await page.keyboard.press('Escape');

    await magnet.click();
    await expect(magnet).not.toHaveAttribute('data-active', 'true');
    await page.mouse.click(box!.x + 305, box!.y + 305);
    await page.mouse.click(box!.x + 650, box!.y + 500);
    await expect(page.locator('.constraint-row')).toHaveCount(1);
    await page.keyboard.press('Escape');

    await magnet.click();
    await page.mouse.click(box!.x + 300, box!.y + 520);
    await page.mouse.click(box!.x + 500, box!.y + 525);
    await expect(constraints).toContainText('Horizontal');

    await topbar.getByRole('button', { name: 'Select', exact: true }).click();
    const firstEntity = page.locator('.sketch-entity-row').first();
    await firstEntity.click();
    const construction = topbar.getByRole('button', {
      name: 'Construction geometry',
      exact: true,
    });
    await construction.click();
    await expect(firstEntity).toHaveAttribute('data-construction', 'true');
    await expect(construction).toHaveAttribute('data-active', 'true');
    await construction.click();
    await expect(firstEntity).not.toHaveAttribute('data-construction', 'true');
  });
  test('removes constraints with deleted geometry', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    // Entering a sketch animates the camera; wait so clicks map to the settled view.
    await page.waitForTimeout(600);

    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();
    const step = async (x: number, y: number) => {
      await page.mouse.move(box!.x + x, box!.y + y);
      await page.mouse.click(box!.x + x, box!.y + y);
      await page.waitForTimeout(350);
    };
    await page.getByRole('button', { name: 'Line', exact: true }).click();
    await step(300, 300);
    await step(700, 300);
    await step(700, 300);
    await step(700, 600);

    const constraints = page.locator('.panel-section', { hasText: 'Constraints' });
    await expect(constraints).toContainText('Coincident');
    const rowsBefore = await page.locator('.constraint-row').count();

    const topbar = page.locator('.topbar');
    await topbar.getByRole('button', { name: 'Select', exact: true }).click();
    await page.locator('.sketch-entity-row').first().click();
    await topbar.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page.locator('.sketch-entity-row')).toHaveCount(1);
    await expect(constraints).not.toContainText('Coincident');
    expect(await page.locator('.constraint-row').count()).toBeLessThan(rowsBefore);
    await expect(page.locator('.constraint-row')).not.toHaveCount(0);
  });
  test('snaps to segment midpoints with symmetry and to circles with tangency', async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    // Entering a sketch animates the camera; wait so clicks map to the settled view.
    await page.waitForTimeout(600);

    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();
    const step = async (x: number, y: number) => {
      await page.mouse.move(box!.x + x, box!.y + y);
      await page.mouse.click(box!.x + x, box!.y + y);
      await page.waitForTimeout(350);
    };
    const constraints = page.locator('.panel-section', { hasText: 'Constraints' });

    await page.getByRole('button', { name: 'Line', exact: true }).click();
    await step(300, 300);
    await step(700, 300);
    await expect(constraints).toContainText('Horizontal');
    await page.keyboard.press('Escape');

    await step(500, 300);
    await step(500, 500);
    await expect(constraints).toContainText('Symmetric');

    await page.getByRole('button', { name: 'Line', exact: true }).click();
    await step(300, 500);
    await step(700, 500);
    await page.getByRole('button', { name: 'Circle', exact: true }).click();
    await step(400, 420);
    await step(400, 500);
    await expect(constraints).toContainText('Tangent');
  });
  test('draws a closed rectangle and drags it without conflicts', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    // Entering a sketch animates the camera; wait so clicks map to the settled view.
    await page.waitForTimeout(600);

    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();
    const step = async (x: number, y: number) => {
      await page.mouse.move(box!.x + x, box!.y + y);
      await page.mouse.click(box!.x + x, box!.y + y);
      await page.waitForTimeout(320);
    };

    await page.getByRole('button', { name: 'Line', exact: true }).click();
    const corners = [
      [300, 250],
      [600, 250],
      [600, 520],
      [300, 520],
    ];
    for (let index = 0; index < 4; index += 1) {
      const start = corners[index]!;
      const end = corners[(index + 1) % 4]!;
      await step(start[0]!, start[1]!);
      await step(end[0]!, end[1]!);
    }

    const constraints = page.locator('.panel-section', { hasText: 'Constraints' });
    await expect(page.locator('.constraint-row')).toHaveCount(8);
    await expect(constraints).toContainText('Coincident');

    const composition = page.locator('.panel-section', { hasText: 'Geometry' });
    const before = await composition.innerText();

    const topbar = page.locator('.topbar');
    await topbar.getByRole('button', { name: 'Select', exact: true }).click();
    await page.mouse.move(box!.x + 600, box!.y + 250);
    await page.mouse.down();
    await page.mouse.move(box!.x + 520, box!.y + 210, { steps: 12 });
    await page.mouse.up();

    await expect(page.locator('.toast')).toHaveCount(0);
    await expect(composition).not.toHaveText(before);
    await expect(page.locator('.constraint-row')).toHaveCount(8);

    await page.mouse.move(box!.x + 300, box!.y + 380);
    await page.mouse.down();
    await page.mouse.move(box!.x + 260, box!.y + 380, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator('.toast')).toHaveCount(0);
  });
  test('chains line segments into a polyline and steps back with Escape', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await page.waitForTimeout(600);

    const topbar = page.locator('.topbar');
    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();
    const line = topbar.getByRole('button', { name: 'Line', exact: true });
    const select = topbar.getByRole('button', { name: 'Select', exact: true });

    await line.click();
    for (const [x, y] of [
      [300, 300],
      [450, 300],
      [600, 400],
    ] as const) {
      await page.mouse.click(box!.x + x, box!.y + y);
      await page.waitForTimeout(320);
    }

    // The second click continues the chain: two lines and a shared vertex.
    const composition = page.locator('.panel-section', { hasText: 'Geometry' });
    await expect(composition.locator('.panel-count')).toHaveText('2');
    await expect(page.locator('.panel-section', { hasText: 'Constraints' })).toContainText(
      'Coincident',
    );

    // First Escape only drops the in-progress point.
    await page.keyboard.press('Escape');
    await expect(line).toHaveAttribute('data-active', 'true');
    // Second Escape returns to Select, the third finishes the sketch.
    await page.keyboard.press('Escape');
    await expect(select).toHaveAttribute('data-active', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('.sketch-overlay')).toHaveCount(0);
  });

  test('flags conflicting constraints and filters them', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    // Entering a sketch animates the camera; wait so clicks map to the settled view.
    await page.waitForTimeout(600);

    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();
    const step = async (x: number, y: number) => {
      await page.mouse.move(box!.x + x, box!.y + y);
      await page.mouse.click(box!.x + x, box!.y + y);
      await page.waitForTimeout(320);
    };
    await page.getByRole('button', { name: 'Line', exact: true }).click();
    await step(300, 300);
    await step(650, 420);

    const topbar = page.locator('.topbar');
    const constraintsButton = topbar.getByRole('button', { name: 'Constraints', exact: true });
    await topbar.getByRole('button', { name: 'Select', exact: true }).click();
    const entityRow = page.locator('.sketch-entity-row').first();
    await entityRow.click();
    await constraintsButton.click();
    await page.getByRole('menuitem', { name: 'Distance', exact: true }).click();
    await expect(page.locator('.constraint-row')).toHaveCount(1);

    await entityRow.click();
    await constraintsButton.click();
    await page.getByRole('menuitem', { name: 'Distance', exact: true }).click();
    await expect(page.locator('.constraint-row')).toHaveCount(2);

    const warning = page.getByTestId('constraint-problems');
    await expect(warning).toBeVisible();
    await expect(page.locator('.constraint-row[data-problem="true"]')).toHaveCount(1);

    await warning.hover();
    await expect(page.getByRole('tooltip')).toContainText('problem constraints');

    await warning.click();
    await expect(page.locator('.constraint-row')).toHaveCount(1);
    await expect(warning).toHaveAttribute('data-active', 'true');

    await warning.click();
    await expect(page.locator('.constraint-row')).toHaveCount(2);

    await page.locator('.constraint-row[data-problem="true"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await expect(warning).toHaveCount(0);
    await expect(page.locator('.constraint-row')).toHaveCount(1);
  });
  test('adds reference measurements and shows live size', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    // Entering a sketch animates the camera; wait so clicks map to the settled view.
    await page.waitForTimeout(600);

    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();
    await page.getByRole('button', { name: 'Line', exact: true }).click();
    await page.mouse.move(box!.x + 300, box!.y + 300);
    await page.mouse.click(box!.x + 300, box!.y + 300);
    await page.mouse.move(box!.x + 600, box!.y + 420);
    await expect(page.getByTestId('sketch-live-measure')).toContainText('mm');
    await page.mouse.click(box!.x + 600, box!.y + 420);
    await expect(page.getByTestId('sketch-live-measure')).toHaveCount(0);

    const row = page.locator('.sketch-entity-row').first();
    const composition = page.locator('.panel-section', { hasText: 'Geometry' });

    await row.click({ button: 'right' });
    await expect(page.locator('.context-menu-heading')).toContainText('Show');
    await page.getByRole('menuitem').nth(0).click();
    await expect(page.locator('.sketch-reference')).toHaveCount(1);

    await row.click({ button: 'right' });
    const angleItem = page.getByRole('menuitem').nth(1);
    await expect(angleItem).toContainText('°');
    await angleItem.click();
    await expect(page.locator('.sketch-reference')).toHaveCount(2);
    await expect(composition).toContainText('°');

    const topbar = page.locator('.topbar');
    await row.click();
    await topbar.getByRole('button', { name: 'Constraints', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Distance', exact: true }).click();
    await expect(page.locator('.constraint-row')).toHaveCount(1);

    // A real dimension wins over the reference of the same measure.
    await expect(page.locator('.sketch-reference')).toHaveCount(1);
    await expect(page.locator('.sketch-annotation:not(.sketch-reference)')).toHaveCount(1);
  });
  test('undoes geometry together with automatic constraints', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    // Entering a sketch animates the camera; wait so clicks map to the settled view.
    await page.waitForTimeout(600);

    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();
    await page.getByRole('button', { name: 'Line', exact: true }).click();
    await page.mouse.move(box!.x + 300, box!.y + 300);
    await page.mouse.click(box!.x + 300, box!.y + 300);
    await page.waitForTimeout(320);
    await page.mouse.move(box!.x + 600, box!.y + 302);
    await page.mouse.click(box!.x + 600, box!.y + 302);

    const constraints = page.locator('.panel-section', { hasText: 'Constraints' });
    await expect(constraints).toContainText('Horizontal');
    await expect(page.locator('.sketch-entity-row')).toHaveCount(1);

    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.locator('.sketch-entity-row')).toHaveCount(0);
    await expect(constraints).toContainText('No constraints yet');

    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(page.locator('.sketch-entity-row')).toHaveCount(1);
    await expect(constraints).toContainText('Horizontal');
  });
  test('shows the state before the edited sketch and locks the timeline', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    // Entering a sketch animates the camera; wait so clicks map to the settled view.
    await page.waitForTimeout(600);

    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();
    await page.getByRole('button', { name: 'Line', exact: true }).click();
    await page.mouse.move(box!.x + 300, box!.y + 300);
    await page.mouse.click(box!.x + 300, box!.y + 300);
    await page.waitForTimeout(300);
    await page.mouse.move(box!.x + 600, box!.y + 300);
    await page.mouse.click(box!.x + 600, box!.y + 300);
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
    await expect(page.locator('.sketch-overlay')).toHaveCount(0);

    await addBox(page);
    const timeline = page.locator('.panel.timeline-panel');
    await expect(page.locator('.tree-row')).toHaveCount(2);
    await expect(timeline).not.toHaveAttribute('data-locked', 'true');
    await expect(page.locator('.timeline-caret').first()).toBeEnabled();

    await page.locator('.tree-row').first().locator('.tree-main').dblclick();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await expect(timeline).toHaveAttribute('data-locked', 'true');
    await expect(page.locator('.timeline-caret').first()).toBeDisabled();
    // Only geometry that existed at the sketch moment stays visible.
    await expect(page.locator('.tree-row')).toHaveCount(1);

    await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
    await expect(timeline).not.toHaveAttribute('data-locked', 'true');
    await expect(page.locator('.timeline-caret').first()).toBeEnabled();
    await expect(page.locator('.tree-row')).toHaveCount(2);
  });
  test('fits the camera to the sketch and refits when switching sketches', async ({ page }) => {
    await openApp(page);
    const cube = page.getByTestId('nav-cube');
    const tools = page.getByRole('navigation', { name: 'Tools' });
    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();
    const distance = async () => Number(await cube.getAttribute('data-distance'));
    const drawLine = async (fromRatio: number, toRatio: number) => {
      await page.getByRole('button', { name: 'Line', exact: true }).click();
      await page.mouse.click(box!.x + box!.width * fromRatio, box!.y + box!.height * 0.5);
      await page.waitForTimeout(300);
      await page.mouse.click(box!.x + box!.width * toRatio, box!.y + box!.height * 0.5);
      await page.waitForTimeout(800);
    };
    const startSketch = async () => {
      await tools.getByRole('button', { name: 'Sketch', exact: true }).click();
      await page.getByRole('menuitem', { name: 'XY plane' }).click();
      await expect(page.locator('.sketch-overlay')).toBeVisible();
      await page.waitForTimeout(500);
    };
    const finishSketch = async () => {
      await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
      await expect(page.locator('.sketch-overlay')).toHaveCount(0);
      await page.waitForTimeout(700);
    };

    await startSketch();
    await drawLine(0.3, 0.4);
    await finishSketch();
    await startSketch();
    await drawLine(0.15, 0.8);
    await finishSketch();

    const modelDistance = await distance();
    const ops = page.locator('.timeline-op');
    await expect(ops).toHaveCount(2);

    await ops.nth(0).dblclick();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await expect.poll(distance).toBeLessThan(modelDistance * 0.8);
    const smallDistance = await distance();

    // Switching sketches refits instead of keeping the previous framing.
    await ops.nth(1).dblclick();
    await expect.poll(distance).toBeGreaterThan(smallDistance * 1.5);

    await finishSketch();
    await expect.poll(distance).toBeCloseTo(modelDistance, 1);
  });
  test('inserts new operations at the timeline cursor', async ({ page }) => {
    await openApp(page);
    await addBox(page);
    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XZ plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    // Entering a sketch animates the camera; wait so clicks map to the settled view.
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
    await expect(page.locator('.sketch-overlay')).toHaveCount(0);

    const ops = page.locator('.timeline-op');
    await expect(ops).toHaveCount(2);

    // Roll the cursor back to just after the box, then add another box.
    await page.locator('.timeline-caret').nth(1).click();
    await expect(page.locator('.timeline-op.muted')).toHaveCount(1);
    await addBox(page);

    await expect(ops).toHaveCount(3);
    await expect(ops.nth(1)).toHaveAttribute('aria-label', 'Box');
    await expect(ops.nth(2)).toHaveAttribute('aria-label', 'Sketch');
    await expect(ops.nth(2)).toHaveClass(/muted/);
    // The new operation becomes the current cursor position.
    await expect(page.locator('.timeline-caret').nth(2)).toHaveAttribute('aria-pressed', 'true');
  });
  test('edits a sketch by double clicking it in the timeline', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    // Entering a sketch animates the camera; wait so clicks map to the settled view.
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
    await expect(page.locator('.sketch-overlay')).toHaveCount(0);

    await addBox(page);
    const ops = page.locator('.timeline-op');
    await expect(ops).toHaveCount(2);

    // Only sketch operations open the editor.
    await ops.nth(1).dblclick();
    await expect(page.locator('.sketch-overlay')).toHaveCount(0);

    await ops.first().dblclick();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await expect(page.locator('.panel.timeline-panel')).toHaveAttribute('data-locked', 'true');
  });
  test('lists the sketch plane as a fixed section while editing a sketch', async ({ page }) => {
    await openApp(page);
    await addBox(page);

    await page.getByRole('button', { name: 'Section', exact: true }).click();
    const planes = page.locator('.section-plane');
    await expect(planes).toHaveCount(1);
    await page.getByRole('button', { name: 'Add plane' }).click();
    await expect(planes).toHaveCount(2);

    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    // Entering a sketch animates the camera; wait so clicks map to the settled view.
    await page.waitForTimeout(600);
    await expect(planes).toHaveCount(3);

    const sketchPlane = planes.first();
    await expect(sketchPlane).toContainText('Sketch plane');
    await expect(sketchPlane.getByRole('button')).toHaveCount(1);
    await expect(sketchPlane.getByRole('textbox')).toHaveCount(0);
    await expect(sketchPlane.getByRole('button', { name: 'Hide plane' })).toBeVisible();

    await sketchPlane.getByRole('button', { name: 'Hide plane' }).click();
    await expect(sketchPlane.getByRole('button', { name: 'Show plane' })).toBeVisible();
    await expect(planes).toHaveCount(3);

    await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
    await expect(page.locator('.sketch-overlay')).toHaveCount(0);
    await expect(planes).toHaveCount(2);
  });
  test('dims unrelated constraints and elements', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    // Entering a sketch animates the camera; wait so clicks map to the settled view.
    await page.waitForTimeout(600);

    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();
    await page.getByRole('button', { name: 'Line', exact: true }).click();
    await page.mouse.click(box!.x + 250, box!.y + 300);
    await page.mouse.click(box!.x + 450, box!.y + 300);
    await page.keyboard.press('Escape');
    await page.mouse.click(box!.x + 250, box!.y + 450);
    await page.mouse.click(box!.x + 450, box!.y + 500);

    const topbar = page.locator('.topbar');
    await topbar.getByRole('button', { name: 'Select', exact: true }).click();
    await page.mouse.click(box!.x + 350, box!.y + 300);
    await topbar.getByRole('button', { name: 'Constraints', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Distance', exact: true }).click();

    await page.locator('.constraint-row').click();
    await expect(page.locator('.constraint-row[data-active="true"]')).toHaveCount(1);
    await expect(page.locator('.sketch-entity-row[data-dimmed="true"]')).toHaveCount(1);

    await page.locator('.sketch-entity-row').nth(1).click();
    await expect(page.locator('.constraint-row[data-dimmed="true"]')).toHaveCount(2);
    await expect(page.locator('.sketch-entity-row[data-dimmed="true"]')).toHaveCount(0);
    expect((await page.locator('.sketch-entity-row').first().innerText()).startsWith('1.')).toBe(
      false,
    );

    await page.locator('.sketch-entity-row').nth(0).click();
    await page.keyboard.down('Shift');
    await page.locator('.sketch-entity-row').nth(1).click();
    await page.keyboard.up('Shift');
    await expect(page.locator('.sketch-entity-row[data-active="true"]')).toHaveCount(2);
    const overflow = await page.evaluate(() => {
      const body = document.querySelector('.panel-body');
      return body ? body.scrollWidth - body.clientWidth : 0;
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
  test('creates a midpoint with point symmetry', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    // Entering a sketch animates the camera; wait so clicks map to the settled view.
    await page.waitForTimeout(600);

    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();
    await page.getByRole('button', { name: 'Point', exact: true }).click();
    await page.mouse.click(box!.x + 300, box!.y + 300);
    await page.mouse.click(box!.x + 500, box!.y + 300);
    await page.mouse.click(box!.x + 400, box!.y + 380);

    const topbar = page.locator('.topbar');
    await topbar.getByRole('button', { name: 'Select', exact: true }).click();
    await page.mouse.click(box!.x + 300, box!.y + 300);
    await page.keyboard.down('Shift');
    await page.mouse.click(box!.x + 500, box!.y + 300);
    await page.mouse.click(box!.x + 400, box!.y + 380);
    await page.keyboard.up('Shift');
    await topbar.getByRole('button', { name: 'Constraints', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Symmetric', exact: true }).click();
    await expect(page.locator('.constraint-list')).toContainText('Symmetric');

    const rows = page.locator('.sketch-entity-row');
    await expect(rows).toHaveCount(3);
    const points = (await rows.allInnerTexts()).map((text) => {
      const match = text.match(/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?) mm/);
      return match ? [Number(match[1]), Number(match[2])] : null;
    });
    expect(points.every(Boolean)).toBe(true);
    const [first, second, middle] = points as [number[], number[], number[]];
    expect(middle[0]).toBeCloseTo((first[0]! + second[0]!) / 2, 0);
    expect(middle[1]).toBeCloseTo((first[1]! + second[1]!) / 2, 0);
  });

  for (const [plane, expected] of [
    ['XZ', /50 × 10 × 49\.9/],
    ['YZ', /10 × 50 × 49\.9/],
  ] as const) {
    test(`extrudes on the ${plane} datum plane`, async ({ page }) => {
      await openApp(page);
      const tools = page.getByRole('navigation', { name: 'Tools' });
      const inspector = page.getByTestId('right');
      const canvas = page.getByTestId('viewport-canvas');

      await tools.getByRole('button', { name: 'Sketch', exact: true }).click();
      await page.getByRole('menuitem', { name: `${plane} plane` }).click();
      await expect(page.locator('.sketch-overlay')).toBeVisible();
      await page.waitForTimeout(600);
      const box = await canvas.boundingBox();
      await page.getByRole('button', { name: 'Circle', exact: true }).click();
      await page.mouse.click(box!.x + 400, box!.y + 300);
      await page.waitForTimeout(320);
      await page.mouse.click(box!.x + 520, box!.y + 300);
      await page.waitForTimeout(320);
      await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
      await expect(page.locator('.sketch-overlay')).toHaveCount(0);

      // The face comes from the tree, which keeps the test off the exact
      // projection of a plane that is edge-on to the camera.
      await page.locator('.tree-row').first().locator('.tree-main').click();
      await inspector.getByText('Face 1').click();
      await tools.getByRole('button', { name: 'Extrude', exact: true }).click();
      await commitOperation(page);
      // Bounds are shown for the created body, not for the operation.
      await page
        .locator('.tree-row')
        .filter({ hasText: 'Body' })
        .last()
        .locator('.tree-main')
        .click();
      await expect.poll(async () => inspector.innerText()).toMatch(expected);
    });
  }

  test('creates an empty extrude and fills it by picking faces in the view', async ({ page }) => {
    await openApp(page);
    const tools = page.getByRole('navigation', { name: 'Tools' });
    const inspector = page.getByTestId('right');
    const canvas = page.getByTestId('viewport-canvas');

    await tools.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await page.waitForTimeout(600);
    const box = await canvas.boundingBox();
    for (const radius of [140, 70]) {
      await page.getByRole('button', { name: 'Circle', exact: true }).click();
      await page.mouse.click(box!.x + 400, box!.y + 300);
      await page.waitForTimeout(320);
      await page.mouse.click(box!.x + 400 + radius, box!.y + 300);
      await page.waitForTimeout(320);
    }
    await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
    await canvas.click({ position: { x: 20, y: 20 } });

    // The tool works without a selection: objects are added afterwards.
    await tools.getByRole('button', { name: 'Extrude', exact: true }).click();
    await expect(inspector.getByText('No faces yet: pick them in the view')).toBeVisible();

    await inspector.getByRole('button', { name: 'Pick faces in the view' }).click();
    await page.waitForTimeout(300);
    // The ring, then the inner disk.
    await page.mouse.click(box!.x + 300, box!.y + 300);
    await page.waitForTimeout(800);
    await page.mouse.click(box!.x + 400, box!.y + 300);
    await page.waitForTimeout(900);
    const rows = inspector.locator('.selection-item');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Face 1');
    await expect(rows.nth(1)).toContainText('Face 2');
    // The ring and the disk share the inner circle, so they fuse into one
    // body; the tree also holds the sketch.
    await expect(page.locator('.tree-row')).toHaveCount(2);

    // Clicking a picked face again removes it, and the row has its own action.
    await page.mouse.click(box!.x + 400, box!.y + 300);
    await page.waitForTimeout(900);
    await expect(rows).toHaveCount(1);
    await rows.first().hover();
    await rows.first().getByRole('button').click();
    await page.waitForTimeout(600);
    await expect(rows).toHaveCount(0);
    await inspector.getByRole('button', { name: 'Finish picking' }).click();
    await expect(inspector.getByText('No faces yet: pick them in the view')).toBeVisible();
  });

  test('adds faces of different bodies without a target list', async ({ page }) => {
    await openApp(page);
    const tools = page.getByRole('navigation', { name: 'Tools' });
    const inspector = page.getByTestId('right');
    const canvas = page.getByTestId('viewport-canvas');

    await tools.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await page.waitForTimeout(600);
    const box = await canvas.boundingBox();
    const centers: [number, number][] = [
      [320, 260],
      [560, 380],
    ];
    for (const [x, y] of centers) {
      await page.getByRole('button', { name: 'Circle', exact: true }).click();
      await page.mouse.click(box!.x + x, box!.y + y);
      await page.waitForTimeout(320);
      await page.mouse.click(box!.x + x + 60, box!.y + y);
      await page.waitForTimeout(320);
    }
    await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
    await expect(page.locator('.sketch-overlay')).toHaveCount(0);

    // Two disjoint circles create two bodies.
    await page.locator('.tree-row').first().locator('.tree-main').click();
    await tools.getByRole('button', { name: 'Extrude', exact: true }).click();
    await expect(page.locator('.tree-row')).toHaveCount(3);

    // Select both sketch faces in the sketch object panel and start an add from
    // them. This avoids screen-coordinate picking after the camera refits.
    await page.locator('.tree-row').first().locator('.tree-main').click();
    const sketchFaces = inspector
      .locator('.panel-section')
      .filter({ hasText: 'Faces' })
      .locator('.selection-item');
    await expect(sketchFaces).toHaveCount(2);
    await sketchFaces.nth(0).click();
    await sketchFaces.nth(1).click({ modifiers: ['Shift'] });
    await tools.getByRole('button', { name: 'Extrude', exact: true }).click();

    // With "all bodies" each face adds material to its own body.
    const facesSection = inspector.locator('.panel-section').filter({ hasText: 'Faces' });
    await expect(facesSection.locator('.selection-item')).toHaveCount(2);
    await expect(inspector.locator('.operation-error')).toHaveCount(0);
    await expect(page.locator('.timeline-op.error')).toHaveCount(0);
    await expect(page.locator('.tree-row')).toHaveCount(3);

    // Choosing only one body explicitly makes the other face's extrusion an
    // independent body, so that face must be reported.
    const bodiesSection = inspector
      .locator('.panel-section')
      .filter({ hasText: 'Apply to bodies' });
    await bodiesSection.getByRole('button', { name: 'Pick bodies in the view' }).click();
    await page.waitForTimeout(800);
    await page
      .getByTestId('left')
      .locator('.tree-row')
      .filter({ hasText: 'Body' })
      .first()
      .locator('.tree-main')
      .click();

    await expect(inspector.locator('.operation-error')).toContainText(
      'Add cannot create a disconnected body',
    );
    await expect(facesSection.locator('.selection-item')).toHaveCount(2);
    await expect(facesSection.locator('.error-badge')).toHaveCount(1);
    await expect(bodiesSection.locator('.selection-item')).toHaveCount(1);
  });

  test('splits intersecting circles into adjacent faces and groups bodies by shared edges', async ({
    page,
  }) => {
    await openApp(page);
    const tools = page.getByRole('navigation', { name: 'Tools' });
    const inspector = page.getByTestId('right');
    const canvas = page.getByTestId('viewport-canvas');

    await tools.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await page.waitForTimeout(600);
    const box = await canvas.boundingBox();
    for (const [x, y] of [
      [380, 300],
      [460, 300],
    ] as const) {
      await page.getByRole('button', { name: 'Circle', exact: true }).click();
      await page.mouse.click(box!.x + x, box!.y + y);
      await page.waitForTimeout(320);
      await page.mouse.click(box!.x + x + 80, box!.y + y);
      await page.waitForTimeout(320);
    }
    await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
    await expect(page.locator('.sketch-overlay')).toHaveCount(0);

    await page.locator('.tree-row').first().locator('.tree-main').click();
    const sketchFaces = inspector
      .locator('.panel-section')
      .filter({ hasText: 'Faces' })
      .locator('.selection-item');
    await expect(sketchFaces).toHaveCount(3);
    const names = await sketchFaces.locator('.tree-name').allInnerTexts();
    expect(names.sort()).toEqual(['Face 1', 'Face 2', 'Face 3']);

    // Even-odd regions: two equal crescents and the smaller lens between them.
    const areaTexts = await sketchFaces.locator('.tree-meta').allInnerTexts();
    const areas = areaTexts.map((text) =>
      Number.parseFloat(text.replace(',', '.').replace(/[^\d.]/g, '')),
    );
    const lensIndex = areas.indexOf(Math.min(...areas));
    const lensName = `Face ${lensIndex + 1}`;
    const sortedAreas = [...areas].sort((left, right) => left - right);
    expect(sortedAreas[0]).toBeLessThan(sortedAreas[1]!);
    expect(sortedAreas[0]).toBeLessThan(sortedAreas[2]!);

    // Each region is picked on its own: same boundary circles, distinct ids.
    await sketchFaces.nth(0).click();
    await expect(sketchFaces.nth(0)).toHaveAttribute('data-active', 'true');
    await expect(sketchFaces.nth(1)).not.toHaveAttribute('data-active', 'true');

    // All three regions share edges, so they fuse into one body.
    await sketchFaces.nth(1).click({ modifiers: ['Shift'] });
    await sketchFaces.nth(2).click({ modifiers: ['Shift'] });
    await tools.getByRole('button', { name: 'Extrude', exact: true }).click();
    await expect(page.locator('.tree-row')).toHaveCount(2);
    await expect(page.locator('.timeline-op.error')).toHaveCount(0);
    await commitOperation(page);
    const bodyRows = page.getByTestId('left').locator('.tree-row').filter({ hasText: 'Body' });
    await expect(bodyRows).toHaveCount(1);
    // The fused body has a single top and a single bottom face, not the three
    // sketch regions that produced it, so it can be extruded again as one face.
    await bodyRows.first().locator('.tree-main').click();
    await expect(
      inspector.locator('.stat-row').filter({ hasText: 'Faces' }).locator('.stat-value'),
    ).toHaveText('4');
    const colorBefore = await bodyRows
      .first()
      .locator('.tree-icon')
      .evaluate((element) => getComputedStyle(element).color);

    // Remove the lens: the two outer crescents no longer share an edge and
    // become two independent bodies.
    await page.locator('.timeline-op').last().click();
    await inspector.getByRole('button', { name: 'Pick faces in the view' }).click();
    const extrusionFaces = inspector
      .locator('.panel-section')
      .filter({ hasText: 'Faces' })
      .locator('.selection-item');
    await expect(extrusionFaces).toHaveCount(3);
    const lensRow = extrusionFaces.filter({ hasText: lensName }).first();
    await lensRow.hover();
    await lensRow.getByRole('button', { name: 'Remove from extrude' }).click();
    await expect(bodyRows).toHaveCount(2);
    await expect(page.locator('.tree-row')).toHaveCount(3);
    await expect(bodyRows.first()).toContainText('Body 1');
    const colorAfter = await bodyRows
      .first()
      .locator('.tree-icon')
      .evaluate((element) => getComputedStyle(element).color);
    expect(colorAfter).toBe(colorBefore);

    // Clicking the sketch in the tree while picking selects the whole sketch,
    // which brings all three adjacencies back into one body.
    await page.locator('.tree-row').first().locator('.tree-main').click();
    await expect(inspector.getByText('Whole sketch')).toBeVisible();
    await expect(
      inspector.locator('.panel-section').filter({ hasText: 'Faces' }).locator('.selection-item'),
    ).toHaveCount(1);
    await expect(bodyRows).toHaveCount(1);
    await expect(page.locator('.tree-row')).toHaveCount(2);
  });

  test('picks a body face, flips the direction and limits target bodies', async ({ page }) => {
    await openApp(page);
    const tools = page.getByRole('navigation', { name: 'Tools' });
    const inspector = page.getByTestId('right');
    const canvas = page.getByTestId('viewport-canvas');

    await addBox(page);
    await tools.getByRole('button', { name: 'Extrude', exact: true }).click();
    await expect(inspector.getByText('No faces yet: pick them in the view')).toBeVisible();

    await inspector.getByRole('button', { name: 'Pick faces in the view' }).click();
    await page.waitForTimeout(300);
    const box = await canvas.boundingBox();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    const objects = inspector
      .locator('.panel-section')
      .filter({ hasText: 'Faces' })
      .locator('.selection-item');
    await expect(objects).toHaveCount(1);
    await expect(objects.first()).toContainText(/Face \d+/);
    await expect(
      objects.first().getByRole('button', { name: 'Remove from extrude' }),
    ).toBeVisible();

    // Leaving picking makes the list read-only again.
    await inspector.getByRole('button', { name: 'Finish picking' }).click();
    await expect(objects.first().getByRole('button', { name: 'Remove from extrude' })).toHaveCount(
      0,
    );

    // A body target list sits before the faces list; empty means every body.
    const bodiesSection = inspector
      .locator('.panel-section')
      .filter({ hasText: 'Apply to bodies' });
    await expect(bodiesSection).toBeVisible();
    await expect(inspector.getByText('No bodies selected')).toBeVisible();
    await expect(bodiesSection.locator('.selection-item')).toHaveCount(0);
    await expect.poll(async () => inspector.innerText()).not.toContain('no solid geometry');

    await bodiesSection.getByRole('button', { name: 'Pick bodies in the view' }).click();
    // Wait for the preview rebuild: picking is ignored while the model is busy.
    await page.waitForTimeout(800);
    // Picking happens in 3D and must not replace the selected operation.
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    const targets = bodiesSection.locator('.selection-item');
    await expect(targets).toHaveCount(1);
    await expect(targets.first()).toContainText('Box');
    await expect(inspector.getByText('Operation', { exact: true })).toBeVisible();

    // Selection from the timeline is routed to the picker instead of replacing
    // the selected operation.
    await page.locator('.timeline-op').first().click();
    await expect(inspector.getByText('Operation', { exact: true })).toBeVisible();

    // Body rows are read-only outside body picking too.
    await bodiesSection.getByRole('button', { name: 'Finish picking' }).click();
    await expect(bodiesSection.getByRole('button', { name: 'Remove from extrude' })).toHaveCount(0);

    const reverse = inspector.getByRole('button', { name: 'Reverse direction' });
    await reverse.click();
    await expect(reverse).toHaveAttribute('data-active', 'true');

    // Add forbids through-all, so the option is absent rather than disabled.
    await expect(inspector.getByRole('button', { name: 'Through all', exact: true })).toHaveCount(
      0,
    );
    const second = inspector.getByRole('switch', { name: 'Second direction' });
    await second.click();
    await expect(second).toHaveAttribute('aria-checked', 'true');
    await expect(inspector.getByRole('button', { name: 'Through all', exact: true })).toHaveCount(
      0,
    );

    // Symmetric already goes both ways, so direction controls disappear but the
    // distance stays editable.
    await inspector.getByRole('button', { name: 'Symmetric', exact: true }).click();
    await expect(inspector.getByRole('textbox', { name: 'Distance' })).toBeVisible();
    await expect(inspector.getByRole('button', { name: 'Reverse direction' })).toHaveCount(0);
    await expect(inspector.getByText('Second direction')).toHaveCount(0);
  });

  test('rejects an add that would create a disconnected body', async ({ page }) => {
    await openApp(page);
    const tools = page.getByRole('navigation', { name: 'Tools' });
    const inspector = page.getByTestId('right');
    const canvas = page.getByTestId('viewport-canvas');
    await addBox(page);

    await tools.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await page.waitForTimeout(600);
    const box = await canvas.boundingBox();
    await page.getByRole('button', { name: 'Circle', exact: true }).click();
    await page.mouse.click(box!.x + 400, box!.y + 300);
    await page.waitForTimeout(320);
    await page.mouse.click(box!.x + 460, box!.y + 300);
    await page.waitForTimeout(320);
    await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
    await expect(page.locator('.sketch-overlay')).toHaveCount(0);

    // Move the sketch well above the box so the extrusion cannot touch it.
    await page.locator('.timeline-op').last().click();
    const offset = inspector.getByRole('textbox', { name: 'Offset' });
    await offset.fill('40');
    await offset.press('Enter');
    await page.waitForTimeout(300);
    await commitOperation(page);

    await page.locator('.tree-row').last().locator('.tree-main').click();
    await tools.getByRole('button', { name: 'Extrude', exact: true }).click();
    // With "all bodies" an extrusion that touches nothing is skipped, so only
    // "no target" remains.
    await expect(inspector.getByText('No body to apply this operation to')).toBeVisible();
    await expect(inspector.getByText('Error', { exact: true })).toBeVisible();

    // No bodies were selected explicitly, so the list stays empty and only the
    // informational sentence is shown.
    const bodiesSection = inspector
      .locator('.panel-section')
      .filter({ hasText: 'Apply to bodies' });
    await expect(bodiesSection.locator('.selection-item')).toHaveCount(0);
    await expect(inspector.getByText('No bodies selected')).toBeVisible();

    // Picking the far body explicitly makes the disconnected union an error
    // again, because an explicitly chosen body must take the operation.
    await bodiesSection.getByRole('button', { name: 'Pick bodies in the view' }).click();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(inspector.getByText('Add cannot create a disconnected body')).toBeVisible();
    await expect(inspector.locator('.operation-error')).toContainText(
      'Add cannot create a disconnected body',
    );
    await expect(bodiesSection.locator('.selection-item')).toHaveCount(1);
    await expect(bodiesSection.locator('.error-badge')).toHaveCount(1);
    await expect(page.locator('.tree-row')).toHaveCount(2);

    // The failed operation is red without a separate badge, and the timeline
    // cannot move past it.
    const errorOp = page.locator('.timeline-op.error');
    await expect(errorOp).toHaveCount(1);
    await expect(errorOp).toHaveClass(/selected/);
    await expect(errorOp.locator('.tree-badge')).toHaveCount(0);

    const carets = page.locator('.timeline-caret');
    // Editing the failed operation does not move the document cursor, so it
    // stays where the user left it: the red barrier straight after the failure.
    const blocked = carets.nth(3);
    await expect(blocked).toHaveClass(/error/);
    await expect(blocked).toBeDisabled();
    await expect(blocked).toHaveAttribute('aria-pressed', 'true');
    await expect(carets.nth(2)).not.toHaveClass(/active/);

    // An operation after the failure gets a plain inactive cursor, not red.
    await page.getByRole('button', { name: 'Add object' }).click();
    await page.getByRole('menuitem', { name: 'Box' }).click();
    await expect(page.locator('.timeline-op')).toHaveCount(4);
    await commitOperation(page);
    const past = page.locator('.timeline-caret').nth(4);
    await expect(past).not.toHaveClass(/error/);
    await expect(past).not.toHaveClass(/active/);
    await expect(past).toBeDisabled();

    // Moving back to just before the failed operation is allowed.
    await carets.nth(2).click();
    await expect(carets.nth(2)).toHaveClass(/active/);
    await expect(page.locator('.timeline-caret.error')).toHaveCount(0);
  });

  for (const [title, centers, expected] of [
    [
      'disjoint circles become separate bodies',
      [
        [320, 260],
        [560, 380],
      ],
      ['Body 1', 'Body 2'],
    ],
    [
      'concentric circles stay one body',
      [
        [440, 300],
        [440, 300],
      ],
      ['Body'],
    ],
  ] as const) {
    test(title, async ({ page }) => {
      await openApp(page);
      const tools = page.getByRole('navigation', { name: 'Tools' });
      const canvas = page.getByTestId('viewport-canvas');
      await tools.getByRole('button', { name: 'Sketch', exact: true }).click();
      await page.getByRole('menuitem', { name: 'XY plane' }).click();
      await expect(page.locator('.sketch-overlay')).toBeVisible();
      await page.waitForTimeout(600);
      const box = await canvas.boundingBox();
      for (const [x, y] of centers) {
        await page.getByRole('button', { name: 'Circle', exact: true }).click();
        await page.mouse.click(box!.x + x, box!.y + y);
        await page.waitForTimeout(320);
        await page.mouse.click(box!.x + x + (title.startsWith('disjoint') ? 60 : 90), box!.y + y);
        await page.waitForTimeout(320);
      }
      await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
      await expect(page.locator('.sketch-overlay')).toHaveCount(0);

      await page.locator('.tree-row').first().locator('.tree-main').click();
      await tools.getByRole('button', { name: 'Extrude', exact: true }).click();

      const rows = page.locator('.tree-row');
      await expect(rows).toHaveCount(expected.length + 1);
      for (const [index, name] of expected.entries()) {
        await expect(rows.nth(index + 1)).toContainText(name);
      }
    });
  }

  test('numbers and colours bodies across operations', async ({ page }) => {
    await openApp(page);
    const tools = page.getByRole('navigation', { name: 'Tools' });
    const inspector = page.getByTestId('right');
    await tools.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await page.waitForTimeout(600);
    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();
    await page.getByRole('button', { name: 'Circle', exact: true }).click();
    await page.mouse.click(box!.x + 400, box!.y + 300);
    await page.waitForTimeout(320);
    await page.mouse.click(box!.x + 480, box!.y + 300);
    await page.waitForTimeout(320);
    await page.getByRole('button', { name: 'Finish sketch', exact: true }).click();
    await expect(page.locator('.sketch-overlay')).toHaveCount(0);

    const rows = page.locator('.tree-row');
    await page.locator('.tree-row').first().locator('.tree-main').click();
    await tools.getByRole('button', { name: 'Extrude', exact: true }).click();
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText('Body 1');

    // A second operation that creates a body continues the numbering instead of
    // starting from one again.
    await page.locator('.tree-row').first().locator('.tree-main').click();
    await tools.getByRole('button', { name: 'Extrude', exact: true }).click();
    await inspector.getByRole('button', { name: 'New body', exact: true }).click();
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(2)).toContainText('Body 2');

    const iconColor = async (index: number) =>
      rows
        .nth(index)
        .locator('.tree-icon')
        .evaluate((element) => getComputedStyle(element).color);
    expect(await iconColor(1)).not.toBe(await iconColor(2));
  });

  test('moves the view with the sketch when its plane changes', async ({ page }) => {
    await openApp(page);
    const tools = page.getByRole('navigation', { name: 'Tools' });
    const canvas = page.getByTestId('viewport-canvas');
    await tools.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await page.waitForTimeout(600);
    const box = await canvas.boundingBox();
    await page.getByRole('button', { name: 'Circle', exact: true }).click();
    await page.mouse.click(box!.x + 400, box!.y + 300);
    await page.waitForTimeout(320);
    await page.mouse.click(box!.x + 520, box!.y + 300);
    await page.waitForTimeout(320);

    // The camera follows the sketch: XZ is the front view, so the polar angle
    // moves to the horizon instead of staying top-down.
    const navCube = page.getByTestId('nav-cube');
    await expect
      .poll(async () => Number(await navCube.getAttribute('data-polar')))
      .toBeLessThan(0.01);
    await page
      .getByRole('group', { name: 'Plane', exact: true })
      .getByRole('button', { name: 'XZ', exact: true })
      .click();
    await page.waitForTimeout(1400);
    await expect
      .poll(async () => Number(await navCube.getAttribute('data-polar')))
      .toBeGreaterThan(1.5);
  });
});
