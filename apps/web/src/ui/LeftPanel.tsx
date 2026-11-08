import clsx from 'clsx';
import { Eye, EyeOff, Layers, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDocumentStore } from '../stores/documentStore';
import { useKernelStore } from '../stores/kernelStore';
import { isDirectlySelected, linkedBodyIds } from '../stores/selection';
import { IconButton, PanelSection } from './Controls';
import { showContextMenu } from './ContextMenu';
import { formatNumber } from './format';

export function LeftPanel() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
  const project = useDocumentStore((state) => state.project);
  const selection = useDocumentStore((state) => state.selection);
  const select = useDocumentStore((state) => state.select);
  const toggleBodyVisibility = useDocumentStore((state) => state.toggleBodyVisibility);
  const removeFeature = useDocumentStore((state) => state.removeFeature);
  const addBox = useDocumentStore((state) => state.addPrimitiveBox);
  const meshes = useKernelStore((state) => state.meshes);
  const kernelReady = useKernelStore((state) => state.status === 'ready');
  const highlightedBodyIds = linkedBodyIds(selection, project);

  return (
    <div className="panel">
      <header className="panel-header">
        <span>{t('panels.model')}</span>
        <IconButton
          label={t('tree.addBody')}
          disabled={!kernelReady}
          onClick={() => addBox(t('features.box'))}
        >
          <Plus size={15} />
        </IconButton>
      </header>

      <div className="panel-body">
        <PanelSection title={t('tree.bodies')}>
          {project.bodies.length === 0 ? (
            <p className="empty-row">{t('tree.emptyBodies')}</p>
          ) : (
            project.bodies.map((body) => {
              const mesh = meshes[body.id];
              const direct = isDirectlySelected(selection, 'body', body.id);
              const linked = !direct && highlightedBodyIds.includes(body.id);
              return (
                <div
                  key={body.id}
                  className={clsx(
                    'tree-row',
                    direct && 'selected',
                    linked && 'linked',
                    !body.visible && 'muted',
                  )}
                  onContextMenu={(event) =>
                    showContextMenu(event, [
                      {
                        id: 'visibility',
                        label: body.visible ? t('tree.hide') : t('tree.show'),
                        icon: body.visible ? <EyeOff size={14} /> : <Eye size={14} />,
                        onSelect: () => toggleBodyVisibility(body.id),
                      },
                      {
                        id: 'delete',
                        label: t('context.deleteOperation'),
                        icon: <Trash2 size={14} />,
                        danger: true,
                        onSelect: () => removeFeature(body.createdBy),
                      },
                    ])
                  }
                >
                  <button
                    type="button"
                    className="tree-main"
                    onClick={(event) =>
                      select(
                        { kind: 'body', id: body.id },
                        { additive: event.metaKey || event.ctrlKey || event.shiftKey },
                      )
                    }
                  >
                    <span className="color-dot" style={{ background: body.color }} />
                    <span className="tree-name">{body.name}</span>
                    {mesh && (
                      <span className="tree-meta">
                        {formatNumber(mesh.triangleCount, locale, 0)}
                      </span>
                    )}
                  </button>
                  <IconButton
                    label={body.visible ? t('tree.hide') : t('tree.show')}
                    className="tiny"
                    onClick={() => toggleBodyVisibility(body.id)}
                  >
                    {body.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                  </IconButton>
                </div>
              );
            })
          )}
        </PanelSection>

        {project.assets.length > 0 && (
          <PanelSection title={t('tree.assets')} count={project.assets.length}>
            {project.assets.map((asset) => (
              <div key={asset.id} className="tree-row">
                <span className="tree-icon">
                  <Layers size={14} />
                </span>
                <span className="tree-name">{asset.name}</span>
                <span className="tree-meta">{formatNumber(asset.byteSize / 1024, locale, 0)} KB</span>
              </div>
            ))}
          </PanelSection>
        )}
      </div>
    </div>
  );
}
