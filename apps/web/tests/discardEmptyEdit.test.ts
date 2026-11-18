import {
  activeModel,
  createProject,
  sketchObjectId,
  type BodyEdgeRef,
  type Feature,
  type Project,
  type SketchEntity,
  updateActiveModel,
} from '@icancad/model';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDocumentStore } from '../src/stores/documentStore';
import { useKernelStore } from '../src/stores/kernelStore';
import { useUiStore } from '../src/stores/uiStore';

function line(): SketchEntity {
  return { id: 'line', type: 'line', construction: false, x1: 0, y1: 0, x2: 10, y2: 0 };
}

function sketch(id: string, entities: SketchEntity[] = []): Feature {
  return {
    id,
    name: id,
    suppressed: false,
    type: 'sketch',
    plane: { type: 'datum', plane: 'XY', offset: 0 },
    entities,
    constraints: [],
    references: [],
  };
}

function box(id: string): Feature {
  return {
    id,
    name: id,
    suppressed: false,
    type: 'primitive',
    kind: 'box',
    params: { dx: 10, dy: 10, dz: 10 },
    transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
  };
}

function reset(...features: Feature[]): void {
  useUiStore.setState({
    activeSketchId: null,
    pickingExtrude: null,
    pickingEdges: null,
    pickingShellBodies: null,
    pickingShellFaces: null,
    pickingArrayBodies: null,
    pickingArrayOperations: null,
  });
  useKernelStore.setState({ featureErrors: {} });
  const project: Project = updateActiveModel(createProject(), (model) => ({
    ...model,
    features,
    // A picked body has to exist, or the history check rejects the operation
    // that points at it.
    bodies: features
      .filter((candidate) => candidate.type === 'primitive')
      .map((candidate) => ({ id: candidate.id, createdBy: candidate.id })),
  }));
  useDocumentStore.getState().hydrate(project);
}

function features(): Feature[] {
  return activeModel(useDocumentStore.getState().project).features;
}

function feature(id: string): Feature | undefined {
  return features().find((candidate) => candidate.id === id);
}

function extrudeFeature(id: string): Extract<Feature, { type: 'extrude' }> {
  const found = feature(id);
  if (found?.type !== 'extrude') throw new Error(`no extrude ${id}`);
  return found;
}

/** Enters a sketch the way the sketch editor does and leaves it again. */
function editSketch(id: string): void {
  useUiStore.setState({ activeSketchId: id });
  useDocumentStore.getState().beginFeatureEdit(id);
  useUiStore.setState({ activeSketchId: null });
  useDocumentStore.getState().endFeatureEdit();
}

describe('discarding an operation that was never configured', () => {
  beforeEach(() => reset(box('a'), box('b')));

  it('takes an empty sketch off the timeline when it is left', () => {
    const id = useDocumentStore.getState().addSketch('Sketch', 'XY');
    expect(id).toBeTruthy();
    editSketch(id!);
    expect(feature(id!)).toBeUndefined();
    // The step that created it goes too: undo does not bring the empty sketch
    // back, because nothing of it is left in the document.
    expect(useDocumentStore.getState().past).toHaveLength(0);
    expect(
      activeModel(useDocumentStore.getState().project).metadata[sketchObjectId(id!)],
    ).toBeUndefined();
  });

  it('keeps an empty sketch finished from the toolbar', () => {
    const id = useDocumentStore.getState().addSketch('Sketch', 'XY')!;
    useUiStore.setState({ activeSketchId: id });
    useDocumentStore.getState().beginFeatureEdit(id);
    useDocumentStore.getState().keepFreshSketch();
    useUiStore.setState({ activeSketchId: null });
    useDocumentStore.getState().endFeatureEdit();
    expect(feature(id)).toBeDefined();
  });

  it('keeps an empty sketch whose placement was changed', () => {
    const id = useDocumentStore.getState().addSketch('Sketch', 'XY')!;
    useUiStore.setState({ activeSketchId: id });
    useDocumentStore.getState().beginFeatureEdit(id);
    const current = feature(id);
    if (current?.type !== 'sketch') throw new Error('expected a sketch');
    useDocumentStore.getState().apply({
      type: 'feature/replace',
      feature: { ...current, plane: { type: 'datum', plane: 'XZ', offset: 5 } },
    });
    useUiStore.setState({ activeSketchId: null });
    useDocumentStore.getState().endFeatureEdit();
    expect(feature(id)).toBeDefined();
  });

  it('keeps a sketch once a curve is in it', () => {
    const id = useDocumentStore.getState().addSketch('Sketch', 'XY')!;
    useUiStore.setState({ activeSketchId: id });
    useDocumentStore.getState().beginFeatureEdit(id);
    useDocumentStore.getState().apply({ type: 'feature/replace', feature: sketch(id, [line()]) });
    useUiStore.setState({ activeSketchId: null });
    useDocumentStore.getState().endFeatureEdit();
    expect(feature(id)).toBeDefined();
  });

  it('leaves an older empty sketch alone when it is edited again', () => {
    reset(box('a'), sketch('s'));
    const id = useDocumentStore.getState().addSketch('Sketch', 'XY')!;
    editSketch(id);
    editSketch('s');
    expect(feature('s')).toBeDefined();
  });

  it('takes an extrude without objects off the timeline', () => {
    const id = useDocumentStore.getState().addExtrude('Extrude')!;
    expect(feature(id)).toBeDefined();
    useDocumentStore.getState().endFeatureEdit();
    expect(feature(id)).toBeUndefined();
    expect(features()).toHaveLength(2);
  });

  it('keeps an extrude built from a sketch', () => {
    reset(sketch('s'));
    const id = useDocumentStore.getState().addExtrude('Extrude', { sketchId: 's', regions: [] })!;
    useDocumentStore.getState().endFeatureEdit();
    expect(feature(id)).toBeDefined();
  });

  it('keeps an extrude once faces are picked', () => {
    reset(box('b'));
    const id = useDocumentStore.getState().addExtrude('Extrude')!;
    useDocumentStore.getState().apply({
      type: 'feature/replace',
      feature: {
        ...extrudeFeature(id),
        faceRefs: [{ bodyId: 'b', faceId: '0', normal: [0, 0, 1], origin: [0, 0, 0] }],
      },
    });
    useDocumentStore.getState().endFeatureEdit();
    expect(feature(id)).toBeDefined();
  });

  it('keeps an emptied operation that was already left once', () => {
    reset(box('b'));
    const id = useDocumentStore.getState().addExtrude('Extrude')!;
    useDocumentStore.getState().apply({
      type: 'feature/replace',
      feature: {
        ...extrudeFeature(id),
        faceRefs: [{ bodyId: 'b', faceId: '0', normal: [0, 0, 1], origin: [0, 0, 0] }],
      },
    });
    // The first visit ends with an operation that has something to work on.
    useDocumentStore.getState().endFeatureEdit();
    expect(feature(id)).toBeDefined();

    useDocumentStore.getState().select({ kind: 'feature', id });
    useDocumentStore.getState().apply({
      type: 'feature/replace',
      feature: { ...extrudeFeature(id), faceRefs: [] },
    });
    useDocumentStore.getState().select(null);
    // Only the first visit decides: the user came back on purpose.
    expect(feature(id)).toBeDefined();
  });

  it('takes an edge treatment without edges or faces off the timeline', () => {
    const id = useDocumentStore.getState().addEdgeTreatment('Fillet')!;
    useDocumentStore.getState().endFeatureEdit();
    expect(feature(id)).toBeUndefined();
  });

  it('keeps an edge treatment created from a picked edge', () => {
    reset(box('b'));
    const ref: BodyEdgeRef = {
      bodyId: 'b',
      edgeId: '1',
      faceIds: [0, 1],
      start: [0, 0, 0],
      mid: [0, 0, 0],
      end: [0, 0, 0],
      bisector: [0, 0, 1],
    };
    const id = useDocumentStore.getState().addEdgeTreatment('Fillet', { edgeRefs: [ref] })!;
    useDocumentStore.getState().endFeatureEdit();
    expect(feature(id)).toBeDefined();
  });

  it('takes a shell without targets off the timeline', () => {
    const id = useDocumentStore.getState().addShell('Shell')!;
    useDocumentStore.getState().endFeatureEdit();
    expect(feature(id)).toBeUndefined();
  });

  it('keeps a shell created from picked bodies', () => {
    const id = useDocumentStore.getState().addShell('Shell', { bodyIds: ['a'] })!;
    useDocumentStore.getState().endFeatureEdit();
    expect(feature(id)).toBeDefined();
  });

  it('takes an array without sources off the timeline', () => {
    const id = useDocumentStore.getState().addArray('Array')!;
    useDocumentStore.getState().endFeatureEdit();
    expect(feature(id)).toBeUndefined();
  });

  it('keeps an array created from picked operations', () => {
    const id = useDocumentStore.getState().addArray('Array', { featureIds: ['a'] })!;
    useDocumentStore.getState().endFeatureEdit();
    expect(feature(id)).toBeDefined();
  });

  it('discards on a click into empty space, not only on the done button', () => {
    const id = useDocumentStore.getState().addExtrude('Extrude')!;
    useDocumentStore.getState().select(null);
    expect(feature(id)).toBeUndefined();
  });

  it('discards when the timeline caret moves away', () => {
    const id = useDocumentStore.getState().addExtrude('Extrude')!;
    useDocumentStore.getState().setHistoryEnd('a');
    expect(feature(id)).toBeUndefined();
    expect(activeModel(useDocumentStore.getState().project).historyEnd).toBe('a');
  });

  it('keeps a configured operation that fails', () => {
    reset(sketch('s'));
    const id = useDocumentStore.getState().addExtrude('Extrude', { sketchId: 's', regions: [] })!;
    useKernelStore.setState({ featureErrors: { [id]: 'NO_PROFILE' } });
    useDocumentStore.getState().endFeatureEdit();
    expect(feature(id)).toBeDefined();
  });
});
