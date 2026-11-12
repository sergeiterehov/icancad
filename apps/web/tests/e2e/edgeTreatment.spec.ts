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
  kind: 'arrow' | 'track';
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

/** Drag the radial track sideways: right rounds, left chamfers. */
async function dragTrack(page: Page, dx: number) {
  const track = (await handleScreens(page)).find((handle) => handle.kind === 'track');
  expect(track).toBeTruthy();
  // The knob starts at the apex of the arc; an edge keeps it away from the edge
  // itself, which is where the handle's `origin` is.
  const grabX = track!.tipX;
  const grabY = track!.tipY;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(grabX + (dx * step) / 8, grabY);
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
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

test.describe('edge treatment', () => {
  test('rounds an edge by dragging the track to the right', async ({ page }) => {
    await openApp(page);
    await addBox(page);
    await waitForEdges(page);
    await selectEdge(page);

    const handles = await handleScreens(page);
    // An edge offers the track only; extrusion has nothing to work on.
    expect(handles.filter((handle) => handle.kind === 'arrow')).toHaveLength(0);
    expect(handles.filter((handle) => handle.kind === 'track')).toHaveLength(1);

    await dragTrack(page, 70);
    await expect.poll(async () => (await lastTreatment(page))?.kind).toBe('fillet');

    const treatment = await lastTreatment(page);
    expect(treatment?.size).toBeGreaterThan(0.5);
    expect(treatment?.error).toBeUndefined();
    // The operation is focused, so the inspector names its type.
    await expect(page.getByTestId('inspector').getByText('Round', { exact: true })).toBeVisible();
  });

  test('chamfers an edge by dragging the track to the left', async ({ page }) => {
    await openApp(page);
    await addBox(page);
    await waitForEdges(page);
    await selectEdge(page);
    await dragTrack(page, -70);
    await expect.poll(async () => (await lastTreatment(page))?.kind).toBe('chamfer');
    await expect(
      page.getByTestId('inspector').getByText('Chamfer', { exact: true }),
    ).toBeVisible();
  });

  test('rounds the rim of a round boss', async ({ page }) => {
    await openApp(page);
    await addBoss(page);
    await selectClosedEdge(page);

    // A rim is a closed polyline, so this used to fail to resolve its edge.
    await expect
      .poll(async () => (await handleScreens(page)).length, { timeout: 15_000 })
      .toBe(1);
    await dragTrack(page, 70);
    await expect.poll(async () => (await lastTreatment(page))?.kind).toBe('fillet');
    const treatment = await lastTreatment(page);
    expect(treatment?.error).toBeUndefined();
    expect(treatment?.applied).toBeGreaterThan(0);
    // Only the rounded surface is new; the cap and the wall keep their faces.
    await expect(
      page.getByTestId('inspector').getByText('Round', { exact: true }),
    ).toBeVisible();
  });

  test('offers the track next to the extrude arrow on a face', async ({ page }) => {
    await openApp(page);
    await addBox(page);
    await selectFace(page);

    await expect
      .poll(async () => (await handleScreens(page)).length)
      .toBe(2);
    const handles = await handleScreens(page);
    expect(handles.filter((handle) => handle.kind === 'arrow')).toHaveLength(1);
    expect(handles.filter((handle) => handle.kind === 'track')).toHaveLength(1);
  });

  test('reduces a size the geometry cannot take', async ({ page }) => {
    await openApp(page);
    await addBox(page);
    await waitForEdges(page);
    await selectEdge(page);
    await dragTrack(page, 70);
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
});
