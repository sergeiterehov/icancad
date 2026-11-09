import type { SketchFeature } from '@icancad/model';
import {
  Check,
  Circle,
  CircleDot,
  CircleSlashed,
  Disc,
  Lock,
  Magnet,
  Minus,
  MousePointer2,
  PenTool,
  Ruler,
  Trash2,
} from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  applyConstraintAction,
  buildConstraintActions,
  constraintLabel,
  ConstraintSolveError,
  diagnoseSketch,
  removeSketchEntities,
  type ConstraintAction,
} from '../sketch/constraintModel';
import type { SketchTool } from '../sketch/tool';
import { useDocumentStore } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import { useContextMenuStore } from './ContextMenu';
import { IconButton } from './Controls';
import { SectionTool } from './SectionTool';

const TOOLS: {
  tool: SketchTool;
  icon: typeof Circle;
  label:
    | 'sketch.toolSelect'
    | 'sketch.toolPoint'
    | 'sketch.toolLine'
    | 'sketch.toolCircle'
    | 'sketch.toolArc'
    | 'sketch.toolEllipse'
    | 'sketch.toolBezier';
}[] = [
  { tool: 'select', icon: MousePointer2, label: 'sketch.toolSelect' },
  { tool: 'point', icon: CircleDot, label: 'sketch.toolPoint' },
  { tool: 'line', icon: Minus, label: 'sketch.toolLine' },
  { tool: 'circle', icon: Circle, label: 'sketch.toolCircle' },
  { tool: 'arc', icon: CircleSlashed, label: 'sketch.toolArc' },
  { tool: 'ellipse', icon: Disc, label: 'sketch.toolEllipse' },
  { tool: 'bezier', icon: PenTool, label: 'sketch.toolBezier' },
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
  const showToast = useUiStore((state) => state.showToast);
  const project = useDocumentStore((state) => state.project);
  const apply = useDocumentStore((state) => state.apply);
  const openMenu = useContextMenuStore((state) => state.open);
  const [busy, setBusy] = useState(false);

  const feature = project.features.find(
    (candidate): candidate is SketchFeature =>
      candidate.id === activeSketchId && candidate.type === 'sketch',
  );
  const actions = feature ? buildConstraintActions(feature, selectionIds) : [];
  const entitySelection = selectionIds.filter((key) => !key.includes('#'));
  const constructionEntities =
    feature?.entities.filter((entity) => entitySelection.includes(entity.id)) ?? [];
  const constructionActive =
    constructionEntities.length > 0 && constructionEntities.every((entity) => entity.construction);

  const runAction = async (action: ConstraintAction) => {
    if (!feature) return;
    setBusy(true);
    try {
      const next = await applyConstraintAction(feature, action);
      apply({ type: 'feature/replace', feature: next });
    } catch (error) {
      showToast(
        error instanceof ConstraintSolveError && error.code === 'conflict'
          ? 'constraint.conflict'
          : 'constraint.failed',
        'error',
      );
    } finally {
      setBusy(false);
    }
  };

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
      actions.map((action) => ({
        id: action.key,
        label: constraintLabel((key) => t(key as never), action.type),
        onSelect: () => void runAction(action),
        disabled: busy,
      })),
    );
  };

  return (
    <nav className="tool-rail" aria-label={t('panels.tools')}>
      {TOOLS.map(({ tool, icon: Icon, label }) => (
        <IconButton
          key={tool}
          label={t(label)}
          active={sketchTool === tool}
          onClick={() => setSketchTool(tool)}
        >
          <Icon size={17} />
        </IconButton>
      ))}

      <div className="tool-separator" />

      <IconButton
        label={t('tools.construction')}
        active={constructionActive}
        disabled={constructionEntities.length === 0}
        onClick={toggleConstruction}
      >
        <Ruler size={17} />
      </IconButton>
      <IconButton
        label={t('tools.constraints')}
        disabled={actions.length === 0 || busy}
        onClick={openConstraints}
      >
        <Lock size={17} />
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
