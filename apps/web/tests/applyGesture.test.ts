import { createProject, type Feature, type Project } from '@icancad/model';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDocumentStore } from '../src/stores/documentStore';
import { useUiStore } from '../src/stores/uiStore';

function box(id: string, name = id): Feature {
  return {
    id,
    name,
    suppressed: false,
    type: 'primitive',
    kind: 'box',
    params: { dx: 10, dy: 10, dz: 10 },
    transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
  };
}

function projectWith(...features: Feature[]): Project {
  const project = createProject();
  return { ...project, features };
}

function reset(project: Project): void {
  useUiStore.setState({ activeSketchId: null });
  useDocumentStore.getState().hydrate(project);
}

function rename(name: string): void {
  useDocumentStore.getState().apply({ type: 'feature/replace', feature: box('a', name) });
}

function firstName(): string | undefined {
  return useDocumentStore.getState().project.features[0]?.name;
}

function scroll(): void {
  useDocumentStore.getState().beginWheelGesture();
}

function leaveField(): void {
  useDocumentStore.getState().endApplyGesture();
}

describe('apply gestures', () => {
  beforeEach(() => reset(projectWith(box('a'))));

  it('records the value that stays when the field is left', () => {
    scroll();
    rename('one');
    scroll();
    rename('two');
    scroll();
    rename('three');

    // Nothing is recorded while the scroll is still running.
    expect(useDocumentStore.getState().past).toHaveLength(0);
    leaveField();

    const state = useDocumentStore.getState();
    expect(firstName()).toBe('three');
    expect(state.past).toHaveLength(1);
    state.undo();
    expect(firstName()).toBe('a');
  });

  it('records nothing when the value returns to where it started', () => {
    scroll();
    rename('one');
    rename('two');
    rename('a');
    leaveField();

    expect(useDocumentStore.getState().past).toHaveLength(0);
    expect(firstName()).toBe('a');
  });

  it('records nothing when a scroll changes nothing', () => {
    scroll();
    leaveField();
    expect(useDocumentStore.getState().past).toHaveLength(0);
  });

  it('starts a new step for the next visit to the field', () => {
    scroll();
    rename('one');
    leaveField();

    scroll();
    rename('two');
    leaveField();

    expect(useDocumentStore.getState().past).toHaveLength(2);
    useDocumentStore.getState().undo();
    expect(firstName()).toBe('one');
  });

  it('keeps several scrolls of one visit in one step', () => {
    scroll();
    rename('one');
    scroll();
    rename('two');
    leaveField();

    expect(useDocumentStore.getState().past).toHaveLength(1);
    useDocumentStore.getState().undo();
    expect(firstName()).toBe('a');
  });

  it('drops the scroll when the edit is cancelled', () => {
    scroll();
    rename('one');
    scroll();
    rename('two');
    useDocumentStore.getState().cancelApplyGesture();

    expect(firstName()).toBe('a');
    expect(useDocumentStore.getState().past).toHaveLength(0);
    expect(useDocumentStore.getState().applyGesture).toBeNull();
  });

  it('records an open scroll before undoing it', () => {
    scroll();
    rename('one');
    useDocumentStore.getState().undo();

    expect(firstName()).toBe('a');
    expect(useDocumentStore.getState().past).toHaveLength(0);
  });

  it('keeps ordinary changes in their own steps', () => {
    rename('one');
    rename('two');
    expect(useDocumentStore.getState().past).toHaveLength(2);
  });
});
