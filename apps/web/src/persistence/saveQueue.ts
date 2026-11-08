import type { Project } from '@icancad/model';
import { saveProject } from './db';

let chain: Promise<void> = Promise.resolve();

/**
 * Serializes IndexedDB writes so an in-flight autosave cannot overwrite a
 * newer project (for example right after opening a file).
 */
export function queueProjectSave(project: Project): Promise<void> {
  const next = chain.then(() => saveProject(project));
  chain = next.catch(() => undefined);
  return next;
}
