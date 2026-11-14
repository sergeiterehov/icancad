import type { Project } from '@icancad/model';
import { deleteProject, saveProject } from './db';

let chain: Promise<void> = Promise.resolve();

/** Runs a write after every save already queued, so deletes cannot be undone by them. */
export function queueProjectWrite(write: () => Promise<void>): Promise<void> {
  const next = chain.then(write);
  chain = next.catch(() => undefined);
  return next;
}

/**
 * Serializes IndexedDB writes so an in-flight autosave cannot overwrite a
 * newer project (for example right after opening a file).
 */
export function queueProjectSave(project: Project): Promise<void> {
  return queueProjectWrite(() => saveProject(project));
}

/** Removes a project after any save that was already queued for it. */
export function queueProjectDelete(id: string): Promise<void> {
  return queueProjectWrite(() => deleteProject(id));
}
