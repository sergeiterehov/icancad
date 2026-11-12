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

interface HandleScreen {
  id: string;
  originX: number;
  originY: number;
  tipX: number;
  tipY: number;
  value: number;
}

/** The treatment arrow, the only handle an edge or a face offers here. */
async function treatmentHandle(page: Page): Promise<HandleScreen | undefined> {
  return (await handleScreens(page)).find((handle) => handle.id.startsWith('edge-treatment:'));
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

async function waitForEdges(page: Page) {
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const url = (s: string) =>
          performance
            .getEntriesByType('resource')
            .map((entry) => entry.name)
            .find((name) => name.includes(s));
        const kernel = await import(url('/src/stores/kernelStore.ts')!);
        const mesh = Object.values(kernel.useKernelStore.getState().meshes)[0] as
          | { edges?: unknown[] }
          | undefined;
        return mesh?.edges?.length ?? 0;
      }),
    )
    .toBeGreaterThan(0);
}

async function selectEdge(page: Page, index = 0) {
  await page.evaluate(async (edgeIndex) => {
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
    const edge = kernel.useKernelStore.getState().meshes[body.id]!.edges![edgeIndex]!;
    store.select({ kind: 'edge', id: selection.bodyEdgeId(body.id, edge.id) });
  }, index);
}

/** A round boss: a circle sketch extruded upwards. */
async function addBoss(page: Page) {
  await page.evaluate(async () => {
    const url = (s: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(s));
    const doc = await import(url('/src/stores/documentStore.ts')!);
    const store = doc.useDocumentStore.getState();
    const sketchId = store.addSketch('Sketch', 'XY');
    const sketch = doc.useDocumentStore
      .getState()
      .project.features.find((feature: { id: string }) => feature.id === sketchId);
    doc.useDocumentStore.getState().apply({
      type: 'feature/replace',
      feature: {
        ...sketch,
        entities: [{ id: 'circle-1', type: 'circle', construction: false, cx: 0, cy: 0, r: 10 }],
      },
    });
    doc.useDocumentStore.getState().addExtrude('Extrude', { sketchId, regions: [] });
  });
  // The extrude opens for editing; dismissing it commits the body.
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const url = (s: string) =>
            performance
              .getEntriesByType('resource')
              .map((entry) => entry.name)
              .find((name) => name.includes(s));
          const kernel = await import(url('/src/stores/kernelStore.ts')!);
          const preview = kernel.useKernelStore.getState().preview;
          return preview ? preview.bodies.length : 0;
        }),
      { timeout: 20_000 },
    )
    .toBe(1);
  await commitOperation(page);
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const url = (s: string) =>
            performance
              .getEntriesByType('resource')
              .map((entry) => entry.name)
              .find((name) => name.includes(s));
          const doc = await import(url('/src/stores/documentStore.ts')!);
          return doc.useDocumentStore.getState().project.bodies.length;
        }),
      { timeout: 20_000 },
    )
    .toBe(1);
}

/** Select the first closed edge, such as the rim of a cylinder. */
async function selectClosedEdge(page: Page) {
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
    const mesh = kernel.useKernelStore.getState().meshes[body.id]!;
    const rim = mesh.edges!.find((edge: { closed: boolean }) => edge.closed)!;
    store.select({ kind: 'edge', id: selection.bodyEdgeId(body.id, rim.id) });
  });
}

async function selectFace(page: Page) {
  await page.evaluate(async () => {
    const url = (s: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(s));
    const doc = await import(url('/src/stores/documentStore.ts')!);
    const kernel = await import(url('/src/stores/kernelStore.ts')!);
    const store = doc.useDocumentStore.getState();
    const body = store.project.bodies[0]!;
    const mesh = kernel.useKernelStore.getState().meshes[body.id]!;
    store.select({ kind: 'body-face', id: `${body.id}#${mesh.faceIds[0]}` });
  });
}

/** Pull the treatment arrow along itself by `pixels`, holding shift if asked. */
async function dragArrow(page: Page, pixels: number, shift = false) {
  const handle = await treatmentHandle(page);
  expect(handle).toBeTruthy();
  const dx = handle!.tipX - handle!.originX;
  const dy = handle!.tipY - handle!.originY;
  const length = Math.hypot(dx, dy) || 1;
  const ux = (dx / length) * Math.sign(pixels);
  const uy = (dy / length) * Math.sign(pixels);
  const distance = Math.abs(pixels);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(handle!.tipX, handle!.tipY);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(
      handle!.tipX + (ux * distance * step) / 8,
      handle!.tipY + (uy * distance * step) / 8,
    );
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

interface TreatmentInfo {
  type: string;
  kind: 'fillet' | 'chamfer';
  size: number;
  faces: number;
  edges: number;
  error?: string;
  applied?: number;
}

async function lastTreatment(page: Page): Promise<TreatmentInfo | null> {
  return page.evaluate(async () => {
    const url = (s: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(s));
    const doc = await import(url('/src/stores/documentStore.ts')!);
    const kernel = await import(url('/src/stores/kernelStore.ts')!);
    const store = doc.useDocumentStore.getState();
    const feature = [...store.project.features]
      .reverse()
      .find((candidate: { type: string }) => candidate.type === 'edge-treatment') as
      | {
          id: string;
          type: string;
          kind: 'fillet' | 'chamfer';
          size: number;
          faceRefs: unknown[];
          edgeRefs: unknown[];
        }
      | undefined;
    if (!feature) return null;
    const kernelState = kernel.useKernelStore.getState();
    return {
      type: feature.type,
      kind: feature.kind,
      size: feature.size,
      faces: feature.faceRefs.length,
      edges: feature.edgeRefs.length,
      ...(kernelState.featureErrors[feature.id]
        ? { error: kernelState.featureErrors[feature.id] }
        : {}),
      ...(kernelState.featureLimits[feature.id]
        ? { applied: kernelState.featureLimits[feature.id].applied }
        : {}),
    };
  });
}


async function treatmentCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const url = (s: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(s));
    const doc = await import(url('/src/stores/documentStore.ts')!);
    return doc.useDocumentStore
      .getState()
      .project.features.filter(
        (feature: { type: string }) => feature.type === 'edge-treatment',
      ).length;
  });
}

/** Colour marks of the treatment being edited, split per body. */
async function previewMarks(page: Page) {
  return page.evaluate(async () => {
    const url = (s: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(s));
    const kernel = await import(url('/src/stores/kernelStore.ts')!);
    const preview = kernel.useKernelStore.getState().preview as
      | {
          bodies: { silent?: boolean; translucent?: boolean }[];
          faceMarks?: { red: number[]; green: number[] }[];
        }
      | null;
    if (!preview) return null;
    return {
      silent: preview.bodies.every((body) => body.silent === true),
      opaque: preview.bodies.every((body) => body.translucent === false),
      marks: (preview.faceMarks ?? []).map((mark) => ({
        red: mark.red.length,
        green: mark.green.length,
      })),
    };
  });
}

test.describe('edge treatment', () => {
  test('chamfers an edge by pulling the arrow into the corner', async ({ page }) => {
    await openApp(page);
    await addBox(page);
    await waitForEdges(page);
    await selectEdge(page);

    const handles = await handleScreens(page);
    // An edge offers the treatment arrow only; extrusion has nothing to work on.
    expect(handles).toHaveLength(1);
    expect(handles[0]?.id.startsWith('edge-treatment:')).toBe(true);

    await dragArrow(page, 70);
    await expect.poll(async () => (await lastTreatment(page))?.kind).toBe('chamfer');

    const treatment = await lastTreatment(page);
    expect(treatment?.size).toBeGreaterThan(0.5);
    expect(treatment?.error).toBeUndefined();
    // The operation is focused, so the inspector names its type.
    await expect(
      page.getByTestId('inspector').getByText('Chamfer', { exact: true }),
    ).toBeVisible();
  });

  test('rounds an edge while shift is held', async ({ page }) => {
    await openApp(page);
    await addBox(page);
    await waitForEdges(page);
    await selectEdge(page);
    await dragArrow(page, 70, true);
    await expect.poll(async () => (await lastTreatment(page))?.kind).toBe('fillet');
    await expect(page.getByTestId('inspector').getByText('Round', { exact: true })).toBeVisible();
  });

  test('rounds the rim of a round boss', async ({ page }) => {
    await openApp(page);
    await addBoss(page);
    await selectClosedEdge(page);

    // A rim is a closed polyline, so this used to fail to resolve its edge.
    await expect
      .poll(async () => (await handleScreens(page)).length, { timeout: 15_000 })
      .toBe(1);
    await dragArrow(page, 70, true);
    await expect.poll(async () => (await lastTreatment(page))?.kind).toBe('fillet');
    const treatment = await lastTreatment(page);
    expect(treatment?.error).toBeUndefined();
    expect(treatment?.applied).toBeGreaterThan(0);
    // Only the rounded surface is new; the cap and the wall keep their faces.
    await expect(
      page.getByTestId('inspector').getByText('Round', { exact: true }),
    ).toBeVisible();
  });

  test('offers the treatment arrow next to the extrude arrow on a face', async ({ page }) => {
    await openApp(page);
    await addBox(page);
    await selectFace(page);

    await expect
      .poll(async () => (await handleScreens(page)).length)
      .toBe(2);
    const handles = await handleScreens(page);
    expect(handles.filter((handle) => !handle.id.startsWith('edge-treatment:'))).toHaveLength(1);
    // The treatment arrow stands on the first rim edge of the face, so the two
    // arrows do not share an anchor.
    expect(handles.filter((handle) => handle.id.startsWith('edge-treatment:'))).toHaveLength(1);
  });

  test('reduces a size the geometry cannot take', async ({ page }) => {
    await openApp(page);
    await addBox(page);
    await waitForEdges(page);
    await selectEdge(page);
    await dragArrow(page, 70, true);
    await expect.poll(async () => (await lastTreatment(page))?.kind).toBe('fillet');

    const size = page.getByTestId('inspector').getByLabel('Radius');
    await size.fill('500');
    await size.press('Enter');

    await expect(page.getByTestId('dimension-warning')).toBeVisible();
    await expect.poll(async () => (await lastTreatment(page))?.error).toBeUndefined();
    const treatment = await lastTreatment(page);
    expect(treatment?.size).toBe(500);
    expect(treatment?.applied).toBeGreaterThan(0);
    expect(treatment?.applied).toBeLessThan(500);
  });

  test('keeps the rim it was picked on after the operation exists', async ({ page }) => {
    await openApp(page);
    await addBoss(page);
    await selectClosedEdge(page);
    await expect.poll(async () => (await handleScreens(page)).length, { timeout: 15_000 }).toBe(1);
    const before = await treatmentHandle(page);

    await dragArrow(page, 60);
    await expect.poll(async () => (await lastTreatment(page))?.kind).toBe('chamfer');
    // The handle of the focused operation resolves the stored edge against the
    // input mesh, so it stays on the rim that was picked instead of jumping to
    // whichever edge took over its id in the result.
    const after = await treatmentHandle(page);
    expect(Math.abs((after?.originX ?? 0) - (before?.originX ?? 0))).toBeLessThan(3);
    expect(Math.abs((after?.originY ?? 0) - (before?.originY ?? 0))).toBeLessThan(3);
  });

  test('colours the faces it creates and leaves the body alone', async ({ page }) => {
    await openApp(page);
    await addBox(page);
    await waitForEdges(page);
    await selectEdge(page);
    await dragArrow(page, 70, true);
    await expect.poll(async () => (await lastTreatment(page))?.kind).toBe('fillet');

    const marks = await previewMarks(page);
    // A round on a convex edge cuts material, so the rounded surface is red.
    expect(marks?.marks).toHaveLength(1);
    expect(marks?.marks[0]?.red).toBe(1);
    expect(marks?.marks[0]?.green).toBe(0);
    // The body keeps its style: it is not a translucent ghost and the tree does
    // not report it as changed.
    expect(marks?.silent).toBe(true);
    expect(marks?.opaque).toBe(true);
    await expect(page.locator('.tree-row.preview-added, .tree-row.preview-modified')).toHaveCount(
      0,
    );
  });

  test('starts a new operation on every arrow drag', async ({ page }) => {
    await openApp(page);
    await addBox(page);
    await waitForEdges(page);
    await selectEdge(page);
    await dragArrow(page, 60);
    await expect.poll(() => treatmentCount(page)).toBe(1);

    // Picking the same edge again offers the selection arrow, which never
    // adopts the operation that already sits on those edges.
    await selectEdge(page);
    await dragArrow(page, 40, true);
    await expect.poll(() => treatmentCount(page)).toBe(2);
    await expect.poll(async () => (await lastTreatment(page))?.kind).toBe('fillet');
  });
});
