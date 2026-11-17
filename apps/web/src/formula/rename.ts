import {
  collectFormulas,
  setParameter,
  type Command,
  type Feature,
  type Project,
  type Variable,
} from '@icancad/model';
import { getFormulaEngine } from './client';

interface OwnedVariable {
  variable: Variable;
  modelId?: string;
}

/**
 * Rewrites a variable name inside every source of its scope in one undo step.
 * The engine tokenizes the sources, so a name inside a string or a comment
 * stays untouched.
 *
 * A project variable is visible to every model, so renaming it rewrites every
 * model's variables and formulas. A model variable only reaches its own model.
 */
export async function renameVariable(
  project: Project,
  variableId: string,
  newName: string,
  modelId?: string,
): Promise<Command[]> {
  const targetModel = modelId
    ? project.superObjects.find((superObject) => superObject.id === modelId)
    : undefined;
  const targetVariables = targetModel ? targetModel.variables : project.variables;
  const variable = targetVariables.find((candidate) => candidate.id === variableId);
  if (!variable || variable.name === newName) return [];

  const models = targetModel ? [targetModel] : project.superObjects;
  const variables: OwnedVariable[] = targetModel
    ? targetModel.variables.map((candidate) => ({ variable: candidate, modelId: targetModel.id }))
    : [
        ...project.variables.map((candidate) => ({ variable: candidate })),
        ...project.superObjects.flatMap((superObject) =>
          superObject.variables.map((candidate) => ({
            variable: candidate,
            modelId: superObject.id,
          })),
        ),
      ];
  const expressions = models.flatMap((model) =>
    model.features.flatMap((feature) => collectFormulas(feature, feature.id)),
  );
  const originalSources = new Map(
    expressions.map((expression) => [
      `${expression.targetId}\u0000${expression.path}`,
      expression.source,
    ]),
  );
  const response = await getFormulaEngine().rename({
    oldName: variable.name,
    newName,
    // A text variable holds text, not code: its source is never rewritten.
    variables: variables
      .filter(({ variable: candidate }) => candidate.type === 'number')
      .map(({ variable: candidate }) => ({
        id: candidate.id,
        name: candidate.name,
        type: candidate.type,
        source: candidate.source,
      })),
    expressions,
  });

  const commands: Command[] = [];
  const owners = new Map(variables.map((owned) => [owned.variable.id, owned]));
  for (const rewritten of response.variables) {
    const owner = owners.get(rewritten.id);
    if (!owner) continue;
    const name = rewritten.id === variableId ? newName : owner.variable.name;
    if (owner.variable.source === rewritten.source && owner.variable.name === name) continue;
    const next = { ...owner.variable, name, source: rewritten.source };
    commands.push(
      owner.modelId
        ? { type: 'model-variable/replace', modelId: owner.modelId, variable: next }
        : { type: 'variable/replace', variable: next },
    );
  }

  const featureOwners = new Map<string, { modelId: string; feature: Feature }>();
  for (const model of models) {
    for (const feature of model.features) {
      featureOwners.set(feature.id, { modelId: model.id, feature });
    }
  }

  const byFeature = new Map<string, typeof expressions>();
  for (const expression of response.expressions) {
    const list = byFeature.get(expression.targetId) ?? [];
    list.push(expression);
    byFeature.set(expression.targetId, list);
  }
  for (const [featureId, sources] of byFeature) {
    const owner = featureOwners.get(featureId);
    if (!owner) continue;
    let next = owner.feature;
    for (const source of sources) {
      const original = originalSources.get(`${source.targetId}\u0000${source.path}`);
      if (original === source.source) continue;
      next = setParameter(next, source.path, { formula: source.source });
    }
    if (next !== owner.feature) {
      commands.push({ type: 'model/feature/replace', modelId: owner.modelId, feature: next });
    }
  }
  return commands;
}
