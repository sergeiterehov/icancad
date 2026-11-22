import { expect, test, type Page } from '@playwright/test';
import type {
  BodyEdgeRef,
  EdgeTreatmentFeature,
  ExtrudeFeature,
  SketchEntity,
  SketchFeature,
} from '@icancad/model';

type MeshEdge = {
  id: string;
  name?: string;
  points: number[];
  closed: boolean;
};

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
          const url = (suffix: string) =>
            performance
              .getEntriesByType('resource')
              .map((entry) => entry.name)
              .find((name) => name.includes(suffix));
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

async function modelState(page: Page) {
  return page.evaluate(async () => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const doc = await import(url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts');
    const kernel = await import(url('/src/stores/kernelStore.ts') ?? '/src/stores/kernelStore.ts');
    const state = doc.useDocumentStore.getState();
    const model = state.project.superObjects.find(
      (candidate: { id: string }) => candidate.id === state.project.activeSuperObjectId,
    );
    const kernelState = kernel.useKernelStore.getState();
    return {
      featureErrors: kernelState.featureErrors,
      featureObjectErrors: kernelState.featureObjectErrors,
      featureLimits: kernelState.featureLimits,
      bodies: model?.bodies.map((body: { id: string }) => body.id) ?? [],
    };
  });
}

async function createBaseSketch(page: Page) {
  return page.evaluate(async () => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const doc = await import(url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts');
    const store = doc.useDocumentStore.getState();
    const sketchId = store.addSketch('Base sketch', 'YZ');
    if (!sketchId) throw new Error('SKETCH_NOT_CREATED');
    const current = doc.useDocumentStore.getState();
    const model = current.project.superObjects.find(
      (candidate: { id: string }) => candidate.id === current.project.activeSuperObjectId,
    );
    const sketch = model.features.find(
      (feature: { id: string }) => feature.id === sketchId,
    ) as SketchFeature;
    const entities: SketchEntity[] = [
      { id: 'line-left', type: 'line', construction: false, x1: -30.63168943941933, y1: 0, x2: -30.63168943941933, y2: -5 },
      { id: 'line-bottom', type: 'line', construction: false, x1: -30.63168943941933, y1: -5, x2: 57.32603178227458, y2: -5 },
      { id: 'line-right', type: 'line', construction: false, x1: 57.32603178227458, y1: -5, x2: 57.32603178227458, y2: 0 },
      { id: 'line-step-right', type: 'line', construction: false, x1: 57.32603178227458, y1: 0, x2: 5, y2: 0 },
      { id: 'line-post-right', type: 'line', construction: false, x1: 5, y1: 0, x2: 5, y2: 82.29785952068544 },
      { id: 'line-post-top', type: 'line', construction: false, x1: 5, y1: 82.29785952068544, x2: 0, y2: 82.29785952068544 },
      { id: 'line-post-left', type: 'line', construction: false, x1: 0, y1: 82.29785952068544, x2: 0, y2: 0 },
      { id: 'line-step-left', type: 'line', construction: false, x1: 0, y1: 0, x2: -30.63168943941933, y2: 0 },
    ];
    current.apply({ type: 'feature/replace', feature: { ...sketch, entities } });
    doc.useDocumentStore.getState().endFeatureEdit();
    return sketchId;
  });
}

async function createBaseExtrude(page: Page, sketchId: string) {
  return page.evaluate(async (id) => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const doc = await import(url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts');
    const store = doc.useDocumentStore.getState();
    const featureId = store.addExtrude('Body', { sketchId: id });
    if (!featureId) throw new Error('EXTRUDE_NOT_CREATED');
    const current = doc.useDocumentStore.getState();
    const model = current.project.superObjects.find(
      (candidate: { id: string }) => candidate.id === current.project.activeSuperObjectId,
    );
    const feature = model.features.find(
      (candidate: { id: string }) => candidate.id === featureId,
    ) as ExtrudeFeature;
    current.apply({
      type: 'feature/replace',
      feature: {
        ...feature,
        end: 'symmetric',
        distance: 20,
        reversed: false,
        op: 'new',
        scope: 'all',
        bodyIds: [],
        regions: [],
        faceRefs: [],
        objectOrder: [`s:${id}#*`],
      },
    });
    doc.useDocumentStore.getState().endFeatureEdit();
    return featureId;
  }, sketchId);
}

async function addFillet(page: Page) {
  return page.evaluate(async () => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const doc = await import(url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts');
    const kernel = await import(url('/src/stores/kernelStore.ts') ?? '/src/stores/kernelStore.ts');
    const store = doc.useDocumentStore.getState();
    const model = store.project.superObjects.find(
      (candidate: { id: string }) => candidate.id === store.project.activeSuperObjectId,
    );
    const bodyId = model.bodies[0]?.id;
    if (!bodyId) throw new Error('BODY_MISSING');
    const mesh = kernel.useKernelStore.getState().meshes[bodyId];
    if (!mesh?.edges) throw new Error('MESH_MISSING');
    const refs = mesh.edges
      .filter((edge: MeshEdge) => {
        if (edge.closed) return false;
        const z = [];
        const y = [];
        for (let index = 0; index + 2 < edge.points.length; index += 3) {
          z.push(edge.points[index + 2]!);
          y.push(edge.points[index + 1]!);
        }
        return (
          z.every((value) => Math.abs(value) < 1e-5) &&
          (y.every((value) => Math.abs(value) < 1e-5) ||
            y.every((value) => Math.abs(value - 5) < 1e-5))
        );
      })
      .slice(0, 2)
      .map((edge: MeshEdge) => ({
        bodyId,
        name: edge.name ?? '',
        start: [edge.points[0]!, edge.points[1]!, edge.points[2]!],
        mid: [
          (edge.points[0]! + edge.points[edge.points.length - 3]!) / 2,
          (edge.points[1]! + edge.points[edge.points.length - 2]!) / 2,
          (edge.points[2]! + edge.points[edge.points.length - 1]!) / 2,
        ],
        end: [
          edge.points[edge.points.length - 3]!,
          edge.points[edge.points.length - 2]!,
          edge.points[edge.points.length - 1]!,
        ],
        closed: edge.closed,
        bisector: [0, 0, 1],
      }));
    if (refs.length !== 2) throw new Error(`FILLET_EDGES_${refs.length}`);
    const featureId = store.addEdgeTreatment('Round', { edgeRefs: refs });
    if (!featureId) throw new Error('FILLET_NOT_CREATED');
    const current = doc.useDocumentStore.getState();
    const nextModel = current.project.superObjects.find(
      (candidate: { id: string }) => candidate.id === current.project.activeSuperObjectId,
    );
    const feature = nextModel.features.find(
      (candidate: { id: string }) => candidate.id === featureId,
    ) as EdgeTreatmentFeature;
    current.apply({
      type: 'feature/replace',
      feature: { ...feature, kind: 'fillet', size: 12.5 },
    });
    doc.useDocumentStore.getState().endFeatureEdit();
    return featureId;
  });
}

async function addCut(page: Page) {
  return page.evaluate(async () => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const doc = await import(url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts');
    const store = doc.useDocumentStore.getState();
    const sketchId = store.addSketch('Cut sketch', 'XY');
    if (!sketchId) throw new Error('CUT_SKETCH_NOT_CREATED');
    const current = doc.useDocumentStore.getState();
    const model = current.project.superObjects.find(
      (candidate: { id: string }) => candidate.id === current.project.activeSuperObjectId,
    );
    const bodyId = model.bodies[0]?.id;
    const sketch = model.features.find(
      (feature: { id: string }) => feature.id === sketchId,
    ) as SketchFeature;
    const entities: SketchEntity[] = [
      { id: 'hole-circle', type: 'circle', construction: false, cx: 0, cy: 15, r: 2.5 },
    ];
    current.apply({ type: 'feature/replace', feature: { ...sketch, entities } });
    doc.useDocumentStore.getState().endFeatureEdit();
    const featureId = doc
      .useDocumentStore.getState()
      .addExtrude('Cut', { sketchId });
    if (!featureId) throw new Error('CUT_NOT_CREATED');
    const next = doc.useDocumentStore.getState();
    const nextModel = next.project.superObjects.find(
      (candidate: { id: string }) => candidate.id === next.project.activeSuperObjectId,
    );
    const feature = nextModel.features.find(
      (candidate: { id: string }) => candidate.id === featureId,
    ) as ExtrudeFeature;
    next.apply({
      type: 'feature/replace',
      feature: {
        ...feature,
        end: 'through-all',
        reversed: true,
        op: 'subtract',
        scope: 'all',
        bodyIds: bodyId ? [bodyId] : [],
        regions: [],
        faceRefs: [],
        objectOrder: [`s:${sketchId}#*`],
      },
    });
    doc.useDocumentStore.getState().endFeatureEdit();
    return featureId;
  });
}

async function addChamfer(page: Page) {
  return page.evaluate(async () => {
    const url = (suffix: string) =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes(suffix));
    const doc = await import(url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts');
    const kernel = await import(url('/src/stores/kernelStore.ts') ?? '/src/stores/kernelStore.ts');
    const store = doc.useDocumentStore.getState();
    const model = store.project.superObjects.find(
      (candidate: { id: string }) => candidate.id === store.project.activeSuperObjectId,
    );
    const bodyId = model.bodies[0]?.id;
    if (!bodyId) throw new Error('BODY_MISSING');
    const mesh = kernel.useKernelStore.getState().meshes[bodyId];
    if (!mesh?.edges) throw new Error('MESH_MISSING');
    const center: [number, number] = [0, 15];
    const radius = 2.5;
    const edge = mesh.edges.find((candidate: MeshEdge) => {
      if (!candidate.closed) return false;
      for (let index = 0; index + 2 < candidate.points.length; index += 3) {
        const x = candidate.points[index]! - center[0];
        const y = candidate.points[index + 1]! - center[1];
        if (Math.abs(Math.hypot(x, y) - radius) > 1e-3) return false;
      }
      return true;
    });
    if (!edge?.name) throw new Error('CUT_EDGE_MISSING');
    const last = edge.points.length - 3;
    const midIndex = Math.floor(edge.points.length / 6) * 3;
    const ref: BodyEdgeRef = {
      bodyId,
      name: edge.name,
      start: [edge.points[0]!, edge.points[1]!, edge.points[2]!],
      mid: [edge.points[midIndex]!, edge.points[midIndex + 1]!, edge.points[midIndex + 2]!],
      end: [edge.points[last]!, edge.points[last + 1]!, edge.points[last + 2]!],
      closed: true,
      bisector: [0, 0, 1],
    };
    const featureId = store.addEdgeTreatment('Chamfer', { edgeRefs: [ref] });
    if (!featureId) throw new Error('CHAMFER_NOT_CREATED');
    const current = doc.useDocumentStore.getState();
    const nextModel = current.project.superObjects.find(
      (candidate: { id: string }) => candidate.id === current.project.activeSuperObjectId,
    );
    const feature = nextModel.features.find(
      (candidate: { id: string }) => candidate.id === featureId,
    ) as EdgeTreatmentFeature;
    current.apply({
      type: 'feature/replace',
      feature: { ...feature, kind: 'chamfer', size: 1 },
    });
    doc.useDocumentStore.getState().endFeatureEdit();
    return featureId;
  });
}

async function changeWidth(page: Page, left: number, right: number) {
  await page.evaluate(
    async ({ left: nextLeft, right: nextRight }) => {
      const url = (suffix: string) =>
        performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .find((name) => name.includes(suffix));
      const doc = await import(url('/src/stores/documentStore.ts') ?? '/src/stores/documentStore.ts');
      const state = doc.useDocumentStore.getState();
      const model = state.project.superObjects.find(
        (candidate: { id: string }) => candidate.id === state.project.activeSuperObjectId,
      );
      const sketch = model.features.find(
        (feature: { type?: string }) => feature.type === 'sketch',
      ) as SketchFeature;
      const entities = sketch.entities.map((entity): SketchEntity => {
        if (entity.type !== 'line') return entity;
        if (entity.id === 'line-left') return { ...entity, x1: nextLeft, x2: nextLeft };
        if (entity.id === 'line-bottom') return { ...entity, x1: nextLeft, x2: nextRight };
        if (entity.id === 'line-right') return { ...entity, x1: nextRight, x2: nextRight };
        if (entity.id === 'line-step-right') return { ...entity, x1: nextRight };
        if (entity.id === 'line-step-left') return { ...entity, x2: nextLeft };
        return entity;
      });
      state.apply({ type: 'feature/replace', feature: { ...sketch, entities } });
    },
    { left, right },
  );
}

test.describe('persistent topology names', () => {
  test('keeps a fillet and a chamfer after the sketch width changes', async ({ page }) => {
    await openApp(page);
    const sketchId = await createBaseSketch(page);
    await waitForKernelIdle(page);

    await createBaseExtrude(page, sketchId);
    await waitForKernelIdle(page);
    expect((await modelState(page)).bodies).toHaveLength(1);

    const filletId = await addFillet(page);
    await waitForKernelIdle(page);

    await addCut(page);
    await waitForKernelIdle(page);

    const chamferId = await addChamfer(page);
    await waitForKernelIdle(page);

    const before = await modelState(page);
    expect(before.featureErrors).toEqual({});
    expect(before.featureObjectErrors).toEqual({});
    expect(before.featureLimits[filletId]?.applied).toBeGreaterThan(0);
    expect(before.featureLimits[chamferId]?.applied).toBeGreaterThan(0);

    // A sketch edit changes the base width, which used to rename every face
    // through the fuse/unify history and lose both treatments.
    await changeWidth(page, -20, 57.32603178227458);
    await waitForKernelIdle(page);
    const narrowLeft = await modelState(page);
    expect(narrowLeft.featureErrors).toEqual({});
    expect(narrowLeft.featureObjectErrors).toEqual({});
    expect(narrowLeft.featureLimits[filletId]?.applied).toBeGreaterThan(0);
    expect(narrowLeft.featureLimits[chamferId]?.applied).toBeGreaterThan(0);

    await changeWidth(page, -20, 40);
    await waitForKernelIdle(page);
    const narrowBoth = await modelState(page);
    expect(narrowBoth.featureErrors).toEqual({});
    expect(narrowBoth.featureObjectErrors).toEqual({});
    expect(narrowBoth.featureLimits[filletId]?.applied).toBeGreaterThan(0);
    expect(narrowBoth.featureLimits[chamferId]?.applied).toBeGreaterThan(0);
  });
});
