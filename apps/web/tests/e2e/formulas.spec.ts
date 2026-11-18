import { expect, test, type Page } from '@playwright/test';

const DOC = 'http://127.0.0.1:5173/src/stores/documentStore.ts';
const FORMULA = 'http://127.0.0.1:5173/src/stores/formulaStore.ts';
const KERNEL = 'http://127.0.0.1:5173/src/stores/kernelStore.ts';
const UI = 'http://127.0.0.1:5173/src/stores/uiStore.ts';
const PLANES = 'http://127.0.0.1:5173/src/sketch/sectionPlane.ts';
const HANDLE = 'http://127.0.0.1:5173/src/viewport/handle.ts';

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-skeleton')).toHaveCount(0, { timeout: 120_000 });
  await expect(page.getByTestId('viewport-skeleton')).toHaveCount(0, { timeout: 120_000 });
  await expect
    .poll(
      async () =>
        page.evaluate(async (href) => {
          const mod = await import(href);
          return mod.useDocumentStore.getState().hydrated;
        }, DOC),
      { timeout: 120_000 },
    )
    .toBe(true);
  await expect
    .poll(
      async () =>
        page.evaluate(async (href) => {
          const mod = await import(href);
          return mod.useFormulaStore.getState().status;
        }, FORMULA),
      { timeout: 120_000 },
    )
    .toBe('ready');
}

async function addVariableAndCube(page: Page): Promise<string> {
  return page.evaluate(
    async ({ docHref }) => {
      const doc = await import(docHref);
      doc.useDocumentStore.getState().apply({
        type: 'variable/add',
        variable: { id: 'var_width', name: 'width', type: 'number', source: '20' },
      });
      const id = doc.useDocumentStore.getState().addPrimitive('Cube', 'box');
      doc.useDocumentStore.getState().setFeatureParameter(id, 'params.dx', {
        formula: 'width * 2',
      });
      // Leave the operation: the body then belongs to the history and the
      // rebuild publishes it as a mesh, not as an edit preview.
      doc.useDocumentStore.getState().endFeatureEdit();
      return id;
    },
    { docHref: DOC },
  );
}

async function resolvedParam(page: Page, featureId: string, key: string): Promise<unknown> {
  return page.evaluate(
    async ({ formulaHref, id, param }) => {
      const mod = await import(formulaHref);
      const feature = mod.useFormulaStore
        .getState()
        .resolution?.model.features.find((candidate: { id: string }) => candidate.id === id);
      return feature?.params?.[param];
    },
    { formulaHref: FORMULA, id: featureId, param: key },
  );
}

async function sceneVersion(page: Page): Promise<number> {
  return page.evaluate(async (href) => {
    const mod = await import(href);
    return mod.useKernelStore.getState().sceneVersion;
  }, KERNEL);
}

test.describe('formulas', () => {
  test('resolves a parameter formula and rebuilds the body', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openApp(page);
    const id = await addVariableAndCube(page);

    await expect.poll(async () => resolvedParam(page, id, 'dx'), { timeout: 60_000 }).toBe(40);
    await expect
      .poll(
        async () =>
          page.evaluate(async (href) => {
            const mod = await import(href);
            const meshes = mod.useKernelStore.getState().meshes as Record<
              string,
              { bbox: { min: number[]; max: number[] } }
            >;
            return Object.values(meshes).some(
              (mesh) => Math.abs((mesh.bbox.max[0] ?? 0) - (mesh.bbox.min[0] ?? 0) - 40) < 0.5,
            );
          }, KERNEL),
        { timeout: 60_000 },
      )
      .toBe(true);
    expect(errors).toEqual([]);
  });

  test('model variables resolve after project variables and drive parameters', async ({ page }) => {
    await openApp(page);
    const { featureId } = await page.evaluate(async (docHref) => {
      const doc = await import(docHref);
      const state = doc.useDocumentStore.getState();
      state.apply({
        type: 'variable/add',
        variable: { id: 'var_pwidth', name: 'pwidth', type: 'number', source: '10' },
      });
      const modelId = doc.useDocumentStore.getState().project.activeSuperObjectId;
      doc.useDocumentStore.getState().apply({
        type: 'model-variable/add',
        modelId,
        variable: { id: 'var_mheight', name: 'mheight', type: 'number', source: 'pwidth * 2' },
      });
      // A project expression must not see a model variable.
      doc.useDocumentStore.getState().apply({
        type: 'variable/add',
        variable: { id: 'var_bad', name: 'bad', type: 'number', source: 'mheight' },
      });
      const id = doc.useDocumentStore.getState().addPrimitive('Cube', 'box');
      doc.useDocumentStore.getState().setFeatureParameter(id, 'params.dx', {
        formula: 'mheight',
      });
      doc.useDocumentStore.getState().endFeatureEdit();
      doc.useDocumentStore.getState().select(null);
      return { featureId: id };
    }, DOC);

    await expect
      .poll(async () => resolvedParam(page, featureId, 'dx'), { timeout: 60_000 })
      .toBe(20);
    await expect
      .poll(
        async () =>
          page.evaluate(async (href) => {
            const mod = await import(href);
            const resolution = mod.useFormulaStore.getState().resolution;
            return {
              model: resolution?.variableValues.mheight,
              error: resolution?.variableErrors.bad?.code,
            };
          }, FORMULA),
        { timeout: 60_000 },
      )
      .toEqual({ model: 20, error: 'UNKNOWN_NAME' });
    const inspector = page.getByTestId('inspector');
    await expect(inspector.locator('.panel-header').first()).toHaveText('Model');
    await expect(inspector.locator('.panel-context-header')).toHaveText('Project');
    await expect(page.locator('[data-testid="model-variables-section"]')).toContainText('mheight');
    await expect(page.locator('[data-testid="variables-section"]')).toContainText('pwidth');
  });

  test('a literal edit reaches the resolved model and triggers a rebuild', async ({ page }) => {
    await openApp(page);
    const id = await addVariableAndCube(page);
    await expect.poll(async () => resolvedParam(page, id, 'dx'), { timeout: 60_000 }).toBe(40);
    const before = await sceneVersion(page);

    await page.evaluate(
      async ({ docHref, featureId }) => {
        const doc = await import(docHref);
        doc.useDocumentStore.getState().setFeatureParameter(featureId, 'params.dy', 30);
      },
      { docHref: DOC, featureId: id },
    );

    await expect.poll(async () => resolvedParam(page, id, 'dy'), { timeout: 60_000 }).toBe(30);
    await expect.poll(async () => sceneVersion(page), { timeout: 60_000 }).toBeGreaterThan(before);
  });

  test('a driven sketch dimension shows in the editor and solves', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openApp(page);
    const sketchId = await page.evaluate(
      async ({ docHref, uiHref }) => {
        const doc = await import(docHref);
        const ui = await import(uiHref);
        doc.useDocumentStore.getState().apply({
          type: 'variable/add',
          variable: { id: 'var_width', name: 'width', type: 'number', source: '14' },
        });
        const id = doc.useDocumentStore.getState().addSketch('Sketch', 'XY');
        const state = doc.useDocumentStore.getState();
        const sketch = state.project.superObjects[0].features.find(
          (candidate: { id: string }) => candidate.id === id,
        );
        state.apply({
          type: 'feature/replace',
          feature: {
            ...sketch,
            entities: [
              { id: 'entity_1', type: 'line', construction: false, x1: 0, y1: 0, x2: 40, y2: 0 },
            ],
            constraints: [
              {
                id: 'cons_1',
                type: 'distance',
                refs: [
                  { entityId: 'entity_1', pointIndex: 0 },
                  { entityId: 'entity_1', pointIndex: 1 },
                ],
                value: { formula: 'width' },
              },
            ],
          },
        });
        ui.useUiStore.getState().setActiveSketch(id);
        return id;
      },
      { docHref: DOC, uiHref: UI },
    );

    await expect
      .poll(
        async () =>
          page.evaluate(async (href) => {
            const mod = await import(href);
            return mod.useUiStore.getState().activeSketchId;
          }, UI),
        { timeout: 60_000 },
      )
      .toBe(sketchId);
    await expect
      .poll(
        async () =>
          page.evaluate(async (href) => {
            const mod = await import(href);
            return mod.useUiStore.getState().activeSketchReady;
          }, UI),
        { timeout: 60_000 },
      )
      .toBe(true);
    // The driven length reached the solver as 14, so the line did not collapse
    // to a point or stay at its drawn length.
    await expect
      .poll(
        async () =>
          page.evaluate(
            async ({ docHref, featureId }) => {
              const doc = await import(docHref);
              const state = doc.useDocumentStore.getState();
              const sketch = state.project.superObjects
                .flatMap(
                  (object: { features: { id: string; entities: { type: string }[] }[] }) =>
                    object.features,
                )
                .find((feature: { id: string }) => feature.id === featureId);
              const line = sketch?.entities.find(
                (entity: { type: string }) => entity.type === 'line',
              ) as { x1: number; y1: number; x2: number; y2: number } | undefined;
              return line ? Math.hypot(line.x2 - line.x1, line.y2 - line.y1) : 0;
            },
            { docHref: DOC, featureId: sketchId },
          ),
        { timeout: 60_000 },
      )
      .toBeGreaterThan(13.9);
    // Dragging an endpoint reaches the solver with the resolved length, not
    // with the authored formula object, so the constraint still holds.
    const draggedFrom = await page.evaluate(
      async ({ docHref, planesHref, handleHref, featureId }) => {
        const doc = await import(docHref);
        const planes = await import(planesHref);
        const handle = await import(handleHref);
        const state = doc.useDocumentStore.getState();
        const sketch = state.project.superObjects
          .flatMap((object: { features: { id: string }[] }) => object.features)
          .find((feature: { id: string }) => feature.id === featureId);
        const line = sketch.entities.find((entity: { type: string }) => entity.type === 'line');
        const frame = planes.computeSketchFrame(sketch);
        const point = handle.getViewport()?.projectSketchPoint(frame, [line.x2, line.y2]);
        return point ? { ...point, x2: line.x2, y2: line.y2 } : null;
      },
      { docHref: DOC, planesHref: PLANES, handleHref: HANDLE, featureId: sketchId },
    );
    expect(draggedFrom).not.toBeNull();
    await page.mouse.move(draggedFrom!.x, draggedFrom!.y);
    await page.mouse.down();
    await page.mouse.move(draggedFrom!.x + 20, draggedFrom!.y + 15, { steps: 8 });
    await page.mouse.move(draggedFrom!.x + 40, draggedFrom!.y + 30, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          page.evaluate(
            async ({ docHref, featureId, x2, y2 }) => {
              const doc = await import(docHref);
              const state = doc.useDocumentStore.getState();
              const sketch = state.project.superObjects
                .flatMap((object: { features: { id: string }[] }) => object.features)
                .find((feature: { id: string }) => feature.id === featureId);
              const line = sketch?.entities.find(
                (entity: { type: string }) => entity.type === 'line',
              );
              if (!line) return false;
              const moved = Math.hypot(line.x2 - x2, line.y2 - y2) > 0.5;
              const length = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
              return moved && Math.abs(length - 14) < 0.1;
            },
            { docHref: DOC, featureId: sketchId, x2: draggedFrom!.x2, y2: draggedFrom!.y2 },
          ),
        { timeout: 60_000 },
      )
      .toBe(true);
    await expect.poll(async () => page.locator('.sketch-annotation').count()).toBe(1);
    await expect(page.locator('.sketch-annotation')).toContainText('14 mm');
    const drivenValue = page.locator('.constraint-list .constraint-value-text.is-formula');
    await expect(drivenValue).toHaveCount(1);
    // Editing a driven dimension opens its formula, not the number it produced.
    await page.locator('.sketch-annotation').dblclick({ force: true });
    const editor = page.locator('.sketch-annotation-input');
    await expect(editor).toHaveValue('=width');
    // A phone must offer letters and "=" here, not a numeric pad.
    await expect(editor).toHaveAttribute('inputmode', 'text');

    // Entering the number the formula computes still replaces the formula.
    await editor.fill('14');
    await editor.press('Enter');
    await expect
      .poll(
        async () =>
          page.evaluate(
            async ({ docHref, featureId }) => {
              const doc = await import(docHref);
              const state = doc.useDocumentStore.getState();
              const sketch = state.project.superObjects
                .flatMap(
                  (object: { features: { id: string; constraints: { value: unknown }[] }[] }) =>
                    object.features,
                )
                .find((feature: { id: string }) => feature.id === featureId);
              return sketch?.constraints[0]?.value;
            },
            { docHref: DOC, featureId: sketchId },
          ),
        { timeout: 60_000 },
      )
      .toBe(14);
    await expect(drivenValue).toHaveCount(0);
    await page.locator('.sketch-annotation').dblclick({ force: true });
    await expect(page.locator('.sketch-annotation-input')).toHaveValue('14');
    await page.locator('.sketch-annotation-input').press('Escape');

    expect(errors).toEqual([]);
  });

  test('a constraint formula error shows as a red dash with an error badge', async ({ page }) => {
    await openApp(page);
    const sketchId = await page.evaluate(
      async ({ docHref, uiHref }) => {
        const doc = await import(docHref);
        const ui = await import(uiHref);
        const id = doc.useDocumentStore.getState().addSketch('Error sketch', 'XY');
        const project = doc.useDocumentStore.getState().project;
        const sketch = project.superObjects[0].features.find(
          (feature: { id: string }) => feature.id === id,
        );
        doc.useDocumentStore.getState().apply({
          type: 'feature/replace',
          feature: {
            ...sketch,
            entities: [
              { id: 'error_line', type: 'line', construction: false, x1: 0, y1: 0, x2: 30, y2: 0 },
            ],
            constraints: [
              {
                id: 'error_distance',
                type: 'distance',
                refs: [
                  { entityId: 'error_line', pointIndex: 0 },
                  { entityId: 'error_line', pointIndex: 1 },
                ],
                value: 30,
              },
            ],
          },
        });
        ui.useUiStore.getState().setActiveSketch(id);
        return id;
      },
      { docHref: DOC, uiHref: UI },
    );

    await expect
      .poll(
        async () =>
          page.evaluate(async (href) => {
            const ui = await import(href);
            return ui.useUiStore.getState().activeSketchReady;
          }, UI),
        { timeout: 60_000 },
      )
      .toBe(true);

    await page.evaluate(
      async ({ docHref, featureId }) => {
        const doc = await import(docHref);
        const project = doc.useDocumentStore.getState().project;
        const sketch = project.superObjects[0].features.find(
          (feature: { id: string }) => feature.id === featureId,
        );
        doc.useDocumentStore.getState().apply({
          type: 'feature/replace',
          feature: {
            ...sketch,
            constraints: sketch.constraints.map((constraint: { id: string; value: unknown }) =>
              constraint.id === 'error_distance'
                ? { ...constraint, value: { formula: 'missing_name' } }
                : constraint,
            ),
          },
        });
      },
      { docHref: DOC, featureId: sketchId },
    );
    await expect
      .poll(
        async () =>
          page.evaluate(
            async ({ formulaHref, featureId }) => {
              const formula = await import(formulaHref);
              return formula.useFormulaStore.getState().resolution?.errors?.[featureId]?.[
                'constraints.0.value'
              ]?.code;
            },
            { formulaHref: FORMULA, featureId: sketchId },
          ),
        { timeout: 60_000 },
      )
      .toBe('UNKNOWN_NAME');

    await expect(page.locator('.constraint-list .constraint-value-text.is-error')).toHaveText('—');
    const annotation = page.locator('.sketch-annotation[data-error="true"]');
    await expect(annotation).toContainText('—');
    await expect(annotation).toHaveAttribute('aria-label', /missing_name/);
    const badge = page.locator('.constraint-list').locator('..').locator('.error-badge');
    await expect(badge).toHaveCount(1);
    await expect(badge.locator('svg')).toHaveAttribute('aria-label', /missing_name/);

    // Leaving and returning to a sketch with a broken formula must keep the
    // last geometry editable: the error is fixed in the same panel.
    await page.evaluate(
      async ({ uiHref, featureId }) => {
        const ui = await import(uiHref);
        ui.useUiStore.getState().setActiveSketch(null);
        await new Promise((resolve) => setTimeout(resolve, 300));
        ui.useUiStore.getState().setActiveSketch(featureId);
      },
      { uiHref: UI, featureId: sketchId },
    );
    await expect
      .poll(
        async () =>
          page.evaluate(async (href) => {
            const ui = await import(href);
            return ui.useUiStore.getState().activeSketchReady;
          }, UI),
        { timeout: 60_000 },
      )
      .toBe(true);
    await expect(page.locator('.constraint-list .constraint-value-text.is-error')).toHaveText('—');
    await expect(page.locator('.sketch-annotation[data-error="true"]')).toContainText('—');
  });

  test('a driven field shows its value and reveals the formula when focused', async ({ page }) => {
    await openApp(page);
    await page.evaluate(async (docHref) => {
      const doc = await import(docHref);
      doc.useDocumentStore.getState().apply({
        type: 'variable/add',
        variable: { id: 'var_width', name: 'width', type: 'number', source: '10 * 2' },
      });
    }, DOC);

    await expect
      .poll(
        async () =>
          page.evaluate(async (href) => {
            const mod = await import(href);
            return mod.useFormulaStore.getState().resolution?.variableValues.width;
          }, FORMULA),
        { timeout: 60_000 },
      )
      .toBe(20);

    const field = page.locator('.variable-row .dimension-field input');
    await expect(field).toHaveValue('20');
    await expect(page.locator('.variable-row .dimension-field')).toHaveClass(/is-formula/);
    await expect(field).not.toHaveAttribute('title');
    // The old formula marker is gone.
    await expect(page.locator('.dimension-formula')).toHaveCount(0);

    await field.click();
    await expect(field).toHaveValue('=10 * 2');
    await field.fill('=15 * 2');
    await field.press('Enter');
    await expect(field).toHaveValue('30');
    await expect
      .poll(
        async () =>
          page.evaluate(async (href) => {
            const mod = await import(href);
            return mod.useFormulaStore.getState().resolution?.variableValues.width;
          }, FORMULA),
        { timeout: 60_000 },
      )
      .toBe(30);
  });

  test('a variable accepts a plain value or a formula', async ({ page }) => {
    await openApp(page);
    await page.evaluate(async (docHref) => {
      const doc = await import(docHref);
      doc.useDocumentStore.getState().apply({
        type: 'variable/add',
        variable: { id: 'var_width', name: 'width', type: 'number', source: '20' },
      });
    }, DOC);

    const field = page.locator('.variable-row .dimension-field');
    const input = field.locator('.dimension-input');
    await expect(input).toHaveValue('20');
    await expect(field).not.toHaveClass(/is-formula/);

    await input.click();
    await expect(input).toHaveValue('20');
    await input.fill('-5');
    await input.press('Enter');
    await expect(input).toHaveValue('-5');
    await expect
      .poll(
        async () =>
          page.evaluate(async (href) => {
            const mod = await import(href);
            return mod.useFormulaStore.getState().resolution?.variableValues.width;
          }, FORMULA),
        { timeout: 60_000 },
      )
      .toBe(-5);

    await input.click();
    await input.fill('=10 - 2');
    await input.press('Enter');
    await expect(input).toHaveValue('8');
    await expect(field).toHaveClass(/is-formula/);
  });

  test('a driven parameter keeps its unit and reveals its formula on focus', async ({ page }) => {
    await openApp(page);
    const id = await addVariableAndCube(page);
    await expect.poll(async () => resolvedParam(page, id, 'dx'), { timeout: 60_000 }).toBe(40);
    await page.evaluate(
      async ({ docHref, featureId }) => {
        const doc = await import(docHref);
        doc.useDocumentStore.getState().select({ kind: 'feature', id: featureId });
      },
      { docHref: DOC, featureId: id },
    );

    const field = page.locator('.dimension-field:has(input[aria-label="Width (X) · mm"])');
    const input = field.locator('.dimension-input');
    await expect(input).toHaveValue('40');
    await expect(field).toHaveClass(/is-formula/);
    await expect(field.locator('.dimension-unit')).toHaveText('mm');

    await input.click();
    await expect(input).toHaveValue('=width * 2');
  });

  test('an expression error blocks the operation instead of crashing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openApp(page);
    const id = await addVariableAndCube(page);
    await expect.poll(async () => resolvedParam(page, id, 'dx'), { timeout: 60_000 }).toBe(40);

    await page.evaluate(
      async ({ docHref, featureId }) => {
        const doc = await import(docHref);
        doc.useDocumentStore.getState().setFeatureParameter(featureId, 'params.dx', {
          formula: 'missing + 1',
        });
      },
      { docHref: DOC, featureId: id },
    );

    await expect
      .poll(
        async () =>
          page.evaluate(
            async ({ formulaHref, featureId }) => {
              const mod = await import(formulaHref);
              return mod.useFormulaStore.getState().resolution?.errors?.[featureId]?.['params.dx']
                ?.code;
            },
            { formulaHref: FORMULA, featureId: id },
          ),
        { timeout: 60_000 },
      )
      .toBe('UNKNOWN_NAME');

    await page.evaluate(
      async ({ docHref, featureId }) => {
        const doc = await import(docHref);
        doc.useDocumentStore.getState().select({ kind: 'feature', id: featureId });
      },
      { docHref: DOC, featureId: id },
    );
    const errorField = page.locator('.dimension-field.has-error');
    await expect(errorField).toBeVisible();
    await expect(errorField.locator('.dimension-input')).toHaveValue('—');
    await expect(page.locator('[data-testid="dimension-error"]')).toHaveCount(0);
    await errorField.hover();
    await expect(page.getByRole('tooltip')).toContainText('missing');
    expect(errors).toEqual([]);
  });
});
