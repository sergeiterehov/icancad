import type { ExpressionDiagnostic, FormulaResponse } from '@icancad/formula';
import {
  activeModel,
  applyResolvedValues,
  collectFormulas,
  featureParameterSpecs,
  normalizeParameter,
  type Feature,
  type Model,
  type ResolvedFeature,
  type ResolvedModel,
} from '@icancad/model';
import { useEffect, useMemo, useRef } from 'react';
import { getFormulaEngine } from '../formula/client';
import { useDocumentStore } from '../stores/documentStore';
import { useFormulaStore, type FormulaResolution } from '../stores/formulaStore';

const DEBOUNCE_MS = 80;

interface CachedResolution {
  valuesKey: string;
  resolved: ResolvedFeature;
}

/** Keeps feature identity while its formula values did not change. */
const featureMemo = new WeakMap<Feature, CachedResolution>();

function buildResolution(
  model: Model,
  inputKey: string,
  response: FormulaResponse,
): FormulaResolution {
  const variableValues: Record<string, number | string> = {};
  const variableErrors: Record<string, ExpressionDiagnostic> = {};
  for (const variable of response.variables) {
    if (variable.error) variableErrors[variable.name] = variable.error;
    else if (variable.value !== undefined) variableValues[variable.name] = variable.value;
  }

  const errors: Record<string, Record<string, ExpressionDiagnostic>> = {};
  const drivenSketches = new Set<string>();
  const valuesByTarget = new Map<string, Record<string, number>>();
  for (const result of response.results) {
    if (result.error) {
      (errors[result.targetId] ??= {})[result.path] = result.error;
    } else if (typeof result.value === 'number') {
      if (result.path.startsWith('constraints.')) drivenSketches.add(result.targetId);
      const values = valuesByTarget.get(result.targetId) ?? {};
      values[result.path] = result.value;
      valuesByTarget.set(result.targetId, values);
    }
  }

  const resolvedFeatures = model.features.map((feature): ResolvedFeature => {
    const raw = valuesByTarget.get(feature.id);
    const featureErrors = errors[feature.id];
    const hasFormulas = collectFormulas(feature, feature.id).length > 0;
    if (!raw && !featureErrors && !hasFormulas) return feature as ResolvedFeature;

    const specs = new Map(featureParameterSpecs(feature).map((spec) => [spec.path, spec]));
    const values: Record<string, number> = {};
    for (const [path, value] of Object.entries(raw ?? {})) {
      const spec = specs.get(path);
      values[path] = spec ? normalizeParameter(spec, value) : value;
    }
    const valuesKey = JSON.stringify(values);
    const cached = featureMemo.get(feature);
    if (cached && cached.valuesKey === valuesKey) return cached.resolved;

    const resolved = applyResolvedValues(feature, values) as ResolvedFeature;
    featureMemo.set(feature, { valuesKey, resolved });
    return resolved;
  });

  return {
    model: { ...model, features: resolvedFeatures } as ResolvedModel,
    inputKey,
    variableValues,
    variableErrors,
    errors,
    drivenSketches,
    revision: (useFormulaStore.getState().resolution?.revision ?? 0) + 1,
  };
}

/**
 * Resolves the active model through the Python engine. The result is memoised
 * by the source text, and features whose values did not change keep their
 * identity so the rebuild cache keeps matching.
 */
export function useFormulaResolution(): void {
  const project = useDocumentStore((state) => state.project);
  const model = activeModel(project);
  const status = useFormulaStore((state) => state.status);

  const variables = useMemo(
    () => [
      ...project.variables.map((variable) => ({
        id: variable.id,
        name: variable.name,
        type: variable.type,
        source: variable.source,
        scope: 'project' as const,
      })),
      ...model.variables.map((variable) => ({
        id: variable.id,
        name: variable.name,
        type: variable.type,
        source: variable.source,
        scope: 'model' as const,
      })),
    ],
    [project.variables, model.variables],
  );

  const expressions = useMemo(
    () => model.features.flatMap((feature) => collectFormulas(feature, feature.id)),
    [model.features],
  );

  // The resolved model is the document with formulas replaced, so a literal
  // edit has to reach it too: the key covers the model itself, not only the
  // sources the engine evaluates. Folders are a view of the strip and never a
  // formula or build input (ADR 0032), so their membership and names are
  // dropped: grouping must not restart evaluation or the kernel.
  const inputKey = useMemo(
    () =>
      JSON.stringify(
        { model: { ...model, groups: undefined }, variables, expressions },
        (key, value) => (key === 'groupId' ? undefined : value),
      ),
    [model, variables, expressions],
  );
  // What the engine actually reads. Literal edits and sketch geometry change
  // the model but not this key, so their evaluation result is reused.
  const sourceKey = useMemo(
    () => JSON.stringify({ variables, expressions }),
    [variables, expressions],
  );
  const evaluated = useRef<{ key: string; response: FormulaResponse } | null>(null);

  useEffect(() => {
    const store = useFormulaStore.getState();
    if (store.resolution?.inputKey === inputKey) return;

    if (expressions.length === 0 && variables.length === 0) {
      // Nothing to evaluate, but the rebuild reads this model: it has to follow
      // every literal edit instead of staying at the document it started from.
      // It writes at once: the rebuild compares the model it built against the
      // input key and skips a repeat, so a later write would leave the scene on
      // the previous document until something else changed. A drag does not
      // land here — it writes a live copy, not the document (ADR 0053).
      store.setResolution({
        model: model as unknown as ResolvedModel,
        inputKey,
        variableValues: {},
        variableErrors: {},
        errors: {},
        drivenSketches: new Set<string>(),
        revision: (store.resolution?.revision ?? 0) + 1,
      });
      return;
    }

    if (status !== 'ready') return;
    const cached = evaluated.current;
    if (cached?.key === sourceKey) {
      store.setResolution(buildResolution(model, inputKey, cached.response));
      return;
    }

    let cancelled = false;
    store.setPending(inputKey);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await getFormulaEngine().evaluate({ variables, expressions });
          if (cancelled) return;
          evaluated.current = { key: sourceKey, response };
          useFormulaStore.getState().setResolution(buildResolution(model, inputKey, response));
        } catch (error) {
          if (cancelled) return;
          useFormulaStore
            .getState()
            .setError(error instanceof Error ? error.message : String(error));
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [inputKey, sourceKey, status, model, variables, expressions]);
}
