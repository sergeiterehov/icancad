import { activeModel, createProject } from '@icancad/model';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDocumentStore } from '../src/stores/documentStore';
import { useUiStore } from '../src/stores/uiStore';

function reset(): void {
  useUiStore.setState({ activeSketchId: null, toast: null, modelDeleteRequest: null });
  useDocumentStore.getState().hydrate(createProject('Test', 'Model'));
}

describe('project models', () => {
  beforeEach(reset);

  it('starts with one active model', () => {
    const project = useDocumentStore.getState().project;
    expect(project.superObjects).toHaveLength(1);
    expect(activeModel(project).name).toBe('Model');
  });

  it('adds a model, makes it active and clears the selection', () => {
    const store = useDocumentStore.getState();
    store.addPrimitive('Box', 'box');
    const id = useDocumentStore.getState().addModel('Model');
    expect(id).toBeTruthy();
    const project = useDocumentStore.getState().project;
    expect(project.superObjects).toHaveLength(2);
    expect(project.activeSuperObjectId).toBe(id);
    expect(activeModel(project).name).toBe('Model 2');
    expect(activeModel(project).features).toEqual([]);
    expect(useDocumentStore.getState().selection).toEqual([]);
  });

  it('keeps the objects of every model apart', () => {
    const store = useDocumentStore.getState();
    store.addPrimitive('Box', 'box');
    const first = useDocumentStore.getState().project.activeSuperObjectId;
    useDocumentStore.getState().addModel('Model');
    expect(activeModel(useDocumentStore.getState().project).features).toEqual([]);

    useDocumentStore.getState().setActiveModel(first);
    expect(activeModel(useDocumentStore.getState().project).features).toHaveLength(1);
    expect(useDocumentStore.getState().selection).toEqual([]);
  });

  it('does not record a model switch as an undo step', () => {
    const store = useDocumentStore.getState();
    store.addPrimitive('Box', 'box');
    const first = useDocumentStore.getState().project.activeSuperObjectId;
    const before = useDocumentStore.getState().past.length;
    useDocumentStore.getState().addModel('Model');
    const afterAdd = useDocumentStore.getState().past.length;
    useDocumentStore.getState().setActiveModel(first);
    expect(useDocumentStore.getState().past.length).toBe(afterAdd);
    expect(useDocumentStore.getState().past.length).toBeGreaterThan(before);
  });

  it('undo keeps the model the user is looking at', () => {
    useDocumentStore.getState().addPrimitive('Box', 'box');
    const first = useDocumentStore.getState().project.activeSuperObjectId;
    useDocumentStore.getState().addModel('Model');
    useDocumentStore.getState().setActiveModel(first);
    useDocumentStore.getState().undo();
    const project = useDocumentStore.getState().project;
    expect(project.superObjects).toHaveLength(1);
    expect(project.activeSuperObjectId).toBe(first);
  });

  it('renames a model', () => {
    const id = useDocumentStore.getState().project.activeSuperObjectId;
    useDocumentStore.getState().renameModel(id, 'Bracket');
    expect(activeModel(useDocumentStore.getState().project).name).toBe('Bracket');
  });

  it('refuses to delete the last model', () => {
    const id = useDocumentStore.getState().project.activeSuperObjectId;
    useDocumentStore.getState().deleteModel(id);
    expect(useDocumentStore.getState().project.superObjects).toHaveLength(1);
    expect(useUiStore.getState().toast?.key).toBe('errors.LAST_MODEL');
  });

  it('deletes an empty model at once', () => {
    useDocumentStore.getState().addModel('Model');
    const active = useDocumentStore.getState().project.activeSuperObjectId;
    useDocumentStore.getState().deleteModel(active);
    expect(useDocumentStore.getState().project.superObjects).toHaveLength(1);
  });

  it('asks before deleting a model with objects and keeps it undoable', () => {
    useDocumentStore.getState().addPrimitive('Box', 'box');
    const first = useDocumentStore.getState().project.activeSuperObjectId;
    useDocumentStore.getState().addModel('Model');
    const second = useDocumentStore.getState().project.activeSuperObjectId;
    useDocumentStore.getState().setActiveModel(first);

    useDocumentStore.getState().deleteModel(first);
    expect(useUiStore.getState().modelDeleteRequest?.id).toBe(first);
    expect(useDocumentStore.getState().project.superObjects).toHaveLength(2);

    useDocumentStore.getState().removeModel(first);
    expect(useDocumentStore.getState().project.superObjects).toHaveLength(1);
    expect(useDocumentStore.getState().project.activeSuperObjectId).toBe(second);

    useDocumentStore.getState().undo();
    const project = useDocumentStore.getState().project;
    expect(project.superObjects).toHaveLength(2);
    expect(project.activeSuperObjectId).toBe(second);
  });
});
