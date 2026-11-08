import { expect, test, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Geometry pipeline check' })).toBeVisible({
    timeout: 120_000,
  });
}

async function addBox(page: Page) {
  await page.getByRole('button', { name: 'Add body' }).click();
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
    await page.getByRole('button', { name: 'Export .icad' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('untitled-project.icad');
    const projectFile = await download.path();
    expect(projectFile).toBeTruthy();

    await width.fill('40');
    await width.press('Enter');
    await expect(page.getByText('40 × 20 × 20 mm')).toBeVisible();

    await page.locator('input[type=file]').setInputFiles(projectFile!);
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

  test('supports rollback, language switching and themes', async ({ page }) => {
    await openApp(page);
    await addBox(page);

    await page.getByRole('button', { name: 'Add body' }).click();
    await expect(page.locator('.timeline-op')).toHaveCount(2);

    await page.getByTestId('kernel-state').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Version');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    const cube = page.getByTestId('nav-cube');
    await expect(cube).toBeVisible();
    const cubeBox = await cube.boundingBox();
    await page.mouse.move(
      cubeBox!.x + cubeBox!.width / 2,
      cubeBox!.y + cubeBox!.height / 2,
    );
    await expect(page.getByRole('tooltip')).toContainText('Drag the cube to orbit');

    const azimuthBefore = Number(await cube.getAttribute('data-azimuth'));
    await page.mouse.click(
      cubeBox!.x + cubeBox!.width * 0.52,
      cubeBox!.y + cubeBox!.height * 0.3,
    );
    await expect
      .poll(async () => Number(await cube.getAttribute('data-azimuth')))
      .not.toBe(azimuthBefore);

    const dragStart = Number(await cube.getAttribute('data-azimuth'));
    await page.mouse.move(cubeBox!.x + cubeBox!.width / 2, cubeBox!.y + cubeBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      cubeBox!.x + cubeBox!.width / 2 + 32,
      cubeBox!.y + cubeBox!.height / 2,
      { steps: 6 },
    );
    await page.mouse.up();
    await expect
      .poll(async () => Number(await cube.getAttribute('data-azimuth')))
      .not.toBe(dragStart);

    await cube.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Isometric' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Top' })).toContainText('+Z');
    await page.getByRole('menuitem', { name: 'Top' }).click();
    await expect
      .poll(async () => Number(await cube.getAttribute('data-polar')))
      .toBeLessThan(0.01);
    await expect(page.locator('.dimension-field')).toHaveCount(3);
    await expect(page.locator('.dimension-unit')).toHaveCount(3);

    const bodyRows = page.locator('.tree-row');
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
    await page.locator('.timeline-caret').last().click();
    await expect(page.locator('.timeline-op.muted')).toHaveCount(0);

    await page.locator('.timeline-caret').first().click();
    await expect(page.locator('.timeline-op.muted')).toHaveCount(2);
    await page.locator('.timeline-caret').last().click();
    await expect(page.locator('.timeline-op.muted')).toHaveCount(0);

    await page.getByRole('button', { name: 'Language' }).click();
    await page.getByRole('menuitem', { name: 'Русский' }).click();
    await expect(page.getByText('Инспектор')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Светлая' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.getByRole('button', { name: 'Тёмная' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.getByRole('button', { name: 'Добавить тело' }).hover();
    await expect(page.getByRole('tooltip')).toHaveText('Добавить тело');

    const canvas = page.getByTestId('viewport-canvas');
    const canvasBox = await canvas.boundingBox();
    await page.mouse.click(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height / 2);
    await expect(page.getByTestId('right').getByText('Выбрано', { exact: true })).toBeVisible();
    await page.mouse.click(canvasBox!.x + 18, canvasBox!.y + 18);
    await expect(page.getByTestId('right').getByText('Проект', { exact: true })).toBeVisible();
  });
});
