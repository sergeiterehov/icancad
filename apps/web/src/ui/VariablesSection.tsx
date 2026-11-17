import {
  createId,
  uniqueVariableName,
  variableNameProblem,
  variableSourceProblem,
  type ParamValue,
  type Variable,
  type VariableType,
} from '@icancad/model';
import { Hash, Plus, Trash2, Type } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { renameVariable } from '../formula/rename';
import { useDocumentStore } from '../stores/documentStore';
import { useFormulaStore } from '../stores/formulaStore';
import { IconButton, PanelSection, ParamField } from './Controls';
import { showContextMenu } from './ContextMenu';
import { formulaMessage } from './formulaMessage';
import { parseNumber } from './numberStep';
import { RenameInput } from './RenameInput';
import { Tooltip } from './Tooltip';

function TextSourceInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className="input variable-value"
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/** A variable is a plain number unless its source is a `=` formula. */
function authoredSource(source: string): ParamValue {
  const text = source.trim();
  const value = parseNumber(text);
  return text !== '' && Number.isFinite(value) ? value : { formula: source };
}

const NAME_PROBLEMS = {
  EMPTY: 'formula.errors.INVALID_NAME',
  INVALID: 'formula.errors.INVALID_NAME',
  RESERVED: 'formula.errors.RESERVED',
} as const;

/** Variables of the project or of one model, edited in place. */
export function VariablesSection({
  modelId,
  embedded = false,
}: {
  modelId?: string;
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const project = useDocumentStore((state) => state.project);
  const apply = useDocumentStore((state) => state.apply);
  const resolution = useFormulaStore((state) => state.resolution);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; message: string } | null>(null);
  const model = modelId
    ? project.superObjects.find((superObject) => superObject.id === modelId)
    : undefined;
  const variables = model ? model.variables : project.variables;
  const allVariables = [
    ...project.variables,
    ...project.superObjects.flatMap((superObject) => superObject.variables),
  ];
  const allNames = allVariables.map((variable) => variable.name);

  const replace = (variable: Variable) =>
    model
      ? apply({ type: 'model-variable/replace', modelId: model.id, variable })
      : apply({ type: 'variable/replace', variable });

  const add = () => {
    const variable: Variable = {
      id: createId('var'),
      name: uniqueVariableName(allNames),
      type: 'number',
      source: '0',
    };
    const added = model
      ? apply({ type: 'model-variable/add', modelId: model.id, variable })
      : apply({ type: 'variable/add', variable });
    if (added) setRenaming(variable.id);
  };

  const changeName = async (variable: Variable, name: string) => {
    setRenaming(null);
    setProblem(null);
    const issue = variableNameProblem(name);
    if (issue) {
      setProblem({
        id: variable.id,
        message: t(NAME_PROBLEMS[issue] as never) as unknown as string,
      });
      return;
    }
    if (allVariables.some((candidate) => candidate.id !== variable.id && candidate.name === name)) {
      setProblem({ id: variable.id, message: t('formula.errors.DUPLICATE') });
      return;
    }
    try {
      const commands = await renameVariable(project, variable.id, name.trim(), model?.id);
      if (commands.length > 0) apply(...commands);
    } catch {
      setProblem({
        id: variable.id,
        message: t('formula.errors.VALUE', { message: name }),
      });
    }
  };

  const changeType = (variable: Variable, type: VariableType) => {
    if (variable.type === type) return;
    // A text source is not an expression, so a number starts from zero.
    const source =
      type === 'number' ? (variable.type === 'number' ? variable.source : '0') : variable.source;
    replace({ ...variable, type, source });
  };

  const rowError = (variable: Variable) => {
    const sourceProblem = variableSourceProblem(variable);
    if (sourceProblem) return t('formula.errors.VALUE', { message: sourceProblem });
    return formulaMessage(t, resolution?.variableErrors[variable.name]);
  };

  return (
    <PanelSection
      title={t('formula.variables')}
      count={variables.length}
      divided={!embedded}
      className={embedded ? 'variables-section-embedded' : undefined}
      action={
        <IconButton label={t('formula.variableAdd')} className="tiny" onClick={add}>
          <Plus size={14} />
        </IconButton>
      }
    >
      <div data-testid={model ? 'model-variables-section' : 'variables-section'}>
        {variables.length === 0 ? (
          <p className="panel-hint">{t('formula.empty')}</p>
        ) : (
          <div className="variables-list" role="list">
            {variables.map((variable) => {
              const error = rowError(variable);
              const value = resolution?.variableValues[variable.name];
              return (
                <div className="variable-row" role="listitem" key={variable.id}>
                  <div className="variable-main">
                    <Tooltip
                      content={
                        variable.type === 'number'
                          ? t('formula.typeNumber')
                          : t('formula.typeString')
                      }
                    >
                      <button
                        type="button"
                        className="variable-type"
                        aria-label={t('formula.typeNumber')}
                        onClick={(event) =>
                          showContextMenu(event, [
                            {
                              id: 'number',
                              label: t('formula.typeNumber'),
                              icon: <Hash size={14} />,
                              onSelect: () => changeType(variable, 'number'),
                            },
                            {
                              id: 'string',
                              label: t('formula.typeString'),
                              icon: <Type size={14} />,
                              onSelect: () => changeType(variable, 'string'),
                            },
                          ])
                        }
                      >
                        {variable.type === 'number' ? <Hash size={13} /> : <Type size={13} />}
                      </button>
                    </Tooltip>
                    {renaming === variable.id ? (
                      <RenameInput
                        label={t('formula.name')}
                        value={variable.name}
                        onCommit={(name) => void changeName(variable, name)}
                        onCancel={() => setRenaming(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        className="variable-name"
                        onClick={() => setRenaming(variable.id)}
                      >
                        {variable.name}
                      </button>
                    )}
                    {variable.type === 'number' ? (
                      <ParamField
                        label={`${variable.name} · ${t('formula.source')}`}
                        value={authoredSource(variable.source)}
                        resolved={typeof value === 'number' ? value : undefined}
                        allowNegative
                        error={error}
                        onCommit={(next) =>
                          replace({
                            ...variable,
                            source: typeof next === 'number' ? String(next) : next.formula,
                          })
                        }
                      />
                    ) : (
                      <TextSourceInput
                        label={`${variable.name} · ${t('formula.value')}`}
                        value={variable.source}
                        onCommit={(source) => replace({ ...variable, source })}
                      />
                    )}
                    <IconButton
                      label={t('formula.variableDelete')}
                      tooltip={t('formula.variableDelete')}
                      className="tiny"
                      onClick={() =>
                        model
                          ? apply({
                              type: 'model-variable/remove',
                              modelId: model.id,
                              variableId: variable.id,
                            })
                          : apply({ type: 'variable/remove', variableId: variable.id })
                      }
                    >
                      <Trash2 size={13} />
                    </IconButton>
                  </div>
                  {(problem?.id === variable.id || error) && (
                    <p className="variable-error">
                      {problem?.id === variable.id ? problem.message : error}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PanelSection>
  );
}
