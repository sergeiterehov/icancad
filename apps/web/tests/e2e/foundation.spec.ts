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
}

test.describe('ICANCad foundation', () => {
  test('creates, edits, persists and round-trips a project file', async ({ page }) => {
    await openApp(page);
    await addBox(page);

    await expect(page.getByText('Faces')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hide' }).first()).toBeVisible();

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

  test('imports and exports STL meshes', async ({ page }) => {
    await openApp(page);
    await page.setInputFiles('[data-testid="import-mesh"]', {
      name: 'cube.stl',
      mimeType: 'model/stl',
      buffer: cubeStl(20),
    });

    await expect(
      page.getByTestId('left').getByRole('button', { name: 'cube', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('20 × 20 × 20 mm')).toBeVisible();
    await expect(page.getByText('Imported mesh')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('menuitem', { name: 'STL', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('untitled-project.stl');

    await expect(page.getByTestId('save-state')).toHaveAttribute('data-state', 'saved');
    await page.reload();
    const restored = page.getByTestId('left').getByRole('button', { name: 'cube', exact: true });
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
    await expect(page.locator('.dimension-field')).toHaveCount(3);
    await expect(page.locator('.dimension-unit')).toHaveCount(3);

    const bodyRows = page.locator('.tree-row');
    await expect(bodyRows).toHaveCount(2);
    await bodyRows.first().click();
    await expect(page.locator('.timeline-op.dimmed')).toHaveCount(1);

    await page.locator('.timeline-op').first().click();
    await expect(page.locator('.timeline-op.selected')).toHaveCount(1);
    await expect(page.locator('.timeline-op.dimmed')).toHaveCount(0);
    await bodyRows.nth(1).click({ modifiers: ['Meta'] });
    await expect(page.locator('.selection-item')).toHaveCount(2);

    await bodyRows.first().click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Delete operation' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();

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
    await expect(page.getByText('Инспектор')).toBeVisible();
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
    await expect(page.getByTestId('right').getByText('Выбрано', { exact: true })).toBeVisible();
    await page.mouse.click(canvasBox!.x + 18, canvasBox!.y + 18);
    await expect(page.getByTestId('right').getByText('Проект', { exact: true })).toBeVisible();
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
  test('imports OBJ meshes', async ({ page }) => {
    await openApp(page);
    await page.setInputFiles('[data-testid="import-mesh"]', {
      name: 'cube.obj',
      mimeType: 'text/plain',
      buffer: cubeObj(20),
    });

    await expect(
      page.getByTestId('left').getByRole('button', { name: 'cube', exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId('left').locator('.tree-row')).toHaveCount(1);
    await expect(page.getByText('20 × 20 × 20 mm')).toBeVisible();
    await expect(page.getByText('Imported mesh')).toBeVisible();
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
    await page.getByRole('menuitem', { name: 'STL', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('untitled-project.stl');

    await expect(page.getByTestId('save-state')).toHaveAttribute('data-state', 'saved');
    await page.reload();
    await expect(page.getByTestId('left').locator('.tree-row')).toHaveCount(1, {
      timeout: 120_000,
    });
  });
  test('creates and edits a sketch on a datum plane', async ({ page }) => {
    await openApp(page);
    const cube = page.getByTestId('nav-cube');
    const azimuthBefore = Number(await cube.getAttribute('data-azimuth'));
    const polarBefore = Number(await cube.getAttribute('data-polar'));

    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await expect(page.locator('.tree-row')).toHaveCount(1);

    await page.getByRole('button', { name: 'Line', exact: true }).click();
    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();
    await page.mouse.click(box!.x + 260, box!.y + 320);
    await page.mouse.click(box!.x + 470, box!.y + 440);
    await expect(page.locator('.tree-row').first()).toContainText('1');

    const topbar = page.locator('.topbar');
    await topbar.getByRole('button', { name: 'Select', exact: true }).click();
    const deleteButton = topbar.getByRole('button', { name: 'Delete', exact: true });
    await expect(deleteButton).toBeDisabled();
    await page.locator('.sketch-entity-row').click();
    await expect(deleteButton).toBeEnabled();
    await expect(page.getByText('Composition')).toBeVisible();
    await expect(page.getByText('Constraints').first()).toBeVisible();

    await page.getByRole('button', { name: 'Finish sketch' }).click();
    await expect(page.locator('.sketch-overlay')).toHaveCount(0);
    await expect(page.locator('.tree-row').first()).toContainText('1');
    await expect
      .poll(async () => Math.abs(Number(await cube.getAttribute('data-azimuth')) - azimuthBefore))
      .toBeLessThan(0.001);
    await expect
      .poll(async () => Math.abs(Number(await cube.getAttribute('data-polar')) - polarBefore))
      .toBeLessThan(0.001);

    const sketchRow = page.locator('.tree-row').first();
    await sketchRow.getByRole('button', { name: 'Hide', exact: true }).click();
    await expect(sketchRow.getByRole('button', { name: 'Show', exact: true })).toBeVisible();
    await sketchRow.getByRole('button', { name: 'Show', exact: true }).click();

    await sketchRow.locator('.tree-main').dblclick();
    await expect(page.locator('.sketch-overlay')).toBeVisible();
    await expect(sketchRow).toContainText('1');
  });
  test('solves constraints and drags sketch handles', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();

    await page.getByRole('button', { name: 'Line', exact: true }).click();
    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();
    await page.mouse.click(box!.x + 260, box!.y + 320);
    await page.mouse.click(box!.x + 470, box!.y + 440);
    const topbar = page.locator('.topbar');
    await topbar.getByRole('button', { name: 'Select', exact: true }).click();

    const composition = page.locator('.panel-section', { hasText: 'Composition' });
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
    await topbar.getByRole('button', { name: 'Section', exact: true }).click();
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

    await magnet.click();
    await expect(magnet).not.toHaveAttribute('data-active', 'true');
    await page.mouse.click(box!.x + 305, box!.y + 305);
    await page.mouse.click(box!.x + 650, box!.y + 500);
    await expect(page.locator('.constraint-row')).toHaveCount(1);

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
  test('dims unrelated constraints and elements', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Sketch', exact: true }).click();
    await page.getByRole('menuitem', { name: 'XY plane' }).click();
    await expect(page.locator('.sketch-overlay')).toBeVisible();

    const canvas = page.getByTestId('viewport-canvas');
    const box = await canvas.boundingBox();
    await page.getByRole('button', { name: 'Line', exact: true }).click();
    await page.mouse.click(box!.x + 250, box!.y + 300);
    await page.mouse.click(box!.x + 450, box!.y + 300);
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
});
