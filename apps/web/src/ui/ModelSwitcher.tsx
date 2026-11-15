import { activeModel } from '@icancad/model';
import clsx from 'clsx';
import { Boxes, ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocumentStore } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import { IconButton } from './Controls';
import { showContextMenu, type ContextMenuItem } from './ContextMenu';
import { RenameInput } from './RenameInput';

/**
 * The project's super-objects above the object tree: a collapsed header names
 * the edited model, expanding it shows the project structure and the models in
 * it. The plus opens the list of super-object kinds; adding one starts naming it
 * at once, while renaming and deleting live in the row menu.
 */
export function ModelSwitcher() {
  const { t } = useTranslation();
  const project = useDocumentStore((state) => state.project);
  const setActiveModel = useDocumentStore((state) => state.setActiveModel);
  const addModel = useDocumentStore((state) => state.addModel);
  const renameModel = useDocumentStore((state) => state.renameModel);
  const deleteModel = useDocumentStore((state) => state.deleteModel);
  const expanded = useUiStore((state) => state.modelListExpanded);
  const setExpanded = useUiStore((state) => state.setModelListExpanded);
  const [renaming, setRenaming] = useState<string | null>(null);
  const model = activeModel(project);
  const onlyModel = project.superObjects.length === 1;

  const menuItems = (modelId: string): ContextMenuItem[] => [
    {
      id: 'rename',
      label: t('model.rename'),
      icon: <Pencil size={14} />,
      onSelect: () => setRenaming(modelId),
    },
    {
      id: 'delete',
      label: t('model.delete'),
      icon: <Trash2 size={14} />,
      danger: true,
      disabled: onlyModel,
      onSelect: () => deleteModel(modelId),
    },
  ];

  return (
    <div className="model-switcher" data-testid="model-switcher">
      <div className="disclosure-header">
        <button
          type="button"
          className="disclosure-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown size={14} className="disclosure-chevron" aria-hidden="true" />
          ) : (
            <ChevronRight size={14} className="disclosure-chevron" aria-hidden="true" />
          )}
          <span className="disclosure-title">{expanded ? t('model.structure') : model.name}</span>
        </button>
        <IconButton
          label={t('model.add')}
          className="tiny"
          onClick={(event) =>
            showContextMenu(event, [
              {
                id: 'model',
                label: t('model.defaultName'),
                icon: <Boxes size={14} />,
                onSelect: () => {
                  const id = addModel(t('model.defaultName'));
                  if (!id) return;
                  setExpanded(true);
                  setRenaming(id);
                },
              },
            ])
          }
        >
          <Plus size={14} />
        </IconButton>
      </div>

      {expanded && (
        <div className="model-list" role="list">
          {project.superObjects.map((superObject) => {
            const active = superObject.id === project.activeSuperObjectId;
            return (
              <div
                key={superObject.id}
                role="listitem"
                className={clsx('model-row', active && 'active')}
                onContextMenu={(event) => showContextMenu(event, menuItems(superObject.id))}
              >
                {renaming === superObject.id ? (
                  <span className="tree-main">
                    <span className="tree-icon">
                      <Boxes size={14} />
                    </span>
                    <RenameInput
                      label={t('model.name')}
                      value={superObject.name}
                      onCommit={(name) => {
                        setRenaming(null);
                        renameModel(superObject.id, name);
                      }}
                      onCancel={() => setRenaming(null)}
                    />
                  </span>
                ) : (
                  <button
                    type="button"
                    className="tree-main"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => setActiveModel(superObject.id)}
                    onDoubleClick={() => setRenaming(superObject.id)}
                  >
                    <span className="tree-icon">
                      <Boxes size={14} />
                    </span>
                    <span className="tree-name">{superObject.name}</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="model-switcher-divider" />
    </div>
  );
}
