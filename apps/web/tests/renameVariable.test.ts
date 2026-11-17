import type { RenameRequest, RenameResponse } from '@icancad/formula';
import {
  activeModel,
  applyCommands,
  createProject,
  type PrimitiveFeature,
  type Project,
} from '@icancad/model';
import { describe, expect, it, vi } from 'vitest';
import { renameVariable } from '../src/formula/rename';

vi.mock('../src/formula/client', () => ({
  getFormulaEngine: () => ({
    rename: async (request: RenameRequest): Promise<RenameResponse> => {
      const rewrite = (source: string) => source.split(request.oldName).join(request.newName);
      return {
        variables: request.variables.map((variable) => ({
          ...variable,
          source: rewrite(variable.source),
        })),
        expressions: request.expressions.map((expression) => ({
          ...expression,
          source: rewrite(expression.source),
        })),
      };
    },
  }),
}));

function box(id: string, source: string): PrimitiveFeature {
  return {
    id,
    name: id,
    suppressed: false,
    type: 'primitive',
    kind: 'box',
    params: { dx: { formula: source }, dy: 20, dz: 20 },
    transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
  };
}

function projectWithModelVariable(): Project {
  const base = applyCommands(createProject(), [
    {
      type: 'variable/add',
      variable: { id: 'var_base', name: 'base', type: 'number', source: '10' },
    },
  ]);
  return applyCommands(base, [
    {
      type: 'model-variable/add',
      modelId: activeModel(base).id,
      variable: { id: 'var_height', name: 'height', type: 'number', source: 'base * 2' },
    },
    { type: 'feature/add', feature: box('usesModel', 'height') },
    { type: 'feature/add', feature: box('usesProject', 'base') },
  ]);
}

describe('variable rename', () => {
  it('rewrites a model variable and only the formulas that use it', async () => {
    const project = projectWithModelVariable();
    const modelId = activeModel(project).id;
    const commands = await renameVariable(project, 'var_height', 'size', modelId);
    expect(commands.map((command) => command.type)).toEqual([
      'model-variable/replace',
      'model/feature/replace',
    ]);

    const next = applyCommands(project, commands);
    expect(activeModel(next).variables[0]).toMatchObject({ name: 'size', source: 'base * 2' });
    expect(activeModel(next).features.find((feature) => feature.id === 'usesModel')).toMatchObject({
      params: { dx: { formula: 'size' } },
    });
    expect(
      activeModel(next).features.find((feature) => feature.id === 'usesProject'),
    ).toMatchObject({
      params: { dx: { formula: 'base' } },
    });
  });

  it('rewrites model variables and formulas when a project variable is renamed', async () => {
    const project = projectWithModelVariable();
    const commands = await renameVariable(project, 'var_base', 'width');
    expect(commands.map((command) => command.type)).toEqual([
      'variable/replace',
      'model-variable/replace',
      'model/feature/replace',
    ]);

    const next = applyCommands(project, commands);
    expect(next.variables[0]?.name).toBe('width');
    expect(activeModel(next).variables[0]?.source).toBe('width * 2');
    expect(
      activeModel(next).features.find((feature) => feature.id === 'usesProject'),
    ).toMatchObject({ params: { dx: { formula: 'width' } } });
  });
});
