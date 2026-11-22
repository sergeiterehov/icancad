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

async function waitForKernelIdle(page: Page) {
  await page.waitForTimeout(300);
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const url = (s: string) =>
            performance
              .getEntriesByType('resource')
              .map((entry) => entry.name)
              .find((name) => name.includes(s));
          const kernel = await import(url('/src/stores/kernelStore.ts') ?? '/src/stores/kernelStore.ts');
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

/** Sketches of the model, their frames and the build errors of the moment. */
async function scene(page: Page) {
  return page.evaluate(async () => {
    const url = (s: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(s));
    const doc = await import(url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts');
    const kernel = await import(url('/src/stores/kernelStore.ts') ?? '/src/stores/kernelStore.ts');
    const state = doc.useDocumentStore.getState();
    const kernelState = kernel.useKernelStore.getState();
    const model = state.project.superObjects.find(
      (candidate: { id: string }) => candidate.id === state.project.activeSuperObjectId,
    ) as { features: { id: string; type: string }[]; bodies: { id: string }[] };
    const round = (value: number) => Math.round(value * 1000) / 1000;
    const frames = Object.fromEntries(
      Object.entries(kernelState.sketchFrames).map(([id, frame]) => {
        const value = frame as { origin: number[]; normal: number[] };
        return [id, { origin: value.origin.map(round), normal: value.normal.map(round) }];
      }),
    );
    return {
      frames,
      errors: kernelState.featureErrors,
      objectErrors: kernelState.featureObjectErrors,
      features: model.features.map((feature) => ({ id: feature.id, type: feature.type })),
      bodies: model.bodies.map((body) => body.id),
    };
  });
}

async function addBox(page: Page) {
  return page.evaluate(async () => {
    const url = (s: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(s));
    const doc = await import(url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts');
    const boxId = doc.useDocumentStore.getState().addPrimitive('Box', 'box');
    if (!boxId) throw new Error('BOX_NOT_CREATED');
    doc.useDocumentStore.getState().endFeatureEdit();
    return boxId;
  });
}

/** A triangle sketched on the +X face of the box, recorded the way a pick does. */
async function addFaceSketch(page: Page) {
  return page.evaluate(async () => {
    const url = (s: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(s));
    const doc = await import(url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts');
    const kernel = await import(url('/src/stores/kernelStore.ts') ?? '/src/stores/kernelStore.ts');
    const planes = await import(url('/src/sketch/sectionPlane.ts') ?? '/src/sketch/sectionPlane.ts');

    const state = doc.useDocumentStore.getState();
    const model = state.project.superObjects.find(
      (candidate: { id: string }) => candidate.id === state.project.activeSuperObjectId,
    ) as { bodies: { id: string }[] };
    const bodyId = model.bodies[0]!.id;
    const mesh = kernel.useKernelStore.getState().meshes[bodyId];
    if (!mesh?.faceNames) throw new Error('NO_MESH');
    const index = mesh.faceNames.findIndex((name: string) => name.endsWith('/+x'));
    if (index < 0) throw new Error('NO_FACE');
    const name = mesh.faceNames[index] as string;
    const frame = planes.faceFrameByName(mesh, name);
    if (!frame) throw new Error('NO_FRAME');

    const sketchId = state.addSketch('Face sketch', 'XY');
    if (!sketchId) throw new Error('SKETCH_NOT_CREATED');
    const afterSketch = doc.useDocumentStore.getState();
    const nextModel = afterSketch.project.superObjects.find(
      (candidate: { id: string }) => candidate.id === afterSketch.project.activeSuperObjectId,
    ) as { features: { id: string }[] };
    const sketch = nextModel.features.find((feature) => feature.id === sketchId);
    afterSketch.apply({
      type: 'feature/replace',
      feature: {
        ...sketch,
        plane: { type: 'face', bodyId, name, offset: 0, frame },
        // A triangle well inside the +X face of the box.
        entities: [
          { id: 'line-a', type: 'line', construction: false, x1: -6, y1: -6, x2: 6, y2: -6 },
          { id: 'line-b', type: 'line', construction: false, x1: 6, y1: -6, x2: 0, y2: 6 },
          { id: 'line-c', type: 'line', construction: false, x1: 0, y1: 6, x2: -6, y2: -6 },
        ],
      },
    });
    doc.useDocumentStore.getState().endFeatureEdit();
    return sketchId;
  });
}

/** A boss standing on the face the sketch was drawn on. */
async function addBoss(page: Page, sketchId: string) {
  return page.evaluate(async (id) => {
    const url = (s: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(s));
    const doc = await import(url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts');
    const state = doc.useDocumentStore.getState();
    const model = state.project.superObjects.find(
      (candidate: { id: string }) => candidate.id === state.project.activeSuperObjectId,
    ) as { bodies: { id: string }[] };
    const bodyId = model.bodies[0]!.id;
    const bossId = state.addExtrude('Boss', { sketchId: id });
    if (!bossId) throw new Error('BOSS_NOT_CREATED');
    const withBoss = doc.useDocumentStore.getState();
    const bossModel = withBoss.project.superObjects.find(
      (candidate: { id: string }) => candidate.id === withBoss.project.activeSuperObjectId,
    ) as { features: { id: string }[] };
    const boss = bossModel.features.find((feature) => feature.id === bossId);
    withBoss.apply({
      type: 'feature/replace',
      feature: {
        ...boss,
        end: 'blind',
        distance: 3,
        reversed: false,
        op: 'add',
        scope: 'all',
        bodyIds: [bodyId],
        regions: [],
        faceRefs: [],
        objectOrder: [`s:${id}#*`],
      },
    });
    doc.useDocumentStore.getState().endFeatureEdit();
    return bossId;
  }, sketchId);
}

async function buildModel(page: Page) {
  const boxId = await addBox(page);
  await waitForKernelIdle(page);
  const sketchId = await addFaceSketch(page);
  await waitForKernelIdle(page);
  const bossId = await addBoss(page, sketchId);
  await waitForKernelIdle(page);
  return { boxId, sketchId, bossId };
}

test.describe('sketch on a face', () => {
  test('keeps the sketch on the face while operations are previewed', async ({ page }) => {
    await openApp(page);
    const ids = await buildModel(page);
    await waitForKernelIdle(page);

    const built = await scene(page);
    expect(built.errors).toEqual({});
    expect(built.objectErrors).toEqual({});
    const frame = built.frames[ids.sketchId];
    expect(frame).toBeDefined();
    expect(frame!.normal).toEqual([1, 0, 0]);
    expect(frame!.origin[0]).toBeCloseTo(20, 3);

    // Opening every operation is what a user does while reviewing the history;
    // each of them builds a preview, and none may move the sketch.
    const rows = page.locator('.timeline-op');
    const count = await rows.count();
    expect(count).toBe(3);
    for (let index = 0; index < count; index += 1) {
      await rows.nth(index).click();
      await waitForKernelIdle(page);
      await page.keyboard.press('Escape');
      await waitForKernelIdle(page);
      const after = await scene(page);
      expect(after.frames[ids.sketchId]).toEqual(frame);
      expect(after.errors).toEqual({});
      expect(after.objectErrors).toEqual({});
    }
  });

  test('follows the face when the box gets wider', async ({ page }) => {
    await openApp(page);
    const ids = await buildModel(page);
    await waitForKernelIdle(page);
    await page.evaluate(async (boxId) => {
      const url = (s: string) =>
        performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .find((name) => name.includes(s));
      const doc = await import(url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts');
      doc.useDocumentStore.getState().setFeatureParameter(boxId, 'params.dx', 30);
    }, ids.boxId);
    await waitForKernelIdle(page);

    const after = await scene(page);
    expect(after.errors).toEqual({});
    expect(after.objectErrors).toEqual({});
    const frame = after.frames[ids.sketchId]!;
    // The face is the +X side of the box, so the sketch moves with it, and the
    // boss standing on it still finds the face.
    expect(frame.origin[0]).toBeCloseTo(30, 3);
    expect(frame.normal).toEqual([1, 0, 0]);
  });
});
