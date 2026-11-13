import {
  createProject,
  HISTORY_START,
  objectVisible,
  sketchObjectId,
  type Feature,
  type Project,
  type SketchEntity,
} from '@icancad/model';
import { sketchTopology } from '@icancad/sketch';
import { beforeEach, describe, expect, it } from 'vitest';
import { projectForView, useDocumentStore } from '../src/stores/documentStore';
import { useKernelStore } from '../src/stores/kernelStore';
import { useUiStore } from '../src/stores/uiStore';

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

function sketch(id: string): Feature {
  return {
    id,
    name: id,
    suppressed: false,
    type: 'sketch',
    plane: { type: 'datum', plane: 'XY', offset: 0 },
    entities: [],
    constraints: [],
    references: [],
  };
}

function projectWith(...features: Feature[]): Project {
  const project = createProject();
  return { ...project, features };
}

function squareSketch(id: string, copies: number): Feature {
  const entities: SketchEntity[] = [];
  for (let index = 0; index < copies; index += 1) {
    const x = index * 10;
    const corners: Array<[number, number]> = [
      [x, 0],
      [x + 5, 0],
      [x + 5, 5],
      [x, 5],
    ];
    corners.forEach(([x1, y1], corner) => {
      const [x2, y2] = corners[(corner + 1) % corners.length]!;
      entities.push({
        id: `line-${index}-${corner}`,
        type: 'line',
        construction: false,
        x1,
        y1,
        x2,
        y2,
      });
    });
  }
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

function extrude(id: string, sketchId: string): Feature {
  return {
    id,
    name: id,
    suppressed: false,
    type: 'extrude',
    sketchId,
    regions: [],
    faceRefs: [],
    objectOrder: [],
    end: 'blind',
    distance: 10,
    reversed: false,
    op: 'new',
    scope: 'all',
    bodyIds: [],
    joinRegions: true,
  };
}

function reset(project: Project): void {
  useUiStore.setState({ activeSketchId: null });
  useKernelStore.setState({ featureErrors: {} });
  useDocumentStore.getState().hydrate(project);
}

function viewCursor(): string | null {
  const state = useDocumentStore.getState();
  return projectForView(state.project, state.editingFeatureId).historyEnd;
}

describe('operation editing', () => {
  beforeEach(() => reset(projectWith(box('a'), box('b'), box('c'))));

  it('shows the state in front of the selected operation', () => {
    useDocumentStore.getState().select({ kind: 'feature', id: 'b' });
    const state = useDocumentStore.getState();
    expect(state.editingFeatureId).toBe('b');
    expect(viewCursor()).toBe('a');
  });

  it('shows the start of history in front of the first operation', () => {
    useDocumentStore.getState().select({ kind: 'feature', id: 'a' });
    expect(viewCursor()).toBe(HISTORY_START);
  });

  it('leaves the user cursor untouched while operations are edited', () => {
    const store = useDocumentStore.getState();
    store.setHistoryEnd('c');
    store.select({ kind: 'feature', id: 'b' });
    // The document keeps the position the user navigated to; only the view
    // rolls back to the input state of the edited operation.
    expect(useDocumentStore.getState().project.historyEnd).toBe('c');
    expect(viewCursor()).toBe('a');
    useDocumentStore.getState().select(null);
    const state = useDocumentStore.getState();
    expect(state.editingFeatureId).toBeNull();
    expect(state.project.historyEnd).toBe('c');
  });

  it('keeps the operation selected while its parameters change', () => {
    const store = useDocumentStore.getState();
    store.select({ kind: 'feature', id: 'b' });
    store.apply({ type: 'feature/replace', feature: { ...box('b'), name: 'renamed' } });
    const state = useDocumentStore.getState();
    expect(state.selection).toEqual([{ kind: 'feature', id: 'b' }]);
    expect(state.editingFeatureId).toBe('b');
    expect(viewCursor()).toBe('a');
  });

  it('ends editing when the caret is moved', () => {
    const store = useDocumentStore.getState();
    store.select({ kind: 'feature', id: 'b' });
    store.setHistoryEnd('c');
    const state = useDocumentStore.getState();
    expect(state.editingFeatureId).toBeNull();
    expect(state.project.historyEnd).toBe('c');
  });

  it('stops editing when the operation is deleted', () => {
    const store = useDocumentStore.getState();
    store.select({ kind: 'feature', id: 'c' });
    store.apply({ type: 'feature/remove', featureId: 'c' });
    const state = useDocumentStore.getState();
    expect(state.editingFeatureId).toBeNull();
    expect(state.selection).toEqual([]);
  });

  it('rolls in front of a sketch operation like any other operation', () => {
    reset(projectWith(box('a'), sketch('s')));
    useDocumentStore.getState().select({ kind: 'feature', id: 's' });
    expect(viewCursor()).toBe('a');
  });

  it('opens the sketch editor against the model before the sketch', () => {
    reset(projectWith(box('a'), sketch('s')));
    useUiStore.setState({ activeSketchId: 's' });
    useDocumentStore.getState().beginFeatureEdit('s');
    expect(useDocumentStore.getState().editingFeatureId).toBe('s');
    expect(viewCursor()).toBe('a');
    useUiStore.setState({ activeSketchId: null });
    useDocumentStore.getState().endFeatureEdit();
    expect(useDocumentStore.getState().editingFeatureId).toBeNull();
    expect(useDocumentStore.getState().project.historyEnd).toBeNull();
  });

  it('shows a hidden sketch while its operation is selected and hides it again', () => {
    const project = projectWith(sketch('s'), box('a'));
    reset({
      ...project,
      metadata: { [sketchObjectId('s')]: { visible: false } },
    });
    const store = useDocumentStore.getState();
    const objectId = sketchObjectId('s');
    expect(objectVisible(store.project, objectId)).toBe(false);

    store.select({ kind: 'feature', id: 's' });
    // Shown, because the operation cannot be configured while it is invisible.
    const editing = useDocumentStore.getState();
    expect(objectVisible(projectForView(editing.project, editing.editingFeatureId), objectId)).toBe(
      true,
    );

    store.select(null);
    // The stored visibility is untouched, so the sketch hides again.
    expect(objectVisible(useDocumentStore.getState().project, objectId)).toBe(false);
  });

  it('shows a hidden sketch while its editor is open and hides it again', () => {
    const project = projectWith(sketch('s'), box('a'));
    reset({
      ...project,
      metadata: { [sketchObjectId('s')]: { visible: false } },
    });
    const objectId = sketchObjectId('s');
    useUiStore.setState({ activeSketchId: 's' });
    useDocumentStore.getState().beginFeatureEdit('s');
    const editing = useDocumentStore.getState();
    expect(objectVisible(projectForView(editing.project, editing.editingFeatureId), objectId)).toBe(
      true,
    );

    useUiStore.setState({ activeSketchId: null });
    useDocumentStore.getState().endFeatureEdit();
    expect(objectVisible(useDocumentStore.getState().project, objectId)).toBe(false);
  });

  it('does not take over the selection while the sketch editor is open', () => {
    reset(projectWith(box('a'), box('b')));
    useUiStore.setState({ activeSketchId: 'a' });
    useDocumentStore.getState().select({ kind: 'feature', id: 'b' });
    expect(useDocumentStore.getState().editingFeatureId).toBeNull();
  });

  it('derives the view project without touching the document', () => {
    const project = projectWith(box('a'), box('b'));
    expect(projectForView(project, null)).toBe(project);
    expect(projectForView(project, 'b').historyEnd).toBe('a');
    expect(project.historyEnd).toBeNull();
  });

  it('shows the sketch of an extrude while the extrude is configured', () => {
    const project = projectWith(sketch('s'), extrude('e', 's'));
    reset({ ...project, metadata: { [sketchObjectId('s')]: { visible: false } } });
    const objectId = sketchObjectId('s');

    useDocumentStore.getState().select({ kind: 'feature', id: 'e' });
    const editing = useDocumentStore.getState();
    expect(editing.editingFeatureId).toBe('e');
    expect(objectVisible(projectForView(editing.project, editing.editingFeatureId), objectId)).toBe(
      true,
    );

    // The stored visibility is untouched, so nothing is hidden by the preview.
    useDocumentStore.getState().select(null);
    expect(objectVisible(useDocumentStore.getState().project, objectId)).toBe(false);
  });

  it('hides a sketch consumed by a new extrude once the extrude is dismissed', () => {
    reset(projectWith(sketch('s')));
    const objectId = sketchObjectId('s');
    const featureId = useDocumentStore.getState().addExtrude('Extrude', {
      sketchId: 's',
      regions: [],
    });
    expect(featureId).toBeTruthy();
    // Still visible while the operation is being configured.
    expect(objectVisible(useDocumentStore.getState().project, objectId)).toBe(true);

    useDocumentStore.getState().endFeatureEdit();
    expect(objectVisible(useDocumentStore.getState().project, objectId)).toBe(false);

    // Reopening the operation shows the sketch again without storing it.
    useDocumentStore.getState().select({ kind: 'feature', id: featureId! });
    const editing = useDocumentStore.getState();
    expect(objectVisible(projectForView(editing.project, editing.editingFeatureId), objectId)).toBe(
      true,
    );
  });

  it('keeps the sketch of an older extrude visible when it is reopened', () => {
    const project = projectWith(sketch('s'), extrude('e', 's'));
    reset(project);
    const objectId = sketchObjectId('s');
    expect(objectVisible(useDocumentStore.getState().project, objectId)).toBe(true);

    useDocumentStore.getState().select({ kind: 'feature', id: 'e' });
    useDocumentStore.getState().select(null);
    expect(objectVisible(useDocumentStore.getState().project, objectId)).toBe(true);
  });

  it('keeps the sketch of a failed new extrude until the operation works', () => {
    reset(projectWith(sketch('s')));
    const objectId = sketchObjectId('s');
    const featureId = useDocumentStore.getState().addExtrude('Extrude', {
      sketchId: 's',
      regions: [],
    });
    useKernelStore.setState({ featureErrors: { [featureId!]: 'EXTRUDE_EMPTY' } });

    useDocumentStore.getState().endFeatureEdit();
    // A failed operation has consumed nothing, so the sketch stays readable.
    expect(objectVisible(useDocumentStore.getState().project, objectId)).toBe(true);

    // The fixed operation hides it on the next dismissal.
    useKernelStore.setState({ featureErrors: {} });
    useDocumentStore.getState().select({ kind: 'feature', id: featureId! });
    useDocumentStore.getState().endFeatureEdit();
    expect(objectVisible(useDocumentStore.getState().project, objectId)).toBe(false);
  });

  it('keeps a sketch that only partly feeds the new extrude', () => {
    const sketchFeature = squareSketch('s', 2);
    reset(projectWith(sketchFeature));
    const objectId = sketchObjectId('s');
    const faces = sketchTopology(
      (sketchFeature as Extract<Feature, { type: 'sketch' }>).entities,
    ).faces;
    expect(faces).toHaveLength(2);

    const partial = useDocumentStore.getState().addExtrude('Extrude', {
      sketchId: 's',
      regions: [faces[0]!.id],
    });
    expect(partial).toBeTruthy();
    useDocumentStore.getState().endFeatureEdit();
    expect(objectVisible(useDocumentStore.getState().project, objectId)).toBe(true);

    // Both profiles are the whole sketch, so the second extrude hides it.
    const whole = useDocumentStore.getState().addExtrude('Extrude 2', {
      sketchId: 's',
      regions: faces.map((face) => face.id),
    });
    expect(whole).toBeTruthy();
    useDocumentStore.getState().endFeatureEdit();
    expect(objectVisible(useDocumentStore.getState().project, objectId)).toBe(false);
  });
});
