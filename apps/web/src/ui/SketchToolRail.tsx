import type { SketchFeature } from '@icancad/model';
import {
  Check,
  ChevronDown,
  LineStyle,
  Magnet,
  MousePointer2,
  Presentation,
  Ruler,
} from 'lucide-react';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { buildConstraintActions } from '../sketch/constraintModel';
import { constructionSelection, toggleConstruction } from '../sketch/construction';
import {
  SKETCH_CONSTRUCTION_SHORTCUT,
  SKETCH_TOOL_SHORTCUTS,
  type SketchTool,
} from '../sketch/tool';
import { useApplyConstraintAction } from '../sketch/useConstraintActions';
import { useDocumentStore, useViewModel } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import {
  CONSTRAINT_CATALOG,
  constraintDescription,
  constraintLabel,
  constraintShortcutLabel,
} from './constraintCatalog';
import { toggleContextMenu, useContextMenuStore } from './ContextMenu';
import { IconButton } from './Controls';
import { SketchEntityIcon } from './featureIcons';
import { SectionTool } from './SectionTool';

type ToolLabel =
  | 'sketch.toolPoint'
  | 'sketch.toolLine'
  | 'sketch.toolCircle'
  | 'sketch.toolArc'
  | 'sketch.toolEllipse'
  | 'sketch.toolEllipticalArc'
  | 'sketch.toolBezier';

/** Tools that draw a sketch entity, and so have an entity icon. */
type EntityTool = Extract<
  SketchTool,
  'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'elliptical-arc' | 'bezier'
>;

const PLAIN_TOOLS: { tool: EntityTool; label: ToolLabel }[] = [
  { tool: 'point', label: 'sketch.toolPoint' },
  { tool: 'line', label: 'sketch.toolLine' },
];

/** A tool with variants behind a chevron; its main part always picks the base. */
const SPLIT_TOOLS: {
  base: EntityTool;
  options: { tool: EntityTool; label: ToolLabel }[];
}[] = [
  {
    base: 'circle',
    options: [
      { tool: 'circle', label: 'sketch.toolCircle' },
      { tool: 'ellipse', label: 'sketch.toolEllipse' },
    ],
  },
  {
    base: 'arc',
    options: [
      { tool: 'arc', label: 'sketch.toolArc' },
      { tool: 'elliptical-arc', label: 'sketch.toolEllipticalArc' },
    ],
  },
];

function toolShortcutLabel(tool: SketchTool): string | undefined {
  return SKETCH_TOOL_SHORTCUTS[tool];
}

export function SketchToolRail() {
  const { t } = useTranslation();
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const sketchTool = useUiStore((state) => state.sketchTool);
  const setSketchTool = useUiStore((state) => state.setSketchTool);
  const setActiveSketch = useUiStore((state) => state.setActiveSketch);
  const selectionIds = useUiStore((state) => state.sketchSelectionIds);
  const magnetEnabled = useUiStore((state) => state.sketchMagnetEnabled);
  const frozenEntityIds = useUiStore((state) => state.sketchFrozenEntityIds);
  const setMagnetEnabled = useUiStore((state) => state.setSketchMagnetEnabled);
  const project = useViewModel();
  const apply = useDocumentStore((state) => state.apply);
  const openOwner = useContextMenuStore((state) => state.menu?.owner ?? null);

  const feature = project.features.find(
    (candidate): candidate is SketchFeature =>
      candidate.id === activeSketchId && candidate.type === 'sketch',
  );
  const { run: runAction, busy } = useApplyConstraintAction(feature);
  const actions = feature ? buildConstraintActions(feature, selectionIds) : [];
  // A sketch the solver cannot move at all is done: every curve and point of it
  // is drawn green, and the button that leaves the sketch says so too.
  const solved =
    Boolean(feature?.entities.length) &&
    feature!.entities.every((entity) => frozenEntityIds.includes(entity.id));
  const constructionEntities = feature ? constructionSelection(feature, selectionIds) : [];
  const constructionActive =
    constructionEntities.length > 0 && constructionEntities.every((entity) => entity.construction);

  const toggleSelectedConstruction = () => {
    if (!feature) return;
    const next = toggleConstruction(feature, selectionIds);
    if (next) apply({ type: 'feature/replace', feature: next });
  };

  const openConstraints = (event: MouseEvent<HTMLButtonElement>) => {
    if (!feature || actions.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    toggleContextMenu(
      'sketch-constraints',
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
    <nav className="tool-rail tool-rail-sketch" aria-label={t('panels.tools')}>
      <div className="tool-rail-row">
        <IconButton
          label={t('sketch.toolSelect')}
          active={sketchTool === 'select'}
          onClick={() => setSketchTool('select')}
        >
          <MousePointer2 size={17} />
        </IconButton>
        {PLAIN_TOOLS.map(({ tool, label }) => {
          const shortcut = toolShortcutLabel(tool);
          return (
            <IconButton
              key={tool}
              label={t(label)}
              tooltip={shortcut ? `${t(label)} (${shortcut})` : t(label)}
              active={sketchTool === tool}
              onClick={() => setSketchTool(tool)}
            >
              <SketchEntityIcon type={tool} size={17} />
            </IconButton>
          );
        })}
        {SPLIT_TOOLS.map((group) => {
          const active = group.options.find((option) => option.tool === sketchTool);
          const shown = active ?? group.options[0]!;
          const shortcut = toolShortcutLabel(group.base);
          return (
            <div key={group.base} className="tool-split">
              <IconButton
                className="tool-split-main"
                label={t(group.options[0]!.label)}
                tooltip={
                  shortcut
                    ? `${t(group.options[0]!.label)} (${shortcut})`
                    : t(group.options[0]!.label)
                }
                active={Boolean(active)}
                data-testid={`sketch-tool-${group.base}`}
                onClick={() => setSketchTool(group.base)}
              >
                <SketchEntityIcon type={shown.tool} size={17} />
              </IconButton>
              <button
                type="button"
                className="tool-split-caret"
                aria-label={t('sketch.toolMore', { tool: t(group.options[0]!.label) })}
                aria-haspopup="menu"
                data-testid={`sketch-tool-more-${group.base}`}
                aria-expanded={openOwner === `sketch-tool-${group.base}`}
                data-menu-trigger={`sketch-tool-${group.base}`}
                onClick={(event) => {
                  const rect = event.currentTarget.parentElement!.getBoundingClientRect();
                  toggleContextMenu(
                    `sketch-tool-${group.base}`,
                    rect.left,
                    rect.bottom + 6,
                    group.options.map((option) => ({
                      id: option.tool,
                      label: t(option.label),
                      icon: <SketchEntityIcon type={option.tool} size={14} />,
                      hint: toolShortcutLabel(option.tool),
                      checked: sketchTool === option.tool,
                      onSelect: () => setSketchTool(option.tool),
                    })),
                  );
                }}
              >
                <ChevronDown size={9} />
              </button>
            </div>
          );
        })}
        <IconButton
          label={t('sketch.toolBezier')}
          tooltip={`${t('sketch.toolBezier')} (${SKETCH_TOOL_SHORTCUTS.bezier})`}
          active={sketchTool === 'bezier'}
          onClick={() => setSketchTool('bezier')}
        >
          <SketchEntityIcon type="bezier" size={17} />
        </IconButton>
        <IconButton
          label={t('sketch.toolProject')}
          tooltip={`${t('sketch.toolProject')} (${SKETCH_TOOL_SHORTCUTS.project})`}
          active={sketchTool === 'project'}
          onClick={() => setSketchTool('project')}
        >
          <Presentation size={17} />
        </IconButton>
      </div>

      <div className="tool-rail-row">
        <div className="tool-separator" />

        <IconButton
          label={t('tools.construction')}
          tooltip={`${t('tools.construction')} (${SKETCH_CONSTRUCTION_SHORTCUT})`}
          active={constructionActive}
          disabled={constructionEntities.length === 0}
          onClick={toggleSelectedConstruction}
        >
          <LineStyle size={17} />
        </IconButton>
        <IconButton
          label={t('tools.constraints')}
          disabled={actions.length === 0 || busy}
          aria-expanded={openOwner === 'sketch-constraints'}
          data-menu-trigger="sketch-constraints"
          onClick={openConstraints}
        >
          <Ruler size={17} />
          <ChevronDown size={9} className="button-caret" />
        </IconButton>
        <div className="tool-separator" />

        <IconButton
          label={t('sketch.done')}
          className={solved ? 'is-solved' : undefined}
          onClick={() => {
            // Finishing from the toolbar keeps the sketch even while it is empty.
            useDocumentStore.getState().keepFreshSketch();
            setActiveSketch(null);
          }}
        >
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
      </div>
    </nav>
  );
}
