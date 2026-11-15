import {
  activeModel,
  createProject,
  updateActiveModel,
  type Model,
  type Project,
} from '@icancad/model';

/** A project whose only model carries the given feature history. */
export function modelProject(patch: Partial<Model> = {}, name = 'Test'): Project {
  return updateActiveModel(createProject(name), (model) => ({ ...model, ...patch }));
}

export function modelOf(project: Project): Model {
  return activeModel(project);
}
