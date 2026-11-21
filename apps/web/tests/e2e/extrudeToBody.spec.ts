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

/** A 20 mm cube at the origin and a square profile 40 mm above it. */
async function sceneWithCubeBelowProbe(page: Page) {
  await page.evaluate(async () => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const doc = await import(url('/src/stores/documentStore.ts')!);
    doc.useDocumentStore.getState().addPrimitiveBox('Box');
    const sketchId = doc.useDocumentStore.getState().addSketch('Sketch', 'XY')!;
    const state = doc.useDocumentStore.getState();
    const model = state.project.superObjects.find(
      (superObject: { id: string }) => superObject.id === state.project.activeSuperObjectId,
    )!;
    const sketch = model.features.find((feature: { id: string }) => feature.id === sketchId)!;
    doc.useDocumentStore.getState().apply({
      type: 'feature/replace',
      feature: {
        ...sketch,
        plane: { type: 'datum', plane: 'XY', offset: 40 },
        // The profile sits over the cube's own footprint.
        entities: [
          { id: 'line-1', type: 'line', construction: false, x1: 5, y1: 5, x2: 15, y2: 5 },
          { id: 'line-2', type: 'line', construction: false, x1: 15, y1: 5, x2: 15, y2: 15 },
          { id: 'line-3', type: 'line', construction: false, x1: 15, y1: 15, x2: 5, y2: 15 },
          { id: 'line-4', type: 'line', construction: false, x1: 5, y1: 15, x2: 5, y2: 5 },
        ],
      },
    });
    const extrudeId = doc.useDocumentStore.getState().addExtrude('Extrude', { sketchId })!;
    const edited = doc.useDocumentStore
      .getState()
      .project.superObjects.find(
        (superObject: { id: string }) => superObject.id === state.project.activeSuperObjectId,
      )!
      .features.find((feature: { id: string }) => feature.id === extrudeId)!;
    doc.useDocumentStore.getState().apply({
      type: 'feature/replace',
      feature: {
        ...edited,
        end: 'to-body',
        toBody: { kind: 'first' },
        toBodyOffset: 0,
        op: 'new',
        // The sketch sits above the cube, so the sweep has to go down.
        reversed: true,
      },
    });
  });
}

async function editingFeatureId(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const doc = await import(url('/src/stores/documentStore.ts')!);
    return doc.useDocumentStore.getState().editingFeatureId as string | null;
  });
}

/** Dismisses the running edit so the operation is applied to the model. */

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
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if ((await editingFeatureId(page)) === null) {
      await waitForKernelIdle(page);
      return;
    }
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  await waitForKernelIdle(page);
}

/** Height of the body the extrude built, in millimetres. */
async function extrudedSpan(page: Page): Promise<{ min: number; max: number } | null> {
  return page.evaluate(async () => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const kernel = await import(url('/src/stores/kernelStore.ts')!);
    const doc = await import(url('/src/stores/documentStore.ts')!);
    const state = doc.useDocumentStore.getState();
    const model = state.project.superObjects.find(
      (superObject: { id: string }) => superObject.id === state.project.activeSuperObjectId,
    )!;
    const extrude = model.features.find((feature: { type: string }) => feature.type === 'extrude');
    const meshes = kernel.useKernelStore.getState().meshes;
    const body = model.bodies.find(
      (candidate: { createdBy: string }) => candidate.createdBy === extrude?.id,
    );
    if (!body) return null;
    const mesh = meshes[body.id];
    return mesh ? { min: mesh.bbox.min[2], max: mesh.bbox.max[2] } : null;
  });
}

/** The box the scene starts with, which every extent below stops at. */
async function boxBodyId(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const doc = await import(url('/src/stores/documentStore.ts')!);
    const state = doc.useDocumentStore.getState();
    const model = state.project.superObjects.find(
      (superObject: { id: string }) => superObject.id === state.project.activeSuperObjectId,
    )!;
    const box = model.features.find((feature: { type: string }) => feature.type === 'primitive');
    return model.bodies.find((body: { createdBy: string }) => body.createdBy === box?.id)!.id;
  });
}

async function setTarget(page: Page, spec: { kind: string; bodyId?: string }) {
  await page.evaluate(async (target) => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const doc = await import(url('/src/stores/documentStore.ts')!);
    const state = doc.useDocumentStore.getState();
    const model = state.project.superObjects.find(
      (superObject: { id: string }) => superObject.id === state.project.activeSuperObjectId,
    )!;
    const edited = model.features.find((feature: { type: string }) => feature.type === 'extrude')!;
    doc.useDocumentStore.getState().setExtrudeToBody(edited.id, target);
  }, spec);
}

async function setMode(page: Page, mode: 'solid' | 'gap' | 'shell') {
  await page.evaluate(async (value) => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const doc = await import(url('/src/stores/documentStore.ts')!);
    const state = doc.useDocumentStore.getState();
    const model = state.project.superObjects.find(
      (superObject: { id: string }) => superObject.id === state.project.activeSuperObjectId,
    )!;
    const edited = model.features.find((feature: { type: string }) => feature.type === 'extrude')!;
    doc.useDocumentStore.getState().setExtrudeToBodyMode(edited.id, value);
  }, mode);
}

async function setOffset(page: Page, value: number) {
  await page.evaluate(async (offset) => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const doc = await import(url('/src/stores/documentStore.ts')!);
    const state = doc.useDocumentStore.getState();
    const model = state.project.superObjects.find(
      (superObject: { id: string }) => superObject.id === state.project.activeSuperObjectId,
    )!;
    const edited = model.features.find((feature: { type: string }) => feature.type === 'extrude')!;
    doc.useDocumentStore.getState().setExtrudeToBodyOffset(edited.id, offset);
  }, value);
}

/** Bounds and count of every body in the model, used for an added material. */
async function modelSpan(page: Page): Promise<{ bodies: number; min: number; max: number } | null> {
  return page.evaluate(async () => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const kernel = await import(url('/src/stores/kernelStore.ts')!);
    const doc = await import(url('/src/stores/documentStore.ts')!);
    const state = doc.useDocumentStore.getState();
    const model = state.project.superObjects.find(
      (superObject: { id: string }) => superObject.id === state.project.activeSuperObjectId,
    )!;
    const meshes = kernel.useKernelStore.getState().meshes;
    const boxes = model.bodies
      .map((body: { id: string }) => meshes[body.id]?.bbox)
      .filter((bbox: unknown) => Boolean(bbox));
    if (boxes.length === 0) return null;
    return {
      bodies: boxes.length,
      min: Math.min(...boxes.map((bbox: { min: number[] }) => bbox.min[2])),
      max: Math.max(...boxes.map((bbox: { max: number[] }) => bbox.max[2])),
    };
  });
}

async function setOp(page: Page, op: 'new' | 'add') {
  await page.evaluate(async (value) => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const doc = await import(url('/src/stores/documentStore.ts')!);
    const state = doc.useDocumentStore.getState();
    const model = state.project.superObjects.find(
      (superObject: { id: string }) => superObject.id === state.project.activeSuperObjectId,
    )!;
    const edited = model.features.find((feature: { type: string }) => feature.type === 'extrude')!;
    doc.useDocumentStore.getState().setExtrudeOp(edited.id, value);
  }, op);
}

/** A ball of radius 10 at the origin and a square profile 30 mm above it. */
async function sceneWithBallBelowProbe(page: Page) {
  await page.evaluate(async () => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const doc = await import(url('/src/stores/documentStore.ts')!);
    doc.useDocumentStore.getState().addPrimitive('Ball', 'sphere');
    const sketchId = doc.useDocumentStore.getState().addSketch('Sketch', 'XY')!;
    const state = doc.useDocumentStore.getState();
    const model = state.project.superObjects.find(
      (superObject: { id: string }) => superObject.id === state.project.activeSuperObjectId,
    )!;
    const sketch = model.features.find((feature: { id: string }) => feature.id === sketchId)!;
    doc.useDocumentStore.getState().apply({
      type: 'feature/replace',
      feature: {
        ...sketch,
        plane: { type: 'datum', plane: 'XY', offset: 30 },
        // A square that fits inside the ball's outline, so the sweep meets it
        // at depths that vary by almost five millimetres.
        entities: [
          { id: 'line-1', type: 'line', construction: false, x1: -6, y1: -6, x2: 6, y2: -6 },
          { id: 'line-2', type: 'line', construction: false, x1: 6, y1: -6, x2: 6, y2: 6 },
          { id: 'line-3', type: 'line', construction: false, x1: 6, y1: 6, x2: -6, y2: 6 },
          { id: 'line-4', type: 'line', construction: false, x1: -6, y1: 6, x2: -6, y2: -6 },
        ],
      },
    });
    const extrudeId = doc.useDocumentStore.getState().addExtrude('Extrude', { sketchId })!;
    const edited = doc.useDocumentStore
      .getState()
      .project.superObjects.find(
        (superObject: { id: string }) => superObject.id === state.project.activeSuperObjectId,
      )!
      .features.find((feature: { id: string }) => feature.id === extrudeId)!;
    doc.useDocumentStore.getState().apply({
      type: 'feature/replace',
      feature: {
        ...edited,
        end: 'to-body',
        toBody: { kind: 'first' },
        toBodyOffset: 0,
        op: 'new',
        reversed: true,
      },
    });
  });
}

/**
 * Volume of each body the operation created, largest first, and the number of
 * bodies in the model. A tool that keeps geometry from behind the body it ends
 * on shows up both as an extra body and as extra volume.
 */
async function extrudeVolumes(page: Page): Promise<{ volumes: number[]; bodies: number }> {
  return page.evaluate(async () => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const kernel = await import(url('/src/stores/kernelStore.ts')!);
    const doc = await import(url('/src/stores/documentStore.ts')!);
    const state = doc.useDocumentStore.getState();
    const model = state.project.superObjects.find(
      (superObject: { id: string }) => superObject.id === state.project.activeSuperObjectId,
    )!;
    const meshes = kernel.useKernelStore.getState().meshes;
    const extrude = model.features.find((feature: { type: string }) => feature.type === 'extrude');
    const volumes: number[] = [];
    let bodies = 0;
    for (const body of model.bodies as Array<{ id: string; createdBy: string }>) {
      const mesh = meshes[body.id];
      if (!mesh) continue;
      bodies += 1;
      const { positions, indices } = mesh;
      let volume = 0;
      for (let index = 0; index < indices.length; index += 3) {
        const a = indices[index] * 3;
        const b = indices[index + 1] * 3;
        const c = indices[index + 2] * 3;
        volume +=
          positions[a] *
            (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) +
          positions[a + 1] * (positions[b + 2] * positions[c] - positions[b] * positions[c + 2]) +
          positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
      }
      if (body.createdBy === extrude?.id) volumes.push(Math.abs(volume / 6));
    }
    return { volumes: volumes.sort((left, right) => right - left), bodies };
  });
}

test('ends an extrusion on the front or the back face of a body', async ({ page }) => {
  await openApp(page);
  await sceneWithCubeBelowProbe(page);
  await commitOperation(page);

  // The front face, no offset: the new body fills the space between the profile
  // and the cube, and stops there.
  await expect
    .poll(async () => (await extrudedSpan(page))?.max, { timeout: 60_000 })
    .toBeCloseTo(40, 1);
  expect((await extrudedSpan(page))?.min).toBeCloseTo(20, 1);

  // A gap of five millimetres stops above the cube's front face.
  await setOffset(page, 5);
  await expect
    .poll(async () => (await extrudedSpan(page))?.min, { timeout: 60_000 })
    .toBeCloseTo(25, 1);
  // The sweep passes the cube, and nothing it keeps behind it survives: the
  // extent is one body of the profile's area over the fifteen millimetres left.
  await expect
    .poll(async () => (await extrudeVolumes(page)).volumes.length, { timeout: 60_000 })
    .toBe(1);
  expect((await extrudeVolumes(page)).volumes[0]! / (10 * 10 * 15)).toBeCloseTo(1, 2);

  // A negative offset leaves a layer of that thickness on the face.
  await setOffset(page, -3);
  await expect
    .poll(async () => (await extrudedSpan(page))?.max, { timeout: 60_000 })
    .toBeCloseTo(23, 1);
  expect((await extrudedSpan(page))?.min).toBeCloseTo(20, 1);

  // The back face: from the profile all the way through the cube, in one body.
  await setOffset(page, 0);
  await setTarget(page, { kind: 'last' });
  await expect
    .poll(async () => (await extrudedSpan(page))?.min, { timeout: 60_000 })
    .toBeCloseTo(0, 1);
  expect((await extrudedSpan(page))?.max).toBeCloseTo(40, 1);
  // One body from the profile to the far wall, not a shell around the cube.
  expect((await extrudeVolumes(page)).volumes.length).toBe(1);
  expect((await extrudeVolumes(page)).volumes[0]! / (10 * 10 * 40)).toBeCloseTo(1, 2);

  // A picked body is used instead of the nearest one.
  await setTarget(page, { kind: 'first', bodyId: await boxBodyId(page) });
  await expect
    .poll(async () => (await extrudedSpan(page))?.min, { timeout: 60_000 })
    .toBeCloseTo(20, 1);
  expect((await extrudedSpan(page))?.max).toBeCloseTo(40, 1);

  // Added material stands on the cube and joins it into one body.
  await setOp(page, 'add');
  await expect.poll(async () => (await modelSpan(page))?.bodies, { timeout: 60_000 }).toBe(1);
  expect((await modelSpan(page))?.max).toBeCloseTo(40, 1);
  expect((await modelSpan(page))?.min).toBeCloseTo(0, 1);
});

test('follows a curved face without keeping geometry from behind it', async ({ page }) => {
  await openApp(page);
  await sceneWithBallBelowProbe(page);
  await commitOperation(page);

  // The column from the profile down to the ball, in one body. A tool that also
  // kept what the prism passes behind the ball adds a body of 338 mm³.
  const column = 3071.4;
  await expect
    .poll(async () => (await extrudeVolumes(page)).volumes.length, { timeout: 60_000 })
    .toBe(1);
  expect((await extrudeVolumes(page)).volumes[0]! / column).toBeCloseTo(1, 2);
  expect((await extrudeVolumes(page)).bodies).toBe(2);

  // A gap of two millimetres is the ball moved out by two all round: the column
  // ends on a sphere of radius twelve, not on a copy of the ball pushed down,
  // which would leave almost no gap at the silhouette.
  await setOffset(page, 2);
  await expect
    .poll(async () => (await extrudeVolumes(page)).volumes[0] ?? 0, { timeout: 60_000 })
    .toBeCloseTo(2745.9, -2);
  expect((await extrudeVolumes(page)).bodies).toBe(2);

  // A layer of three millimetres is the shell between the ball and the ball
  // moved out by three: a skin of that thickness, not a flat-ended cap.
  await setOffset(page, -3);
  await expect
    .poll(async () => (await extrudeVolumes(page)).volumes[0] ?? 0, { timeout: 60_000 })
    .toBeCloseTo(483, 0);
  expect((await extrudeVolumes(page)).volumes.length).toBe(1);
});

test('takes the size and the way it ends on the face, not a signed offset', async ({ page }) => {
  await openApp(page);
  await sceneWithBallBelowProbe(page);
  await commitOperation(page);

  // Picking a gap opens it at a size of its own, stored as a plain number.
  await setMode(page, 'gap');
  await expect
    .poll(async () => (await extrudeVolumes(page)).volumes[0] ?? 0, { timeout: 60_000 })
    .toBeCloseTo(2745.9, -2);

  // The same three millimetres as a layer on the ball, again a positive size.
  await setOffset(page, 3);
  await setMode(page, 'shell');
  await expect
    .poll(async () => (await extrudeVolumes(page)).volumes[0] ?? 0, { timeout: 60_000 })
    .toBeCloseTo(483, 0);
  expect((await extrudeVolumes(page)).volumes.length).toBe(1);
});
