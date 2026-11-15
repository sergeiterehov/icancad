import { createProject, parseProject, type Feature, type Project } from '@icancad/model';
import { i18n } from '../i18n';
import { useDocumentStore } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import { deleteAsset, listProjects, loadProject, setSetting } from './db';
import { queueProjectDelete, queueProjectSave } from './saveQueue';

/** Local projects, newest first, as the project menu lists them. */
export async function listLocalProjects(): Promise<Project[]> {
  const projects = await listProjects();
  return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function importedAssetIds(project: Project): string[] {
  // Stored projects may still be version 2 and carry a flat feature list.
  const models = project.superObjects ?? [];
  const features =
    models.length > 0
      ? models.flatMap((superObject) => superObject.features)
      : ((project as unknown as { features?: Feature[] }).features ?? []);
  return features.flatMap((feature) => (feature.type === 'import-mesh' ? [feature.assetId] : []));
}

function applyProject(project: Project): void {
  const ui = useUiStore.getState();
  ui.endPicking();
  ui.setActiveSketch(null);
  useDocumentStore.getState().hydrate(project);
}

/** Saves the open project now, so lists and switches see its latest state. */
export async function flushCurrentProject(): Promise<void> {
  const { project, hydrated } = useDocumentStore.getState();
  if (hydrated) await queueProjectSave(project);
}

/**
 * Writes the current project, swaps the document and remembers the choice, so a
 * project switch never leaves the previous edits to the autosave debounce.
 */
export async function switchToProject(project: Project): Promise<void> {
  const { project: current, hydrated } = useDocumentStore.getState();
  if (hydrated && current.id !== project.id) await queueProjectSave(current);
  applyProject(project);
  await queueProjectSave(project);
  await setSetting('lastProjectId', project.id);
}

export async function createAndOpenProject(name: string): Promise<void> {
  await switchToProject(createProject(name, i18n.t('model.defaultName')));
}

export async function openProjectById(id: string): Promise<boolean> {
  try {
    const stored = await loadProject(id);
    if (!stored) return false;
    await switchToProject(parseProject(stored, { modelName: i18n.t('model.defaultName') }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Deletes a project and the imported meshes no other project refers to. Removing
 * the open project opens the next one, or a fresh document when it was the last.
 */
export async function deleteLocalProject(id: string, fallbackName: string): Promise<void> {
  const projects = await listLocalProjects();
  const target = projects.find((project) => project.id === id);
  if (!target) return;
  const remaining = projects.filter((project) => project.id !== id);
  const referenced = new Set(remaining.flatMap(importedAssetIds));
  const orphaned = importedAssetIds(target).filter((assetId) => !referenced.has(assetId));

  if (useDocumentStore.getState().project.id === id) {
    const stored = remaining[0];
    let next: Project;
    try {
      next = stored
        ? parseProject(stored, { modelName: i18n.t('model.defaultName') })
        : createProject(fallbackName, i18n.t('model.defaultName'));
    } catch {
      next = createProject(fallbackName, i18n.t('model.defaultName'));
    }
    // Hydrating first cancels the pending autosave of the project being deleted.
    applyProject(next);
    await queueProjectDelete(id);
    await queueProjectSave(next);
    await setSetting('lastProjectId', next.id);
  } else {
    await queueProjectDelete(id);
  }

  await Promise.all(orphaned.map((assetId) => deleteAsset(assetId)));
}
