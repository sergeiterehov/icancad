import type { SketchFeature } from '@icancad/model';
import { isFundamentalEntityId } from '@icancad/sketch';
import { Check, LineStyle, Magnet, MousePointer2, Ruler, Trash2 } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buildConstraintActions,
  diagnoseSketch,
  removeSketchEntities,
} from '../sketch/constraintModel';
import { SKETCH_TOOL_SHORTCUTS, type SketchTool } from '../sketch/tool';
import { useApplyConstraintAction } from '../sketch/useConstraintActions';
import { useDocumentStore } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import {
  CONSTRAINT_CATALOG,
  constraintDescription,
  constraintLabel,
  constraintShortcutLabel,
} from './constraintCatalog';
import { useContextMenuStore } from './ContextMenu';
import { IconButton } from './Controls';
import { SketchEntityIcon } from './featureIcons';
import { SectionTool } from './SectionTool';

const TOOLS: {
  tool: SketchTool;
  label:
    | 'sketch.toolSelect'
    | 'sketch.toolPoint'
    | 'sketch.toolLine'
    | 'sketch.toolCircle'
    | 'sketch.toolArc'
    | 'sketch.toolEllipse'
    | 'sketch.toolBezier';
}[] = [
  { tool: 'select', label: 'sketch.toolSelect' },
  { tool: 'point', label: 'sketch.toolPoint' },
  { tool: 'line', label: 'sketch.toolLine' },
  { tool: 'circle', label: 'sketch.toolCircle' },
  { tool: 'arc', label: 'sketch.toolArc' },
  { tool: 'ellipse', label: 'sketch.toolEllipse' },
  { tool: 'bezier', label: 'sketch.toolBezier' },
];

export function SketchToolRail() {
  const { t } = useTranslation();
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const sketchTool = useUiStore((state) => state.sketchTool);
  const setSketchTool = useUiStore((state) => state.setSketchTool);
  const setActiveSketch = useUiStore((state) => state.setActiveSketch);
  const selectionIds = useUiStore((state) => state.sketchSelectionIds);
  const setSketchSelection = useUiStore((state) => state.setSketchSelection);
  const magnetEnabled = useUiStore((state) => state.sketchMagnetEnabled);
  const setMagnetEnabled = useUiStore((state) => state.setSketchMagnetEnabled);
  const project = useDocumentStore((state) => state.project);
  const apply = useDocumentStore((state) => state.apply);
  const openMenu = useContextMenuStore((state) => state.open);

  const feature = project.features.find(
    (candidate): candidate is SketchFeature =>
      candidate.id === activeSketchId && candidate.type === 'sketch',
  );
  const { run: runAction, busy } = useApplyConstraintAction(feature);
  const actions = feature ? buildConstraintActions(feature, selectionIds) : [];
  const entitySelection = selectionIds.filter(
    (key) => !key.includes('#') && !isFundamentalEntityId(key),
  );
  const constructionEntities =
    feature?.entities.filter((entity) => entitySelection.includes(entity.id)) ?? [];
  const constructionActive =
    constructionEntities.length > 0 && constructionEntities.every((entity) => entity.construction);

  const toggleConstruction = () => {
    if (!feature || constructionEntities.length === 0) return;
    const ids = new Set(constructionEntities.map((entity) => entity.id));
    const nextConstruction = !constructionActive;
    apply({
      type: 'feature/replace',
      feature: {
        ...feature,
        entities: feature.entities.map((entity) =>
          ids.has(entity.id) ? { ...entity, construction: nextConstruction } : entity,
        ),
      },
    });
  };

  const openConstraints = (event: MouseEvent<HTMLButtonElement>) => {
    if (!feature || actions.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    openMenu(
      rect.left,
      rect.bottom + 6,
      actions.map((action) => {
        const Icon = CONSTRAINT_CATALOG[action.type]?.icon;
        return {
          id: action.key,
          label: constraintLabel((key) => t(key as never), action.type),
          icon: Icon ? <Icon size={14} /> : undefined,
          hint: constraintShortcutLabel(action.type),
          tooltip: constraintDescription((key) => t(key as never), action.type),
          onSelect: () => void runAction(action),
          disabled: busy,
        };
      }),
    );
  };

  return (
    <nav className="tool-rail" aria-label={t('panels.tools')}>
      {TOOLS.map(({ tool, label }) => {
        const shortcut = SKETCH_TOOL_SHORTCUTS[tool];
        return (
          <IconButton
            key={tool}
            label={t(label)}
            tooltip={shortcut ? `${t(label)} (${shortcut})` : t(label)}
            active={sketchTool === tool}
            onClick={() => setSketchTool(tool)}
          >
            {tool === 'select' ? (
              <MousePointer2 size={17} />
            ) : (
              <SketchEntityIcon type={tool} size={17} />
            )}
          </IconButton>
        );
      })}

      <div className="tool-separator" />

      <IconButton
        label={t('tools.construction')}
        active={constructionActive}
        disabled={constructionEntities.length === 0}
        onClick={toggleConstruction}
      >
        <LineStyle size={17} />
      </IconButton>
      <IconButton
        label={t('tools.constraints')}
        disabled={actions.length === 0 || busy}
        onClick={openConstraints}
      >
        <Ruler size={17} />
      </IconButton>
      <IconButton
        label={t('common.delete')}
        disabled={entitySelection.length === 0}
        onClick={() => {
          if (!feature) return;
          const next = removeSketchEntities(feature, entitySelection);
          apply({ type: 'feature/replace', feature: next });
          setSketchSelection([]);
          void diagnoseSketch(next);
        }}
      >
        <Trash2 size={17} />
      </IconButton>
      <div className="tool-separator" />

      <IconButton label={t('sketch.done')} onClick={() => setActiveSketch(null)}>
        <Check size={17} />
      </IconButton>
      <div className="tool-separator" />

      <IconButton
        label={t('tools.magnet')}
        active={magnetEnabled}
        onClick={() => setMagnetEnabled(!magnetEnabled)}
      >
        <Magnet size={17} />
      </IconButton>
      <SectionTool />
    </nav>
  );
}
