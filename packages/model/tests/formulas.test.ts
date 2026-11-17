import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  applyResolvedValues,
  collectFormulas,
  activeModel,
  createProject,
  featureParameterSpecs,
  getParameter,
  isDriven,
  parseProject,
  setParameter,
  type BoxPrimitive,
  type Feature,
  type ParamValue,
  type PrimitiveFeature,
  type Project,
} from '../src/index';

const transform = {
  translation: [0, 0, 0] as [ParamValue, ParamValue, ParamValue],
  rotation: [0, 0, 0] as [ParamValue, ParamValue, ParamValue],
  scale: 1,
};

function box(): BoxPrimitive {
  return {
    id: 'feat_box',
    name: 'Box',
    suppressed: false,
    type: 'primitive',
    kind: 'box',
    transform,
    params: { dx: 20, dy: 20, dz: 20 },
  };
}

describe('formula collection', () => {
  it('finds formulas at any depth without knowing the schema', () => {
    const feature: BoxPrimitive = {
      ...box(),
      params: { dx: { formula: 'width' }, dy: 20, dz: { formula: 'width * 2' } },
      transform: { ...transform, translation: [{ formula: 'x' }, 0, 0] },
    };
    expect(collectFormulas(feature, feature.id)).toEqual([
      { targetId: 'feat_box', path: 'transform.translation.0', source: 'x' },
      { targetId: 'feat_box', path: 'params.dx', source: 'width' },
      { targetId: 'feat_box', path: 'params.dz', source: 'width * 2' },
    ]);
  });

  it('finds formulas in arrays', () => {
    const feature: Feature = {
      id: 'feat_array',
      name: 'Array',
      suppressed: false,
      type: 'array',
      target: 'bodies',
      bodyIds: [],
      featureIds: [],
      directions: [
        { kind: 'linear', direction: [1, 0, 0], spacing: { formula: 'gap' }, count: 3 },
        { kind: 'path', paths: [], count: 2 },
      ],
    };
    expect(collectFormulas(feature, feature.id)).toEqual([
      { targetId: 'feat_array', path: 'directions.0.spacing', source: 'gap' },
    ]);
  });
});

describe('resolved values', () => {
  it('replaces formulas and keeps untouched subtrees identical', () => {
    const feature: BoxPrimitive = {
      ...box(),
      params: { dx: { formula: 'width' }, dy: 20, dz: 20 },
    };
    const resolved = applyResolvedValues(feature, { 'params.dx': 42 });
    expect(resolved.params).toEqual({ dx: 42, dy: 20, dz: 20 });
    expect(resolved.params.dx).toBe(42);
  });

  it('returns the same object when nothing is a formula', () => {
    const feature = box();
    expect(applyResolvedValues(feature, {})).toBe(feature);
  });

  it('keeps nested identity when only one branch changed', () => {
    const feature: BoxPrimitive = {
      ...box(),
      params: { dx: { formula: 'width' }, dy: 20, dz: 20 },
    };
    const resolved = applyResolvedValues(feature, { 'params.dx': 1 });
    expect(resolved.transform).toBe(feature.transform);
  });
});

describe('parameters', () => {
  it('addresses parameters by path', () => {
    const feature = box();
    expect(getParameter(feature, 'params.dx')).toBe(20);
    const next = setParameter(feature, 'params.dx', { formula: 'width' });
    expect(isDriven(next, 'params.dx')).toBe(true);
    expect(isDriven(next, 'params.dy')).toBe(false);
  });

  it('addresses a sketch dimension by its structural path', () => {
    const sketch = {
      id: 'feat_sketch',
      name: 'Sketch',
      suppressed: false,
      type: 'sketch',
      plane: { type: 'datum', plane: 'XY', offset: 0 },
      entities: [],
      constraints: [{ id: 'cons_1', type: 'distance', refs: [], value: { formula: 'width' } }],
      references: [],
    } as unknown as Feature;
    const sources = collectFormulas(sketch, sketch.id);
    expect(sources).toEqual([
      { targetId: 'feat_sketch', path: 'constraints.0.value', source: 'width' },
    ]);
    expect(featureParameterSpecs(sketch).map((spec) => spec.path)).toContain(sources[0]?.path);
    expect(isDriven(sketch, 'constraints.0.value')).toBe(true);
  });

  it('cover every parameter path of every kind', () => {
    for (const kind of [
      'box',
      'sphere',
      'cylinder',
      'cone',
      'torus',
      'pyramid',
      'capsule',
    ] as const) {
      const feature = {
        ...box(),
        kind,
        params: {
          dx: 1,
          dy: 1,
          dz: 1,
          radius: 1,
          height: 1,
          bottomRadius: 1,
          topRadius: 0,
          majorRadius: 2,
          tubeRadius: 1,
          sides: 4,
        },
      } as unknown as PrimitiveFeature;
      for (const spec of featureParameterSpecs(feature)) {
        expect(getParameter(feature, spec.path), `${kind}: ${spec.path}`).toBeDefined();
      }
    }
  });
});

describe('variables', () => {
  function projectWithVariable(): Project {
    return applyCommand(createProject(), {
      type: 'variable/add',
      variable: { id: 'var_width', name: 'width', type: 'number', source: '20' },
    });
  }

  it('adds and replaces variables', () => {
    const project = projectWithVariable();
    expect(project.variables).toEqual([
      { id: 'var_width', name: 'width', type: 'number', source: '20' },
    ]);
    const next = applyCommand(project, {
      type: 'variable/replace',
      variable: { id: 'var_width', name: 'height', type: 'number', source: 'width / 2' },
    });
    expect(next.variables[0]?.name).toBe('height');
  });

  it('rejects duplicate and reserved names', () => {
    const project = projectWithVariable();
    expect(() =>
      applyCommand(project, {
        type: 'variable/add',
        variable: { id: 'var_2', name: 'width', type: 'number', source: '1' },
      }),
    ).toThrowError();
    expect(() =>
      applyCommand(project, {
        type: 'variable/add',
        variable: { id: 'var_3', name: 'math', type: 'number', source: '1' },
      }),
    ).toThrowError();
  });

  it('migrates a version 4 document into version 6', () => {
    const raw = JSON.parse(JSON.stringify(createProject())) as Record<string, unknown>;
    raw.schemaVersion = 4;
    delete raw.variables;
    const parsed = parseProject(raw);
    expect(parsed.schemaVersion).toBe(6);
    expect(parsed.variables).toEqual([]);
    expect(activeModel(parsed).variables).toEqual([]);
  });

  it('migrates a version 5 document by adding model variables', () => {
    const raw = JSON.parse(JSON.stringify(createProject())) as Record<string, unknown>;
    raw.schemaVersion = 5;
    delete (raw.superObjects as Record<string, unknown>[])[0]!.variables;
    const parsed = parseProject(raw);
    expect(parsed.schemaVersion).toBe(6);
    expect(activeModel(parsed).variables).toEqual([]);
  });

  it('keeps model variables apart from project variables', () => {
    const project = projectWithVariable();
    const modelId = activeModel(project).id;
    const withModelVariable = applyCommand(project, {
      type: 'model-variable/add',
      modelId,
      variable: { id: 'var_height', name: 'height', type: 'number', source: 'width / 2' },
    });
    expect(activeModel(withModelVariable).variables).toHaveLength(1);
    expect(withModelVariable.variables).toHaveLength(1);
    expect(
      activeModel(parseProject(JSON.parse(JSON.stringify(withModelVariable)))).variables,
    ).toHaveLength(1);
    expect(() =>
      applyCommand(withModelVariable, {
        type: 'variable/add',
        variable: { id: 'var_3', name: 'height', type: 'number', source: '1' },
      }),
    ).toThrowError();
    const renamed = applyCommand(withModelVariable, {
      type: 'model-variable/replace',
      modelId,
      variable: { id: 'var_height', name: 'depth', type: 'number', source: 'width / 2' },
    });
    expect(activeModel(renamed).variables[0]?.name).toBe('depth');
    const removed = applyCommand(renamed, {
      type: 'model-variable/remove',
      modelId,
      variableId: 'var_height',
    });
    expect(activeModel(removed).variables).toEqual([]);
  });
});
