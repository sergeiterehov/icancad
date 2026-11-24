import type { SketchFeature } from '@icancad/model';
import {
  Check,
  ChevronDown,
  LineStyle,
  Magnet,
  MousePointer2,
  Presentation,
  Ruler,
  SplinePointer,
  SquareRoundCorner,
  StrokeLineCapRound,
  StrokeLineJoinRound,
} from 'lucide-react';
import { useRef, type MouseEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { buildConstraintActions } from '../sketch/constraintModel';
import { constructionSelection, toggleConstruction } from '../sketch/construction';
import { filletCorners } from '../sketch/sketchFillet';
import { offsetSelectionEntities } from '../sketch/sketchOffset';
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
import { useLongPress } from './useLongPress';
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

/**
 * A tool with variants behind a chevron. Its main half starts the base tool and
 * opens the list when a finger holds it; the chevron opens the list for every
 * pointer.
 */
function SplitTool({
  group,
  activeTool,
  onPick,
  label,
  moreLabel,
}: {
  group: (typeof SPLIT_TOOLS)[number];
  activeTool: SketchTool;
  onPick: (tool: SketchTool) => void;
  label: (key: ToolLabel) => string;
  /** Name of the chevron, which names the tool whose list it opens. */
  moreLabel: string;
}) {
  const openOwner = useContextMenuStore((state) => state.menu?.owner ?? null);
  const owner = `sketch-tool-${group.base}`;
  const active = group.options.find((option) => option.tool === activeTool);
  const shown = active ?? group.options[0]!;

  const openList = (rect: DOMRect) =>
    toggleContextMenu(
      owner,
      rect.left,
      rect.bottom + 6,
      group.options.map((option) => ({
        id: option.tool,
        label: label(option.label),
        icon: <SketchEntityIcon type={option.tool} size={14} />,
        hint: toolShortcutLabel(option.tool),
        checked: activeTool === option.tool,
        onSelect: () => onPick(option.tool),
      })),
    );

  const groupRef = useRef<HTMLDivElement>(null);
  const longPress = useLongPress(() => {
    const rect = groupRef.current?.getBoundingClientRect();
    if (rect) openList(rect);
  });

  return (
    <div
      ref={groupRef}
      className="tool-split"
      onPointerDown={longPress.onPointerDown}
      onPointerMove={longPress.onPointerMove}
      onPointerUp={longPress.onPointerUp}
      onPointerLeave={longPress.onPointerLeave}
      onPointerCancel={longPress.onPointerCancel}
    >
      <IconButton
        className="tool-split-main"
        // The button names the tool it shows, so pressing it is never a surprise.
        label={label(shown.label)}
        tooltip={
          toolShortcutLabel(shown.tool)
            ? `${label(shown.label)} (${toolShortcutLabel(shown.tool)})`
            : label(shown.label)
        }
        active={Boolean(active)}
        data-testid={owner}
        onClick={() => {
          // A hold opened the list; the tap it ends with must not also start the
          // tool.
          if (longPress.consumed()) return;
          // The button shows the variant in use, so pressing it keeps that
          // variant: it only starts the base tool while the group is idle.
          onPick(shown.tool);
        }}
      >
        <SketchEntityIcon type={shown.tool} size={17} />
      </IconButton>
      <button
        type="button"
        className="tool-split-caret"
        aria-label={moreLabel}
        aria-haspopup="menu"
        data-testid={`sketch-tool-more-${group.base}`}
        aria-expanded={openOwner === owner}
        data-menu-trigger={owner}
        onPointerDown={longPress.onPointerCancel}
        onClick={(event) => {
          const rect = event.currentTarget.parentElement!.getBoundingClientRect();
          openList(rect);
        }}
      >
        <ChevronDown size={9} />
      </button>
    </div>
  );
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
  // The tools work on a selection of curves: a point or the sketch axes alone
  // gives them nothing to offset, so the menu says so instead of starting.
  const offsetTargets = feature ? offsetSelectionEntities(feature, selectionIds) : [];
  // А corner needs exactly two lines that meet: anything else has nothing to round.
  const filletTarget = feature ? filletCorners(feature, selectionIds).length : 0;
  const toolActive = sketchTool === 'offset' || sketchTool === 'outline' || sketchTool === 'fillet';

  const toggleSelectedConstruction = () => {
    if (!feature) return;
    const next = toggleConstruction(feature, selectionIds);
    if (next) apply({ type: 'feature/replace', feature: next });
  };

  const openTools = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const entry = (
      tool: Extract<SketchTool, 'offset' | 'outline' | 'fillet'>,
      label: string,
      icon: ReactElement,
      disabled: boolean,
      why: string,
    ) => ({
      id: tool,
      label,
      icon,
      checked: sketchTool === tool,
      disabled,
      tooltip: disabled ? why : label,
      onSelect: () => setSketchTool(tool),
    });
    toggleContextMenu('sketch-tools', rect.left, rect.bottom + 6, [
      entry(
        'fillet',
        t('sketch.toolFillet'),
        <SquareRoundCorner size={14} />,
        filletTarget === 0,
        t('sketch.filletSelect'),
      ),
      entry(
        'offset',
        t('sketch.toolOffset'),
        <StrokeLineJoinRound size={14} />,
        offsetTargets.length === 0,
        t('sketch.offsetSelect'),
      ),
      entry(
        'outline',
        t('sketch.toolOutline'),
        <StrokeLineCapRound size={14} />,
        offsetTargets.length === 0,
        t('sketch.offsetSelect'),
      ),
    ]);
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
        {SPLIT_TOOLS.map((group) => (
          <SplitTool
            key={group.base}
            group={group}
            activeTool={sketchTool}
            onPick={setSketchTool}
            label={(key) => t(key)}
            moreLabel={t('sketch.toolMore', { tool: t(group.options[0]!.label) })}
          />
        ))}
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
        <IconButton
          label={t('sketch.toolsMenu')}
          active={toolActive}
          aria-expanded={openOwner === 'sketch-tools'}
          data-menu-trigger="sketch-tools"
          onClick={openTools}
        >
          {sketchTool === 'offset' ? (
            <StrokeLineJoinRound size={17} />
          ) : sketchTool === 'outline' ? (
            <StrokeLineCapRound size={17} />
          ) : sketchTool === 'fillet' ? (
            <SquareRoundCorner size={17} />
          ) : (
            <SplinePointer size={17} />
          )}
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
