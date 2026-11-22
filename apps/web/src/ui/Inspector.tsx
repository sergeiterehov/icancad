import type { TessellationResult } from '@icancad/kernel';
import { sketchTopology } from '@icancad/sketch';
import {
  activeModel,
  bodiesInHistory,
  defaultRevolve,
  featureBodyId,
  groupFeatureIds,
  objectColor,
  objectName,
  objectShowConstruction,
  objectVisible,
  resolveBody,
  SKETCH_COLOR,
  sketchObjectId,
  solidBodiesInHistory,
  timelineNodes,
  type Feature,
  type PrimitiveFeature,
  type SketchEntity,
  type ExtrudeFeature,
  type ExtrudeToBodyMode,
  type ParamValue,
  type ParamVec3,
  type Resolved,
  type SketchFeature,
} from '@icancad/model';
import {
  AlertTriangle,
  ArrowBigLeftDash,
  ArrowBigRight,
  ArrowBigRightDash,
  ArrowLeftFromLine,
  ArrowLeftRight,
  ArrowLeftToLine,
  RefreshCw,
  ArrowRightFromLine,
  ArrowRightToLine,
  ArrowUp,
  Box,
  CaretsFromAxisVertical,
  ChartPie,
  Circle,
  Folder,
  Torus,
  Eye,
  EyeOff,
  Hexagon,
  Infinity as InfinityIcon,
  LayerArrowUp,
  MoveVertical,
  PackageSearch,
  PawPrint,
  Pencil,
  RulerDimensionLine,
  Spline,
  SquareArrowRightExit,
} from 'lucide-react';
import { useEffect, useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import {
  bodyFaceKey,
  sketchFaceKey,
  useDocumentStore,
  useViewModel,
} from '../stores/documentStore';
import { useKernelStore } from '../stores/kernelStore';
import { resolvedFeatureFor, useFormulaStore } from '../stores/formulaStore';
import {
  selectedBodyFaces,
  selectedDetailBodyId,
  selectedEdges,
  selectedSketchDetailId,
} from '../stores/selection';
import { findBoundExtrude, quickTargetFromSelection } from '../quick/target';
import { bodyEdgeNumber, bodyFaceNumber, geometryName } from './geometryNames';
import { PYRAMID_MAX_SIDES, PYRAMID_MIN_SIDES, type PrimitiveSizeKey } from '../primitive/params';
import { isPlanarFace } from '../viewport/planarFace';
import { useUiStore } from '../stores/uiStore';
import {
  Button,
  IconButton,
  ParamField,
  FormError,
  ObjectPickerField,
  PanelSection,
  Segmented,
  SegmentedTab,
  StatRow,
  Switch,
  TextField,
} from './Controls';
import { formatNumber } from './format';
import { formulaMessage } from './formulaMessage';
import { useContextMenuStore } from './ContextMenu';
import { ChamferIcon, FilletIcon } from './edgeIcons';
import {
  ExtrudeOpIcon,
  FeatureIcon,
  PointIcon,
  ShellIcon,
  SketchEntityIcon,
  SketchIcon,
} from './featureIcons';
import { PickableSection, type PickableRow } from './PickableSection';
import { ArraySection } from './ArraySection';
import { ImportMeshSection } from './ImportMeshSection';
import { TransformSection } from './TransformSection';
import { VariablesSection } from './VariablesSection';
import {
  constraintsGeometryIds,
  diagnoseSketch,
  removeSketchEntities,
} from '../sketch/constraintModel';
import { isProjectedEntity } from '../sketch/projection';
import { referenceMenuItems } from '../sketch/referenceMenu';
import { measuresForEntity, referenceText } from '../sketch/measure';
import { sketchPlaneReady, canEditSketch } from '../sketch/sectionPlane';
import { resolveRevolveAxis } from '../sketch/revolveAxis';
import { SketchConstraints } from './SketchConstraints';
import { Tooltip } from './Tooltip';
import { referenceIcon, referenceLabelKey } from './referenceCatalog';
import { translate } from './translate';
import { useListSelection } from './useListSelection';

function sketchEntityLabel(t: (key: string) => string, entity: SketchEntity): string {
  switch (entity.type) {
    case 'point':
      return t('sketch.entityPoint');
    case 'line':
      return t('sketch.entityLine');
    case 'circle':
      return t('sketch.entityCircle');
    case 'arc':
      return t('sketch.entityArc');
    case 'ellipse':
      return t('sketch.entityEllipse');
    case 'elliptical-arc':
      return t('sketch.entityEllipticalArc');
    case 'bezier':
      return t('sketch.entityBezier');
  }
}

function sketchEntityMeta(entity: SketchEntity, locale: string): string {
  switch (entity.type) {
    case 'point':
      return `${formatNumber(entity.x, locale, 1)}, ${formatNumber(entity.y, locale, 1)} mm`;
    case 'line':
      return `${formatNumber(Math.hypot(entity.x2 - entity.x1, entity.y2 - entity.y1), locale, 1)} mm`;
    case 'circle':
      return `r ${formatNumber(entity.r, locale, 1)} mm`;
    case 'arc':
      return `r ${formatNumber(entity.r, locale, 1)} mm`;
    case 'ellipse':
      return `${formatNumber(entity.rx, locale, 1)} × ${formatNumber(entity.ry, locale, 1)} mm`;
    case 'elliptical-arc':
      return `${formatNumber(entity.rx, locale, 1)} × ${formatNumber(entity.ry, locale, 1)} mm`;
    case 'bezier':
      return `${entity.points.length}`;
  }
}

function referenceItems(feature: SketchFeature, entityId: string, locale: string) {
  const entity = feature.entities.find((candidate) => candidate.id === entityId);
  if (!entity) return [];
  const order = measuresForEntity(entity);
  return [...(feature.references ?? [])]
    .filter((reference) => reference.entityId === entityId)
    .sort((a, b) => order.indexOf(a.measure) - order.indexOf(b.measure))
    .flatMap((reference) => {
      const text = referenceText(entity, reference.measure, locale, 'mm');
      if (!text) return [];
      return [{ measure: reference.measure, text, Icon: referenceIcon(entity, reference.measure) }];
    });
}

function isPrimitive(feature: Feature | undefined): feature is PrimitiveFeature {
  return feature?.type === 'primitive';
}

/** Type of an operation, used as the panel title. */
function featureTypeLabel(t: (key: string) => string, feature: Feature): string {
  switch (feature.type) {
    case 'sketch':
      return t('inspector.sketch');
    case 'primitive':
      switch (feature.kind) {
        case 'box':
          return t('inspector.box');
        case 'sphere':
          return t('features.sphere');
        case 'cylinder':
          return t('features.cylinder');
        case 'cone':
          return t('features.cone');
        case 'torus':
          return t('features.torus');
        case 'pyramid':
          return t('features.pyramid');
        case 'capsule':
          return t('features.capsule');
      }
      return t('inspector.box');
    case 'extrude':
      return t('inspector.extrude');
    case 'import-mesh':
      return t('inspector.mesh');
    case 'import-step':
      return t('inspector.step');
    case 'edge-treatment':
      return t('features.edgeTreatment');
    case 'shell':
      return t('features.shell');
    case 'boolean':
      return t('features.boolean');
    case 'array':
      return t('features.array');
    case 'transform':
      return t('features.transform');
    default:
      return t('inspector.operation');
  }
}

interface ResolvedItem {
  key: string;
  kind: 'body' | 'mesh' | 'feature' | 'group' | 'sketch';
  name: string;
  bodyId: string | null;
}

const EXTRUDE_OPS = [
  { id: 'new' as const, label: 'extrude.op_new', icon: <ExtrudeOpIcon op="new" /> },
  { id: 'add' as const, label: 'extrude.op_add', icon: <ExtrudeOpIcon op="add" /> },
  {
    id: 'subtract' as const,
    label: 'extrude.op_subtract',
    icon: <ExtrudeOpIcon op="subtract" />,
  },
  {
    id: 'intersect' as const,
    label: 'extrude.op_intersect',
    icon: <ExtrudeOpIcon op="intersect" />,
  },
];

/** Tabs of the boolean tool, in the order the operation reads them. */
const BOOLEAN_OPS = [
  { id: 'subtract' as const, label: 'boolean.subtract', icon: <ExtrudeOpIcon op="subtract" /> },
  { id: 'union' as const, label: 'boolean.union', icon: <ExtrudeOpIcon op="add" /> },
  { id: 'intersect' as const, label: 'boolean.intersect', icon: <ExtrudeOpIcon op="intersect" /> },
];

/**
 * One row of extents: a straight pull has three, and a revolve sits between
 * them as the fourth way to sweep the profile.
 */
const EXTRUDE_EXTENTS = [
  {
    id: 'blind',
    label: 'extrude.end_blind',
    icon: <RulerDimensionLine size={12} />,
    revolve: false,
  },
  {
    id: 'symmetric',
    label: 'extrude.end_symmetric',
    icon: <CaretsFromAxisVertical size={12} />,
    revolve: false,
  },
  {
    id: 'revolve',
    label: 'extrude.method_revolve',
    icon: <ChartPie size={12} />,
    revolve: true,
  },
  {
    id: 'through-all',
    label: 'extrude.end_through_all',
    icon: <InfinityIcon size={12} />,
    revolve: false,
  },
  {
    id: 'to-body',
    label: 'extrude.end_to_body',
    icon: <PackageSearch size={12} />,
    revolve: false,
  },
] as const;

/**
 * Which face of the body ends the sweep: the one that looks at the profile or
 * the far one behind it.
 */
const EXTRUDE_TO_BODY_KINDS = [
  { id: 'first' as const, label: 'extrude.toBody_first', icon: <ArrowRightToLine size={12} /> },
  { id: 'last' as const, label: 'extrude.toBody_last', icon: <ArrowLeftToLine size={12} /> },
];

/** How a "to body" extent ends on the face it stops at. */
const EXTRUDE_TO_BODY_MODES = [
  // The filled arrows are drawn small on their grid, so they need a pixel more
  // than the line icons beside them to read at the same size.
  { id: 'solid' as const, label: 'extrude.toBodyMode_solid', icon: <ArrowBigRight size={14} /> },
  { id: 'gap' as const, label: 'extrude.toBodyMode_gap', icon: <ArrowBigRightDash size={14} /> },
  {
    id: 'shell' as const,
    label: 'extrude.toBodyMode_shell',
    icon: <ArrowBigLeftDash size={14} />,
  },
];

/** A document saved before the modes existed carries the mode in the sign. */
function toBodyModeOf(offset: ParamValue | undefined, kind: 'first' | 'last'): ExtrudeToBodyMode {
  if (typeof offset !== 'number' || offset === 0) return 'solid';
  // A gap stops short of the face the sweep ends on, a layer stands on it, and
  // "last" ends on the far side, so its layer is the one that goes positive.
  return offset > 0 === (kind === 'first') ? 'gap' : 'shell';
}

const EXTRUDE_SECOND_ENDS = [
  { id: 'blind' as const, label: 'extrude.end_blind', icon: <ArrowUp size={12} /> },
  {
    id: 'through-all' as const,
    label: 'extrude.end_through_all',
    icon: <InfinityIcon size={12} />,
  },
];

// Making a new body or adding material has no meaningful "through everything".
function throughAllAllowed(op: ExtrudeFeature['op']): boolean {
  return op === 'subtract' || op === 'intersect';
}

// "To body" is a single sweep to a surface, so it has no second direction.
function secondDirectionAllowed(feature: Pick<ExtrudeFeature, 'end'>): boolean {
  return feature.end !== 'symmetric' && feature.end !== 'to-body';
}

/**
 * The Keep switch of a boolean body list. Off by default: the source body is
 * consumed by the operation unless the user asks to keep it.
 */
function BooleanKeepToggle({
  keep,
  hint,
  onChange,
}: {
  keep: boolean;
  hint: string;
  onChange: (keep: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Tooltip content={hint}>
      <span className="boolean-keep">
        <span className="boolean-keep-label">{t('boolean.keep')}</span>
        <Switch label={t('boolean.keep')} checked={keep} onChange={onChange} />
      </span>
    </Tooltip>
  );
}

function SketchComposition({ feature }: { feature: SketchFeature }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
  const apply = useDocumentStore((state) => state.apply);
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const sketchSelectionIds = useUiStore((state) => state.sketchSelectionIds);
  const sketchConstraintIds = useUiStore((state) => state.sketchConstraintIds);
  const sketchFrozenEntityIds = useUiStore((state) => state.sketchFrozenEntityIds);
  const projectionLost = useKernelStore((state) => state.projectionLost);
  const selectSketchConstraints = useUiStore((state) => state.selectSketchConstraints);
  const setSketchSelection = useUiStore((state) => state.setSketchSelection);
  const openMenu = useContextMenuStore((state) => state.open);
  const project = useViewModel();
  // A sketch drawn in its own colour lists its geometry in that colour; the
  // default one is left to the theme, which is what the rest of the list reads.
  const objectTint = objectColor(project, sketchObjectId(feature.id), SKETCH_COLOR);
  const rowTint = objectTint === SKETCH_COLOR ? undefined : objectTint;

  const selectedConstraints = feature.constraints.filter((constraint) =>
    sketchConstraintIds.includes(constraint.id),
  );
  const selectedEntityIds = new Set(
    sketchSelectionIds.map((key) => key.split('#')[0]).filter((id): id is string => Boolean(id)),
  );
  const constraintEntityIds = new Set(constraintsGeometryIds(selectedConstraints));
  const lostEntityIds = new Set(projectionLost[feature.id] ?? []);
  // Geometry of a sketch is listed in the order it was drawn, so Shift takes the
  // range between two rows and Cmd or Ctrl toggles one. A point picked inside an
  // entity keeps its `#index` suffix, which is not a row of this list.
  const clickEntity = useListSelection({
    ids: feature.entities.map((entity) => entity.id),
    selected: sketchSelectionIds.filter((key) => !key.includes('#')),
    onSelect: (ids) => setSketchSelection(ids),
  });

  return (
    <PanelSection title={t('sketch.composition')} count={feature.entities.length} divided>
      {feature.entities.length === 0 ? (
        <p className="hint">{t('sketch.empty')}</p>
      ) : (
        <div
          className="selection-list"
          style={rowTint ? ({ '--row-color': rowTint } as CSSProperties) : undefined}
        >
          {feature.entities.map((entity) => {
            const dimmed = selectedConstraints.length > 0 && !constraintEntityIds.has(entity.id);
            const active = selectedEntityIds.has(entity.id);
            // The icon carries the state of the geometry: violet when it is
            // projected from 3D, green when it has no degrees of freedom left.
            const projected = isProjectedEntity(feature, entity.id);
            const frozen =
              activeSketchId === feature.id && sketchFrozenEntityIds.includes(entity.id);
            // A link the rebuild could not follow keeps its snapshot, which is
            // a warning worth showing next to the geometry itself.
            const lost = lostEntityIds.has(entity.id);
            return (
              <button
                key={entity.id}
                type="button"
                className="selection-item sketch-entity-row"
                data-active={active ? 'true' : undefined}
                data-dimmed={dimmed ? 'true' : undefined}
                data-construction={entity.construction ? 'true' : undefined}
                disabled={activeSketchId !== feature.id}
                onClick={(event) => clickEntity(event, entity.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  // Right-clicking a member of a multi-selection keeps it so
                  // the constraint action applies to every selected entity.
                  if (!selectedEntityIds.has(entity.id)) setSketchSelection([entity.id]);
                  const selection = selectedEntityIds.has(entity.id)
                    ? [...selectedEntityIds]
                    : [entity.id];
                  openMenu(
                    event.clientX,
                    event.clientY,
                    referenceMenuItems(
                      feature,
                      entity.id,
                      (key) => t(key as never),
                      locale,
                      (next) => apply({ type: 'feature/replace', feature: next }),
                      {
                        selectedEntityIds: selection,
                        onSelectConstraints: (ids) => selectSketchConstraints(ids),
                        onDelete: (ids) => {
                          const next = removeSketchEntities(feature, ids);
                          apply({ type: 'feature/replace', feature: next });
                          setSketchSelection([]);
                          void diagnoseSketch(next);
                        },
                      },
                    ),
                  );
                }}
              >
                <span
                  className={`entity-icon${frozen ? ' frozen' : ''}${projected ? ' projected' : ''}`}
                  aria-hidden="true"
                >
                  <SketchEntityIcon type={entity.type} />
                </span>
                <span className="tree-name">
                  {sketchEntityLabel((key) => t(key as never), entity)}
                </span>
                <span className="tree-meta">
                  {(() => {
                    const references = referenceItems(feature, entity.id, locale);
                    if (references.length === 0) return sketchEntityMeta(entity, locale);
                    return (
                      <span className="tree-references">
                        {references.map(({ measure, text, Icon }) => (
                          <span
                            key={measure}
                            className="tree-reference"
                            title={t(referenceLabelKey(measure) as never)}
                          >
                            <Icon size={11} aria-hidden="true" />
                            <span>{text}</span>
                          </span>
                        ))}
                      </span>
                    );
                  })()}
                </span>
                {lost && (
                  <Tooltip
                    content={t('sketch.projectionLost')}
                    delay={150}
                    className="entity-warning"
                  >
                    <AlertTriangle size={12} aria-label={t('sketch.projectionLost')} />
                  </Tooltip>
                )}
              </button>
            );
          })}
        </div>
      )}
    </PanelSection>
  );
}

/** Switch and three axis fields that turn a sketch surface. */
function SketchRotationFields({
  feature,
  resolved,
  paramError,
  onChange,
  onParameter,
}: {
  feature: SketchFeature;
  resolved?: Resolved<SketchFeature>;
  paramError: (path: string) => string | undefined;
  onChange: (rotation: ParamVec3 | undefined) => void;
  onParameter: (path: string, value: ParamValue) => void;
}) {
  const { t } = useTranslation();
  const rotation = feature.plane.rotation;
  return (
    <>
      <div className="stat-row">
        <span className="stat-label">{t('sketch.rotation')}</span>
        <Switch
          label={t('sketch.rotation')}
          checked={rotation !== undefined}
          onChange={(enabled) => onChange(enabled ? [0, 0, 0] : undefined)}
        />
      </div>
      {rotation && (
        <div className="dimension-row">
          {(['X', 'Y', 'Z'] as const).map((axis, index) => (
            <ParamField
              key={axis}
              axis={axis}
              label={t('sketch.rotationAxis', { axis })}
              suffix="°"
              allowNegative
              value={rotation[index]!}
              resolved={resolved?.plane.rotation?.[index]}
              error={paramError(`plane.rotation.${index}`)}
              onCommit={(value) => onParameter(`plane.rotation.${index}`, value)}
            />
          ))}
        </div>
      )}
    </>
  );
}

// Bounds of several bodies as one box, so an operation reports the space it uses.
function mergeBounds(parts: TessellationResult[]): TessellationResult {
  const first = parts[0]!;
  const min: [number, number, number] = [first.bbox.min[0], first.bbox.min[1], first.bbox.min[2]];
  const max: [number, number, number] = [first.bbox.max[0], first.bbox.max[1], first.bbox.max[2]];
  let triangleCount = first.triangleCount;
  let vertexCount = first.vertexCount;
  for (const part of parts.slice(1)) {
    triangleCount += part.triangleCount;
    vertexCount += part.vertexCount;
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, part.bbox.min[axis]!);
      max[axis] = Math.max(max[axis]!, part.bbox.max[axis]!);
    }
  }
  return { ...first, triangleCount, vertexCount, bbox: { min, max } };
}

export function Inspector() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
  const selection = useDocumentStore((state) => state.selection);
  const project = useViewModel();
  const projectName = useDocumentStore((state) => state.project.name);
  const projectUnits = useDocumentStore((state) => state.project.units);
  const apply = useDocumentStore((state) => state.apply);
  const renameProject = useDocumentStore((state) => state.renameProject);
  const renameModel = (name: string) => {
    apply({ type: 'model/rename', modelId: project.id, name });
  };
  const select = useDocumentStore((state) => state.select);
  const selectMany = useDocumentStore((state) => state.selectMany);
  const renameGroup = useDocumentStore((state) => state.renameGroup);
  const setExtrudeOp = useDocumentStore((state) => state.setExtrudeOp);
  const setExtrudeInput = useDocumentStore((state) => state.setExtrudeInput);
  const toggleExtrudeFace = useDocumentStore((state) => state.toggleExtrudeFace);
  const toggleExtrudeBodyFace = useDocumentStore((state) => state.toggleExtrudeBodyFace);
  const toggleExtrudeBodyTarget = useDocumentStore((state) => state.toggleExtrudeBodyTarget);
  const setExtrudeReversed = useDocumentStore((state) => state.setExtrudeReversed);
  const setExtrudeToBody = useDocumentStore((state) => state.setExtrudeToBody);
  const setExtrudeToBodyOffset = useDocumentStore((state) => state.setExtrudeToBodyOffset);
  const setExtrudeToBodyMode = useDocumentStore((state) => state.setExtrudeToBodyMode);
  const setExtrudeMethod = useDocumentStore((state) => state.setExtrudeMethod);
  const setRevolveAxis = useDocumentStore((state) => state.setRevolveAxis);
  const setRevolveAngles = useDocumentStore((state) => state.setRevolveAngles);
  const setFeatureParameter = useDocumentStore((state) => state.setFeatureParameter);
  const formulaErrors = useFormulaStore((state) => state.resolution?.errors ?? {});
  const paramError = (featureId: string, path: string) =>
    formulaMessage(t, formulaErrors[featureId]?.[path]);
  const setRevolveInverted = useDocumentStore((state) => state.setRevolveInverted);
  const setEdgeTreatmentKind = useDocumentStore((state) => state.setEdgeTreatmentKind);
  const toggleEdgeTreatmentFace = useDocumentStore((state) => state.toggleEdgeTreatmentFace);
  const toggleEdgeTreatmentEdge = useDocumentStore((state) => state.toggleEdgeTreatmentEdge);
  const setShellDirection = useDocumentStore((state) => state.setShellDirection);
  const toggleShellBody = useDocumentStore((state) => state.toggleShellBody);
  const toggleShellFace = useDocumentStore((state) => state.toggleShellFace);
  const setBooleanOp = useDocumentStore((state) => state.setBooleanOp);
  const toggleBooleanBody = useDocumentStore((state) => state.toggleBooleanBody);
  const setBooleanKeep = useDocumentStore((state) => state.setBooleanKeep);
  const toggleBodyVisibility = useDocumentStore((state) => state.toggleBodyVisibility);
  const toggleSketchVisibility = useDocumentStore((state) => state.toggleSketchVisibility);
  const setConstructionVisible = useDocumentStore((state) => state.setConstructionVisible);
  const picking = useUiStore((state) => state.pickingExtrude);
  const pickingBodies = useUiStore((state) => state.pickingExtrudeBodies);
  const pickingSketchPlane = useUiStore((state) => state.pickingSketchPlane);
  const pickingEdges = useUiStore((state) => state.pickingEdges);
  const setPickingEdges = useUiStore((state) => state.setPickingEdges);
  const pickingShellBodies = useUiStore((state) => state.pickingShellBodies);
  const pickingShellFaces = useUiStore((state) => state.pickingShellFaces);
  const setPickingShellBodies = useUiStore((state) => state.setPickingShellBodies);
  const setPickingShellFaces = useUiStore((state) => state.setPickingShellFaces);
  const pickingTransformTargets = useUiStore((state) => state.pickingTransformTargets);
  const setPickingTransformTargets = useUiStore((state) => state.setPickingTransformTargets);
  const pickingBooleanBodies = useUiStore((state) => state.pickingBooleanBodies);
  const pickingBooleanTools = useUiStore((state) => state.pickingBooleanTools);
  const setPickingBooleanBodies = useUiStore((state) => state.setPickingBooleanBodies);
  const setPickingBooleanTools = useUiStore((state) => state.setPickingBooleanTools);
  const pickingRevolveAxis = useUiStore((state) => state.pickingRevolveAxis);
  const setPickingRevolveAxis = useUiStore((state) => state.setPickingRevolveAxis);
  const pickingToBody = useUiStore((state) => state.pickingExtrudeToBody);
  const setPickingToBody = useUiStore((state) => state.setPickingExtrudeToBody);
  const setPickingExtrude = useUiStore((state) => state.setPickingExtrude);
  const setPickingExtrudeBodies = useUiStore((state) => state.setPickingExtrudeBodies);
  const setPickingSketchPlane = useUiStore((state) => state.setPickingSketchPlane);
  const meshes = useKernelStore((state) => state.meshes);
  const shapeStats = useKernelStore((state) => state.shapeStats);
  const meshStats = useKernelStore((state) => state.meshStats);
  const featureErrors = useKernelStore((state) => state.featureErrors);
  const consumedBodies = useKernelStore((state) => state.consumedBodies);
  const featureBodyErrors = useKernelStore((state) => state.featureBodyErrors);
  const featureObjectErrors = useKernelStore((state) => state.featureObjectErrors);
  const featureLimits = useKernelStore((state) => state.featureLimits);
  const preview = useKernelStore((state) => state.preview);
  const sketchFrames = useKernelStore((state) => state.sketchFrames);
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const setActiveSketch = useUiStore((state) => state.setActiveSketch);
  const setTimelineGroup = useUiStore((state) => state.setTimelineGroup);

  const selectedGroup =
    selection.length === 1 && selection[0]?.kind === 'group'
      ? project.groups.find((group) => group.id === selection[0]?.id)
      : undefined;
  // The contents of a folder are its own level: the same items the strip shows
  // once the folder is opened, read-only here.
  const groupContents = selectedGroup ? timelineNodes(project, selectedGroup.id) : [];

  const feature =
    selection.length === 1 && selection[0]?.kind === 'feature'
      ? project.features.find((candidate) => candidate.id === selection[0]?.id)
      : undefined;
  const formulaRevision = useFormulaStore((state) => state.resolution?.revision ?? 0);
  const resolvedFeature = useMemo(
    () => (feature ? resolvedFeatureFor(feature) : undefined),
    [feature, formulaRevision],
  );
  // A selected face or edge keeps its body panel open: the panel is still
  // about that object, plus the quick operation the detail offers.
  const detailBodyId = selection.length === 1 ? selectedDetailBodyId(selection[0]!) : null;
  const bodyRef =
    selection.length === 1 && (selection[0]?.kind === 'body' || selection[0]?.kind === 'mesh')
      ? project.bodies.find((candidate) => candidate.id === selection[0]?.id)
      : detailBodyId
        ? project.bodies.find((candidate) => candidate.id === detailBodyId)
        : undefined;
  const body = bodyRef ? resolveBody(project, bodyRef) : undefined;
  const detailFace = selection.length === 1 ? selectedBodyFaces(selection)[0] : undefined;
  const detailEdge = selection.length === 1 ? selectedEdges(selection)[0] : undefined;
  const quickTarget =
    selection.length === 1 ? quickTargetFromSelection(project, selection, meshes) : null;
  const quickExtrude = quickTarget ? findBoundExtrude(project, quickTarget) : undefined;
  const quickExtrudeResolved = quickExtrude ? resolvedFeatureFor(quickExtrude) : undefined;
  const detailMesh = detailBodyId ? meshes[detailBodyId] : undefined;
  const detailPlanar = Boolean(
    detailFace && detailMesh && isPlanarFace(detailMesh, Number(detailFace.faceId)),
  );
  // A sketch is an object of its own: the tree selects the object, the timeline
  // chip selects the operation that created it.
  // Faces belong to their sketch, so selecting them keeps the object panel open.
  const selectedSketchId =
    selection.length === 1 && selection[0]?.kind === 'sketch'
      ? selection[0].id
      : (selectedSketchDetailId(selection) ?? undefined);
  const sketchObject = selectedSketchId
    ? project.features.find(
        (candidate): candidate is SketchFeature =>
          candidate.id === selectedSketchId && candidate.type === 'sketch',
      )
    : undefined;

  const sketchGeometry = sketchObject ? sketchTopology(sketchObject.entities) : undefined;
  // The faces and edges of a sketch are listed in topology order, so a Shift
  // click selects the stretch between two of them.
  const clickSketchFace = useListSelection({
    ids: sketchObject
      ? (sketchGeometry?.faces ?? []).map((face) => `${sketchObject.id}#${face.id}`)
      : [],
    selected: selection.filter((item) => item.kind === 'face').map((item) => item.id),
    onSelect: (ids, { id }) =>
      selectMany(
        ids.map((faceId) => ({ kind: 'face' as const, id: faceId })),
        { kind: 'face', id },
      ),
  });
  const clickSketchEdge = useListSelection({
    ids: sketchObject
      ? (sketchGeometry?.edges ?? []).map((edge) => `${sketchObject.id}#${edge.id}`)
      : [],
    selected: selection.filter((item) => item.kind === 'sketch-edge').map((item) => item.id),
    onSelect: (ids, { id }) =>
      selectMany(
        ids.map((edgeId) => ({ kind: 'sketch-edge' as const, id: edgeId })),
        { kind: 'sketch-edge', id },
      ),
  });
  const sketchOffset =
    resolvedFeature?.type === 'sketch'
      ? resolvedFeature.plane.type === 'datum'
        ? resolvedFeature.plane.offset
        : (resolvedFeature.plane.offset ?? 0)
      : 0;
  // One operation can own several bodies, so an operation shows the bounds of
  // all of them together.
  const ownedBodies = feature
    ? project.bodies.filter((candidate) => candidate.createdBy === feature.id)
    : [];
  const ownedMeshes = ownedBodies
    .map((candidate) => meshes[candidate.id])
    .filter((candidate): candidate is TessellationResult => Boolean(candidate));
  // While the operation is being configured its result only exists in the
  // preview, so its statistics are taken from there.
  const previewMeshes =
    feature && preview?.featureId === feature.id
      ? preview.bodies
          .filter((mark) => mark.kind === 'added')
          .map((mark) => meshes[mark.id])
          .filter((candidate): candidate is TessellationResult => Boolean(candidate))
      : [];
  const parts = ownedMeshes.length > 0 ? ownedMeshes : previewMeshes;
  const mesh = body ? meshes[body.id] : parts.length > 0 ? mergeBounds(parts) : undefined;
  const statsKey = body?.id ?? feature?.id;
  const stats = statsKey ? shapeStats[statsKey] : undefined;
  // Imported meshes keep their statistics under the creating operation, so a
  // selected mesh body reads them through its creator.
  const importedStats = statsKey
    ? (meshStats[statsKey] ?? (body ? meshStats[body.createdBy] : undefined))
    : undefined;
  const featureError = feature
    ? featureErrors[feature.id]
    : body
      ? featureErrors[body.createdBy]
      : undefined;
  // Picking belongs to one operation: selecting anything else ends it.
  useEffect(() => {
    if (picking && picking !== feature?.id) setPickingExtrude(null);
    if (pickingBodies && pickingBodies !== feature?.id) setPickingExtrudeBodies(null);
    if (
      pickingTransformTargets &&
      (pickingTransformTargets !== feature?.id || feature?.type !== 'transform')
    ) {
      setPickingTransformTargets(null);
    }
    if (pickingShellBodies && (pickingShellBodies !== feature?.id || feature?.type !== 'shell')) {
      setPickingShellBodies(null);
    }
    if (pickingShellFaces && (pickingShellFaces !== feature?.id || feature?.type !== 'shell')) {
      setPickingShellFaces(null);
    }
    if (
      pickingBooleanBodies &&
      (pickingBooleanBodies !== feature?.id || feature?.type !== 'boolean')
    ) {
      setPickingBooleanBodies(null);
    }
    if (
      pickingBooleanTools &&
      (pickingBooleanTools !== feature?.id || feature?.type !== 'boolean')
    ) {
      setPickingBooleanTools(null);
    }
    if (
      pickingSketchPlane &&
      (pickingSketchPlane !== feature?.id ||
        feature?.type !== 'sketch' ||
        feature.plane.type !== 'face')
    ) {
      setPickingSketchPlane(null);
    }
    if (
      pickingRevolveAxis &&
      (pickingRevolveAxis !== feature?.id ||
        feature?.type !== 'extrude' ||
        feature.method !== 'revolve')
    ) {
      setPickingRevolveAxis(null);
    }
    if (
      pickingToBody &&
      (pickingToBody !== feature?.id || feature?.type !== 'extrude' || feature.end !== 'to-body')
    ) {
      setPickingToBody(null);
    }
  }, [
    picking,
    pickingBodies,
    pickingTransformTargets,
    setPickingTransformTargets,
    pickingShellBodies,
    pickingShellFaces,
    pickingBooleanBodies,
    pickingBooleanTools,
    pickingSketchPlane,
    pickingRevolveAxis,
    pickingToBody,
    feature,
    setPickingExtrude,
    setPickingExtrudeBodies,
    setPickingShellBodies,
    setPickingShellFaces,
    setPickingBooleanBodies,
    setPickingBooleanTools,
    setPickingSketchPlane,
    setPickingRevolveAxis,
    setPickingToBody,
  ]);

  useEffect(() => {
    if (!pickingSketchPlane) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickingSketchPlane(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pickingSketchPlane, setPickingSketchPlane]);

  useEffect(() => {
    if (!pickingRevolveAxis) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickingRevolveAxis(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pickingRevolveAxis, setPickingRevolveAxis]);

  const extrudeFeature = feature?.type === 'extrude' ? feature : undefined;
  const toBodyKind = extrudeFeature?.toBody?.kind ?? 'first';
  const toBodyOffset = extrudeFeature?.toBodyOffset;
  const toBodyMode = extrudeFeature?.toBody?.mode ?? toBodyModeOf(toBodyOffset, toBodyKind);
  // The field shows a size: the sign it once carried is the mode now.
  const toBodySize =
    typeof toBodyOffset === 'number' ? Math.abs(toBodyOffset) : (toBodyOffset ?? 0);
  const toBodySizeLabel =
    toBodyMode === 'shell' ? 'extrude.toBodyThickness' : 'extrude.toBodyOffset';
  // The field is a size, so a formula that evaluates to a negative number still
  // reads as the distance the extent keeps.
  const toBodyResolved =
    resolvedFeature?.type === 'extrude' && typeof resolvedFeature.toBodyOffset === 'number'
      ? Math.abs(resolvedFeature.toBodyOffset)
      : undefined;
  const toBodyBodyName = extrudeFeature?.toBody?.bodyId
    ? objectName(project, extrudeFeature.toBody.bodyId, t('extrude.toBodyBody'))
    : undefined;
  // A revolve keeps its line between visits; an operation switched by an older
  // file may have no spec yet, so the default stands in.
  const revolve =
    resolvedFeature?.type === 'extrude' && resolvedFeature.method === 'revolve'
      ? (resolvedFeature.revolve ?? defaultRevolve())
      : null;
  const revolveSpec = revolve ?? defaultRevolve();
  const edgeAxis = revolve && revolve.axis.kind !== 'world' ? revolve.axis : undefined;
  const edgeAxisLabel = edgeAxis
    ? geometryName(
        edgeAxis.kind === 'body-edge'
          ? objectName(project, edgeAxis.bodyId, 'Body')
          : (project.features.find((candidate) => candidate.id === edgeAxis.sketchId)?.name ??
              edgeAxis.sketchId),
        edgeAxis.kind === 'body-edge'
          ? bodyEdgeNumber(meshes[edgeAxis.bodyId], edgeAxis.name)
          : null,
      )
    : undefined;
  const axisResolved = revolve
    ? resolveRevolveAxis(revolve.axis, {
        meshes,
        sketches: project.features.filter(
          (candidate): candidate is SketchFeature => candidate.type === 'sketch',
        ),
        frames: sketchFrames,
      }) !== null
    : true;
  const treatmentFeature = feature?.type === 'edge-treatment' ? feature : undefined;
  const resolvedTreatment =
    resolvedFeature?.type === 'edge-treatment' ? resolvedFeature : undefined;
  // The kernel reduces a size that does not fit; the inspector says so next to
  // the field instead of turning the operation into an error.
  const treatmentApplied = treatmentFeature ? featureLimits[treatmentFeature.id] : undefined;
  const treatmentSize = resolvedTreatment?.size ?? 0;
  const treatmentWarning =
    treatmentFeature && treatmentApplied && treatmentApplied.applied < treatmentSize
      ? t('edgeTreatment.maxWarning', {
          value: formatNumber(treatmentApplied.applied, locale, 2),
        })
      : undefined;
  const shellFeature = feature?.type === 'shell' ? feature : undefined;
  const resolvedShell = resolvedFeature?.type === 'shell' ? resolvedFeature : undefined;
  const shellApplied = shellFeature ? featureLimits[shellFeature.id] : undefined;
  const shellThickness = resolvedShell?.thickness ?? 0;
  const shellWarning =
    shellFeature && shellApplied && shellApplied.applied < shellThickness
      ? t('shell.maxWarning', {
          value: formatNumber(shellApplied.applied, locale, 2),
        })
      : undefined;
  const booleanFeature = feature?.type === 'boolean' ? feature : undefined;
  const booleanErrors = booleanFeature ? (featureBodyErrors[booleanFeature.id] ?? {}) : {};
  // The document is read again on every edit: two changes made by one click must
  // build on each other, not on the render that drew the panel.
  const replaceExtrude = (featureId: string, patch: Partial<ExtrudeFeature>) => {
    const current = activeModel(useDocumentStore.getState().project).features.find(
      (candidate): candidate is ExtrudeFeature =>
        candidate.id === featureId && candidate.type === 'extrude',
    );
    const base = current ?? extrudeFeature;
    if (!base) return;
    apply({ type: 'feature/replace', feature: { ...base, ...patch } });
  };
  const setExtrudeEnd = (featureId: string, end: ExtrudeFeature['end']) =>
    replaceExtrude(featureId, { end });

  const setExtrudeSecondDirection = (
    featureId: string,
    secondDirection: ExtrudeFeature['secondDirection'],
  ) => replaceExtrude(featureId, { secondDirection });

  const bodyNameOf = (bodyId: string) => project.metadata[bodyId]?.name;
  const treatmentRowError = (code: string | undefined) =>
    code ? translate(t, `errors.${code}`, code) : undefined;
  const treatmentRows: PickableRow[] = treatmentFeature
    ? [
        ...treatmentFeature.faceRefs.map((ref, index) => ({
          key: `face:${ref.name}`,
          name: t('sketch.face', { index: index + 1 }),
          meta: bodyNameOf(ref.bodyId),
          icon: <Hexagon size={13} />,
          error: treatmentRowError(featureObjectErrors[treatmentFeature.id]?.[`face:${ref.name}`]),
          onRemove: () => toggleEdgeTreatmentFace(treatmentFeature.id, ref),
        })),
        ...treatmentFeature.edgeRefs.map((ref, index) => ({
          key: `edge:${ref.name}`,
          name: t('sketch.edge', { index: index + 1 }),
          meta: bodyNameOf(ref.bodyId),
          icon: <Spline size={13} />,
          error: treatmentRowError(featureObjectErrors[treatmentFeature.id]?.[`edge:${ref.name}`]),
          onRemove: () => toggleEdgeTreatmentEdge(treatmentFeature.id, ref),
        })),
      ]
    : [];

  const shellErrors = shellFeature ? (featureBodyErrors[shellFeature.id] ?? {}) : {};
  const shellBodyIds = shellFeature
    ? [...new Set([...shellFeature.bodyIds, ...shellFeature.removeFaces.map((ref) => ref.bodyId)])]
    : [];
  const shellBodyRows: PickableRow[] = shellFeature
    ? shellBodyIds.map((bodyId) => {
        const body = project.bodies.find((candidate) => candidate.id === bodyId);
        const resolved = body ? resolveBody(project, body) : undefined;
        const error = shellErrors[bodyId] ?? (body ? undefined : 'UNKNOWN_BODY');
        return {
          key: bodyId,
          icon: resolved ? <Box size={14} style={{ color: resolved.color }} /> : <Box size={14} />,
          name: resolved?.name ?? bodyId,
          ...(error ? { error: translate(t, `errors.${error}`, error) } : {}),
          onRemove: () => toggleShellBody(shellFeature.id, bodyId),
        };
      })
    : [];
  const shellFaceRows: PickableRow[] = shellFeature
    ? shellFeature.removeFaces.map((ref, index) => {
        const error = shellErrors[ref.bodyId];
        return {
          key: `face:${ref.name}`,
          name: t('sketch.face', { index: index + 1 }),
          meta: bodyNameOf(ref.bodyId),
          icon: <Hexagon size={13} />,
          ...(error ? { error: translate(t, `errors.${error}`, error) } : {}),
          onRemove: () => toggleShellFace(shellFeature.id, ref),
        };
      })
    : [];

  // A boolean lists the bodies it reads. The rows come from the stored refs,
  // not from the live object list: a consumed body stays visible here so its
  // error can be read and Keep can bring it back.
  const booleanRows = (side: 'bodies' | 'tools', bodyIds: readonly string[]): PickableRow[] =>
    bodyIds.map((bodyId) => {
      const ref = project.bodies.find((candidate) => candidate.id === bodyId);
      const resolved = ref ? resolveBody(project, ref) : undefined;
      const code = ref ? (ref.kind === 'mesh' ? 'BODY_NOT_SOLID' : undefined) : 'UNKNOWN_BODY';
      const error = booleanErrors[bodyId] ?? code;
      return {
        key: `${side}:${bodyId}`,
        icon:
          resolved && resolved.kind === 'mesh' ? (
            <PawPrint size={14} style={{ color: resolved.color }} />
          ) : (
            <Box size={14} style={resolved ? { color: resolved.color } : undefined} />
          ),
        name: resolved?.name ?? bodyId,
        ...(error ? { error: translate(t, `errors.${error}`, error) } : {}),
        onRemove: () => toggleBooleanBody(booleanFeature!.id, side, bodyId),
      };
    });
  const booleanBodyRows = booleanFeature ? booleanRows('bodies', booleanFeature.bodyIds) : [];
  const booleanToolRows = booleanFeature ? booleanRows('tools', booleanFeature.toolIds) : [];

  // What an extrude works on: the whole sketch, or the faces picked from it.
  const targetErrors = extrudeFeature ? (featureBodyErrors[extrudeFeature.id] ?? {}) : {};
  interface ExtrudeObject {
    key: string;
    kind: 'sketch' | 'face' | 'body-face';
    name: string;
    /** A second line under the name, when the name alone is not enough. */
    meta?: string;
    error?: string;
    remove: () => void;
  }
  const extrudeObjects: ExtrudeObject[] = (() => {
    if (!extrudeFeature) return [];
    const entries = new Map<string, ExtrudeObject>();
    if (extrudeFeature.sketchId) {
      const sketch = project.features.find(
        (candidate): candidate is SketchFeature =>
          candidate.id === extrudeFeature.sketchId && candidate.type === 'sketch',
      );
      if (sketch) {
        const name = sketch.name;
        if (extrudeFeature.scope !== 'selected') {
          const key = `s:${sketch.id}#*`;
          entries.set(key, {
            key,
            kind: 'sketch',
            name,
            meta: t('extrude.wholeSketch'),
            remove: () => setExtrudeInput(extrudeFeature.id, null),
          });
        } else {
          const faces = sketchTopology(sketch.entities).faces;
          for (const regionId of extrudeFeature.regions) {
            const key = sketchFaceKey(sketch.id, regionId);
            const index = faces.findIndex((face) => face.id === regionId);
            entries.set(key, {
              key,
              kind: 'face',
              name: geometryName(name, index >= 0 ? index + 1 : null),
              remove: () => toggleExtrudeFace(extrudeFeature.id, sketch.id, regionId),
            });
          }
        }
      }
    }
    for (const ref of extrudeFeature.faceRefs ?? []) {
      const owner = project.bodies.find((candidate) => candidate.id === ref.bodyId);
      const key = bodyFaceKey(ref.name);
      const error = targetErrors[ref.bodyId];
      entries.set(key, {
        key,
        kind: 'body-face',
        name: geometryName(
          owner ? objectName(project, owner.id, 'Body') : ref.bodyId,
          bodyFaceNumber(meshes[ref.bodyId], ref.name),
        ),
        ...(error ? { error } : {}),
        remove: () =>
          toggleExtrudeBodyFace(extrudeFeature.id, ref.bodyId, ref.name, ref.normal, ref.origin),
      });
    }

    // Selection order across sketch and body faces, not the order of the two
    // storage arrays.
    const ordered: ExtrudeObject[] = [];
    const seen = new Set<string>();
    const visit = (key: string) => {
      const entry = entries.get(key);
      if (!entry || seen.has(key)) return;
      seen.add(key);
      ordered.push(entry);
    };
    for (const key of extrudeFeature.objectOrder ?? []) visit(key);
    for (const key of entries.keys()) visit(key);
    return ordered;
  })();

  // Bodies the operation is combined with. An empty list means every body, so
  // the list only narrows the targets down. Imported meshes are objects of a
  // different kind and can never be solid-body targets.
  const otherObjects = extrudeFeature
    ? bodiesInHistory(project, consumedBodies).filter(
        (body) => body.createdBy !== extrudeFeature.id,
      )
    : [];
  const targetBodies = otherObjects.filter((body) => body.kind !== 'mesh');
  const meshTargets = extrudeFeature
    ? otherObjects.filter(
        (body) => body.kind === 'mesh' && extrudeFeature.bodyIds.includes(body.id),
      )
    : [];
  const unknownTargets = extrudeFeature
    ? extrudeFeature.bodyIds.filter((bodyId) => !otherObjects.some((body) => body.id === bodyId))
    : [];

  const objectErrors = extrudeFeature ? (featureObjectErrors[extrudeFeature.id] ?? {}) : {};
  const faceRows: PickableRow[] = extrudeObjects.map((entry) => {
    const error = objectErrors[entry.key] ?? entry.error;
    return {
      key: entry.key,
      icon: entry.kind === 'sketch' ? <SketchIcon size={14} /> : <Hexagon size={14} />,
      name: entry.name,
      meta: entry.meta,
      ...(error ? { error: translate(t, `errors.${error}`, error) } : {}),
      onRemove: entry.remove,
    };
  });

  const bodyRows: PickableRow[] = extrudeFeature
    ? [
        ...targetBodies
          .filter((body) => extrudeFeature.bodyIds.includes(body.id))
          .map((body) => {
            const error = targetErrors[body.id];
            return {
              key: body.id,
              icon: <Box size={14} style={{ color: body.color }} />,
              name: body.name,
              ...(error ? { error: translate(t, `errors.${error}`, error) } : {}),
              ...(extrudeFeature.bodyIds.includes(body.id)
                ? { onRemove: () => toggleExtrudeBodyTarget(extrudeFeature.id, body.id) }
                : {}),
            };
          }),
        ...meshTargets.map((body) => ({
          key: body.id,
          icon: <PawPrint size={14} style={{ color: body.color }} />,
          name: body.name,
          error: translate(t, 'errors.BODY_NOT_SOLID', 'BODY_NOT_SOLID'),
          onRemove: () => toggleExtrudeBodyTarget(extrudeFeature.id, body.id),
        })),
        ...unknownTargets.map((bodyId) => ({
          key: bodyId,
          icon: <Box size={14} />,
          name: bodyId,
          error: translate(t, 'errors.UNKNOWN_BODY', 'UNKNOWN_BODY'),
          onRemove: () => toggleExtrudeBodyTarget(extrudeFeature.id, bodyId),
        })),
      ]
    : [];

  const primitiveValue = (key: PrimitiveSizeKey): number => {
    if (!resolvedFeature || resolvedFeature.type !== 'primitive') return 0;
    return (resolvedFeature.params as Record<string, number>)[key] ?? 0;
  };

  // Every primitive edits the same position fields and its own sizes. The
  // diameters shown here are the stored radii doubled, so the model keeps the
  // numbers the kernel makers take.
  const primitiveSizeFields = (primitive: PrimitiveFeature) => {
    const change = (key: PrimitiveSizeKey, value: ParamValue) =>
      setFeatureParameter(primitive.id, `params.${key}`, value);
    const field = (key: PrimitiveSizeKey) => ({
      value: (primitive.params as Record<string, ParamValue>)[key]!,
      resolved: primitiveValue(key),
      error: paramError(primitive.id, `params.${key}`),
      onCommit: (value: ParamValue) => change(key, value),
    });
    switch (primitive.kind) {
      case 'box':
        return (
          <div className="dimension-row">
            <ParamField
              icon={<SquareArrowRightExit size={13} />}
              label={`${t('inspector.width')} · mm`}
              suffix="mm"
              {...field('dx')}
            />
            <ParamField
              icon={<LayerArrowUp size={13} />}
              label={`${t('inspector.depth')} · mm`}
              suffix="mm"
              {...field('dy')}
            />
            <ParamField
              icon={<MoveVertical size={13} />}
              label={`${t('inspector.height')} · mm`}
              suffix="mm"
              {...field('dz')}
            />
          </div>
        );
      case 'sphere':
        return (
          <>
            <div className="dimension-row">
              <ParamField
                icon={<Circle size={13} />}
                label={`${t('inspector.radius')} · mm`}
                suffix="mm"
                {...field('radius')}
              />
            </div>
            <StatRow
              label={t('inspector.diameter')}
              value={`${formatNumber(primitiveValue('radius') * 2, locale)} mm`}
            />
          </>
        );
      case 'cylinder':
        return (
          <div className="dimension-row">
            <ParamField
              icon={<Circle size={13} />}
              label={`${t('inspector.radius')} · mm`}
              suffix="mm"
              {...field('radius')}
            />
            <ParamField
              icon={<MoveVertical size={13} />}
              label={`${t('inspector.height')} · mm`}
              suffix="mm"
              {...field('height')}
            />
          </div>
        );
      case 'cone':
        return (
          <>
            <div className="dimension-row">
              <ParamField
                icon={<Circle size={13} />}
                label={`${t('inspector.bottomRadius')} · mm`}
                suffix="mm"
                {...field('bottomRadius')}
              />
              <ParamField
                icon={<Circle size={13} />}
                label={`${t('inspector.topRadius')} · mm`}
                suffix="mm"
                allowNegative
                {...field('topRadius')}
              />
              <ParamField
                icon={<MoveVertical size={13} />}
                label={`${t('inspector.height')} · mm`}
                suffix="mm"
                {...field('height')}
              />
            </div>
            <p className="hint">{t('primitive.coneHint')}</p>
          </>
        );
      case 'torus':
        return (
          <>
            <div className="dimension-row">
              <ParamField
                icon={<Torus size={13} />}
                label={`${t('inspector.ringRadius')} · mm`}
                suffix="mm"
                {...field('majorRadius')}
              />
              <ParamField
                icon={<Circle size={13} />}
                label={`${t('inspector.tubeRadius')} · mm`}
                suffix="mm"
                {...field('tubeRadius')}
              />
            </div>
            <StatRow
              label={t('inspector.ringDiameter')}
              value={`${formatNumber(primitiveValue('majorRadius') * 2, locale)} mm`}
            />
            <StatRow
              label={t('inspector.tubeDiameter')}
              value={`${formatNumber(primitiveValue('tubeRadius') * 2, locale)} mm`}
            />
            <p className="hint">{t('primitive.torusHint')}</p>
          </>
        );
      case 'pyramid':
        return (
          <>
            <div className="dimension-row">
              <ParamField
                axis="N"
                label={`${t('inspector.sides')} (${PYRAMID_MIN_SIDES}–${PYRAMID_MAX_SIDES})`}
                tooltip={t('primitive.pyramidHint')}
                {...field('sides')}
              />
              <ParamField
                icon={<Circle size={13} />}
                label={`${t('inspector.baseRadius')} · mm`}
                suffix="mm"
                {...field('radius')}
              />
              <ParamField
                icon={<MoveVertical size={13} />}
                label={`${t('inspector.height')} · mm`}
                suffix="mm"
                {...field('height')}
              />
            </div>
          </>
        );
      case 'capsule':
        return (
          <>
            <div className="dimension-row">
              <ParamField
                icon={<Circle size={13} />}
                label={`${t('inspector.radius')} · mm`}
                suffix="mm"
                {...field('radius')}
              />
              <ParamField
                icon={<MoveVertical size={13} />}
                label={`${t('inspector.height')} · mm`}
                suffix="mm"
                {...field('height')}
              />
            </div>
            <StatRow
              label={t('inspector.totalLength')}
              value={`${formatNumber(
                primitiveValue('height') + primitiveValue('radius') * 2,
                locale,
              )} mm`}
            />
          </>
        );
    }
  };

  const boundsOf = (candidate: typeof mesh) =>
    candidate
      ? `${formatNumber(candidate.bbox.max[0] - candidate.bbox.min[0], locale)} × ${formatNumber(
          candidate.bbox.max[1] - candidate.bbox.min[1],
          locale,
        )} × ${formatNumber(candidate.bbox.max[2] - candidate.bbox.min[2], locale)} mm`
      : '—';

  const resolved: ResolvedItem[] =
    selection.length > 1
      ? selection.flatMap<ResolvedItem>((item) => {
          if (item.kind === 'body') {
            const match = project.bodies.find((candidate) => candidate.id === item.id);
            return match
              ? [
                  {
                    key: `body:${match.id}`,
                    kind: 'body' as const,
                    name: objectName(project, match.id, 'Body'),
                    bodyId: match.id,
                  },
                ]
              : [];
          }
          if (item.kind === 'mesh') {
            const match = project.bodies.find((candidate) => candidate.id === item.id);
            return match
              ? [
                  {
                    key: `mesh:${match.id}`,
                    kind: 'mesh' as const,
                    name: objectName(project, match.id, 'Mesh'),
                    bodyId: match.id,
                  },
                ]
              : [];
          }
          if (item.kind === 'feature') {
            const match = project.features.find((candidate) => candidate.id === item.id);
            return match
              ? [
                  {
                    key: `feature:${match.id}`,
                    kind: 'feature' as const,
                    name: match.name,
                    bodyId: match.type === 'sketch' ? null : featureBodyId(match.id),
                  },
                ]
              : [];
          }
          if (item.kind === 'sketch') {
            const match = project.features.find(
              (candidate) => candidate.id === item.id && candidate.type === 'sketch',
            );
            return match
              ? [
                  {
                    key: `sketch:${match.id}`,
                    kind: 'sketch' as const,
                    name: match.name,
                    bodyId: null,
                  },
                ]
              : [];
          }
          if (item.kind === 'group') {
            const match = project.groups.find((candidate) => candidate.id === item.id);
            return match
              ? [
                  {
                    key: `group:${match.id}`,
                    kind: 'group' as const,
                    name: match.name,
                    bodyId: null,
                  },
                ]
              : [];
          }
          return [];
        })
      : [];

  const multiMeshes = resolved
    .map((item) => (item.bodyId ? meshes[item.bodyId] : undefined))
    .filter((candidate) => candidate !== undefined);
  const multiTriangles = multiMeshes.reduce((sum, candidate) => sum + candidate.triangleCount, 0);
  const multiBounds = (() => {
    if (multiMeshes.length === 0) return '—';
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const candidate of multiMeshes) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis]!, candidate.bbox.min[axis]!);
        max[axis] = Math.max(max[axis]!, candidate.bbox.max[axis]!);
      }
    }
    return `${formatNumber(max[0]! - min[0]!, locale)} × ${formatNumber(
      max[1]! - min[1]!,
      locale,
    )} × ${formatNumber(max[2]! - min[2]!, locale)} mm`;
  })();

  // The panel is the parameters of one object, so the header names what is
  // selected and carries the visibility toggle of that object.
  const headerTitle =
    resolved.length > 1
      ? `${t('inspector.selection')} · ${resolved.length}`
      : sketchObject
        ? t('inspector.sketch')
        : selectedGroup
          ? t('inspector.group')
          : feature
            ? featureTypeLabel((key) => t(key as never), feature)
            : body
              ? body.kind === 'mesh'
                ? t('inspector.mesh')
                : t('inspector.body')
              : t('inspector.model');
  const visibility = sketchObject
    ? {
        visible: objectVisible(project, sketchObjectId(sketchObject.id)),
        toggle: () => toggleSketchVisibility(sketchObject.id),
      }
    : body
      ? { visible: body.visible, toggle: () => toggleBodyVisibility(body.id) }
      : undefined;
  // A sketch is edited in its own editor, so the panel of a selected sketch
  // carries the way in: the row of the tree, the operation in the strip and this
  // header all offer the same door. The panel is about the sketch whether the
  // tree selected the object or the strip selected the operation.
  const panelSketch = sketchObject ?? (feature?.type === 'sketch' ? feature : undefined);
  const sketchToEdit =
    panelSketch && activeSketchId !== panelSketch.id && canEditSketch(panelSketch, featureErrors)
      ? panelSketch
      : undefined;
  return (
    <div className="panel" data-testid="inspector">
      <header className="panel-header">
        <span>{headerTitle}</span>
        {sketchToEdit && (
          <IconButton
            label={t('sketch.edit')}
            tooltip={t('sketch.edit')}
            className="tiny"
            onClick={() => setActiveSketch(sketchToEdit.id)}
          >
            <Pencil size={13} />
          </IconButton>
        )}
        {visibility && (
          <IconButton
            label={visibility.visible ? t('tree.hide') : t('tree.show')}
            className="tiny"
            onClick={visibility.toggle}
          >
            {visibility.visible ? <Eye size={13} /> : <EyeOff size={13} />}
          </IconButton>
        )}
      </header>

      <div className="panel-body">
        {resolved.length > 0 ? (
          <>
            <PanelSection title={t('inspector.objects')} count={resolved.length} divided>
              <div className="selection-list">
                {resolved.map((item) => (
                  <div key={item.key} className="selection-item">
                    <span className="tree-icon">
                      {item.kind === 'mesh' ? (
                        <PawPrint size={14} />
                      ) : item.kind === 'group' ? (
                        <Folder size={14} />
                      ) : (
                        <Box size={14} />
                      )}
                    </span>
                    <span className="tree-name">{item.name}</span>
                    <span className="tree-meta">
                      {item.kind === 'mesh'
                        ? t('inspector.mesh')
                        : item.kind === 'body'
                          ? t('inspector.body')
                          : item.kind === 'sketch'
                            ? t('inspector.sketch')
                            : item.kind === 'group'
                              ? t('inspector.group')
                              : t('inspector.operation')}
                    </span>
                  </div>
                ))}
              </div>
            </PanelSection>

            <PanelSection title={t('inspector.metrics')} divided>
              <StatRow
                label={t('inspector.triangles')}
                value={formatNumber(multiTriangles, locale, 0)}
              />
              <StatRow label={t('inspector.bounds')} value={multiBounds} />
            </PanelSection>
          </>
        ) : sketchObject && sketchGeometry ? (
          <>
            <PanelSection title={t('inspector.display')}>
              <div className="stat-row">
                <span className="stat-label">{t('inspector.showConstruction')}</span>
                <Switch
                  label={t('inspector.showConstruction')}
                  checked={objectShowConstruction(project, sketchObjectId(sketchObject.id))}
                  onChange={(visible) => setConstructionVisible(sketchObject.id, visible)}
                />
              </div>
            </PanelSection>

            {sketchGeometry.faces.length > 0 && (
              <PanelSection
                title={t('inspector.faces')}
                count={sketchGeometry.faces.length}
                icon={<Hexagon size={13} />}
                divided
              >
                <div className="selection-list">
                  {sketchGeometry.faces.map((face, index) => {
                    const faceKey = `${sketchObject.id}#${face.id}`;
                    const active = selection.some(
                      (item) => item.kind === 'face' && item.id === faceKey,
                    );
                    return (
                      <button
                        key={face.id}
                        type="button"
                        className="selection-item"
                        data-active={active ? 'true' : undefined}
                        onClick={(event) => clickSketchFace(event, faceKey)}
                      >
                        <span className="tree-name">{t('sketch.face', { index: index + 1 })}</span>
                        <span className="tree-meta">{formatNumber(face.area, locale, 1)} mm²</span>
                      </button>
                    );
                  })}
                </div>
              </PanelSection>
            )}

            <PanelSection
              title={t('inspector.edges')}
              count={sketchGeometry.edges.length}
              icon={<Spline size={13} />}
              divided
            >
              {sketchGeometry.edges.length === 0 ? (
                <p className="hint">{t('sketch.noGeometry')}</p>
              ) : (
                <div className="selection-list">
                  {sketchGeometry.edges.map((edge, index) => {
                    const edgeKey = `${sketchObject.id}#${edge.id}`;
                    const active = selection.some(
                      (item) => item.kind === 'sketch-edge' && item.id === edgeKey,
                    );
                    return (
                      <button
                        key={edge.id}
                        type="button"
                        className="selection-item"
                        data-active={active ? 'true' : undefined}
                        onClick={(event) => clickSketchEdge(event, edgeKey)}
                      >
                        <span className="tree-name">{t('sketch.edge', { index: index + 1 })}</span>
                        <span className="tree-meta">{formatNumber(edge.length, locale, 1)} mm</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </PanelSection>

            {sketchGeometry.points.length > 0 && (
              <PanelSection
                title={t('inspector.points')}
                count={sketchGeometry.points.length}
                icon={<PointIcon size={13} />}
                divided
              >
                <div className="selection-list">
                  {sketchGeometry.points.map((point, index) => (
                    <div key={point.id} className="selection-item">
                      <span className="tree-name">{t('sketch.point', { index: index + 1 })}</span>
                      <span className="tree-meta">
                        {`${formatNumber(point.x, locale, 1)}, ${formatNumber(point.y, locale, 1)}`}
                      </span>
                    </div>
                  ))}
                </div>
              </PanelSection>
            )}

            {featureErrors[sketchObject.id] && (
              <FormError
                message={translate(
                  t,
                  `errors.${featureErrors[sketchObject.id]}`,
                  featureErrors[sketchObject.id],
                )}
              />
            )}
          </>
        ) : selectedGroup ? (
          <>
            <div className="inspector-field">
              <TextField
                label={t('inspector.name')}
                value={selectedGroup.name}
                onCommit={(name) => renameGroup(selectedGroup.id, name)}
              />
            </div>
            <PanelSection title={t('inspector.groupContents')} count={groupContents.length} divided>
              <div className="selection-list">
                {groupContents.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    className="selection-item"
                    onDoubleClick={() => {
                      if (node.kind === 'group') {
                        setTimelineGroup(node.id);
                        return;
                      }
                      // The operation lives in the folder being inspected: open
                      // that folder and select it, so the strip shows what the
                      // panel was talking about.
                      setTimelineGroup(node.feature.groupId ?? null);
                      select({ kind: 'feature', id: node.feature.id });
                    }}
                  >
                    <span className="tree-icon">
                      {node.kind === 'group' ? (
                        <Folder size={14} />
                      ) : (
                        <FeatureIcon feature={node.feature} size={14} />
                      )}
                    </span>
                    <span className="tree-name">
                      {node.kind === 'group' ? node.group.name : node.feature.name}
                    </span>
                    <span className="tree-meta">
                      {node.kind === 'group'
                        ? t('timeline.operationCount', {
                            count: groupFeatureIds(project, node.id).length,
                          })
                        : t('inspector.operation')}
                    </span>
                  </button>
                ))}
              </div>
            </PanelSection>
          </>
        ) : feature ? (
          <>
            <div className="inspector-field">
              <TextField
                label={t('inspector.name')}
                value={feature.name}
                onCommit={(name) =>
                  apply({ type: 'feature/replace', feature: { ...feature, name } })
                }
              />
            </div>

            {feature.type === 'sketch' && (
              <PanelSection title={t('sketch.placement')}>
                <div className="section-stack">
                  <div className="sketch-plane-row">
                    <Segmented ariaLabel={t('sketch.plane')}>
                      {(['XY', 'XZ', 'YZ'] as const).map((plane) => (
                        <SegmentedTab
                          key={plane}
                          label={plane}
                          active={feature.plane.type === 'datum' && feature.plane.plane === plane}
                          onClick={() =>
                            apply({
                              type: 'feature/replace',
                              feature: {
                                ...feature,
                                plane: {
                                  type: 'datum',
                                  plane,
                                  offset: feature.plane.offset ?? 0,
                                  ...(feature.plane.rotation
                                    ? { rotation: feature.plane.rotation }
                                    : {}),
                                },
                              },
                            })
                          }
                        />
                      ))}
                      <SegmentedTab
                        label={t('sketch.planeFace')}
                        icon={<Hexagon size={12} />}
                        active={feature.plane.type === 'face'}
                        onClick={() => {
                          if (feature.plane.type === 'face') return;
                          apply({
                            type: 'feature/replace',
                            feature: {
                              ...feature,
                              plane: {
                                type: 'face',
                                offset: feature.plane.offset ?? 0,
                                ...(feature.plane.rotation
                                  ? { rotation: feature.plane.rotation }
                                  : {}),
                              },
                            },
                          });
                        }}
                      />
                    </Segmented>
                    <ParamField
                      icon={<MoveVertical size={13} />}
                      label={t('sketch.offset')}
                      suffix="mm"
                      allowNegative
                      value={feature.plane.offset ?? 0}
                      resolved={sketchOffset}
                      error={paramError(feature.id, 'plane.offset')}
                      onCommit={(value) => setFeatureParameter(feature.id, 'plane.offset', value)}
                    />
                    <IconButton
                      label={t('sketch.invert')}
                      active={feature.plane.inverted === true}
                      onClick={() =>
                        apply({
                          type: 'feature/replace',
                          feature: {
                            ...feature,
                            plane: {
                              ...feature.plane,
                              inverted: !feature.plane.inverted,
                            },
                          },
                        })
                      }
                    >
                      <RefreshCw size={14} />
                    </IconButton>
                  </div>
                  {feature.plane.type === 'face' && (
                    <ObjectPickerField
                      label={t('sketch.planeFace')}
                      value={
                        sketchPlaneReady(feature)
                          ? t('sketch.face', {
                              index:
                                bodyFaceNumber(
                                  meshes[feature.plane.bodyId ?? ''],
                                  feature.plane.name ?? '',
                                ) ?? 1,
                            })
                          : undefined
                      }
                      placeholder={t('sketch.selectFace')}
                      icon={<Hexagon size={14} />}
                      active={pickingSketchPlane === feature.id}
                      invalid={!sketchPlaneReady(feature) || Boolean(featureErrors[feature.id])}
                      onClick={() =>
                        setPickingSketchPlane(pickingSketchPlane === feature.id ? null : feature.id)
                      }
                      testId="sketch-face-picker"
                    />
                  )}
                  <SketchRotationFields
                    feature={feature}
                    resolved={resolvedFeature?.type === 'sketch' ? resolvedFeature : undefined}
                    paramError={(path) => paramError(feature.id, path)}
                    onChange={(rotation) =>
                      apply({
                        type: 'feature/replace',
                        feature: { ...feature, plane: { ...feature.plane, rotation } },
                      })
                    }
                    onParameter={(path, value) => setFeatureParameter(feature.id, path, value)}
                  />
                </div>
              </PanelSection>
            )}

            {feature.type === 'sketch' && (
              <>
                <SketchComposition feature={feature} />
                {activeSketchId === feature.id && <SketchConstraints feature={feature} />}
              </>
            )}

            {feature.type === 'extrude' && (
              <>
                <PanelSection title={t('extrude.operation')}>
                  <Segmented ariaLabel={t('extrude.operation')}>
                    {EXTRUDE_OPS.map((op) => (
                      <SegmentedTab
                        key={op.id}
                        label={t(op.label as never)}
                        icon={op.icon}
                        active={feature.op === op.id}
                        onClick={() => setExtrudeOp(feature.id, op.id)}
                      />
                    ))}
                  </Segmented>
                </PanelSection>

                <PanelSection title={t('extrude.method')}>
                  <div className="section-stack">
                    <Segmented ariaLabel={t('extrude.method')}>
                      {EXTRUDE_EXTENTS.filter(
                        (extent) => extent.id !== 'through-all' || throughAllAllowed(feature.op),
                      ).map((extent) => (
                        <SegmentedTab
                          key={extent.id}
                          label={t(extent.label as never)}
                          icon={extent.icon}
                          active={
                            extent.revolve
                              ? feature.method === 'revolve'
                              : feature.method === 'extrude' && feature.end === extent.id
                          }
                          onClick={() => {
                            if (extent.revolve) {
                              setExtrudeMethod(feature.id, 'revolve');
                              return;
                            }
                            setExtrudeMethod(feature.id, 'extrude');
                            setExtrudeEnd(feature.id, extent.id);
                            if (extent.id === 'to-body') {
                              if (!feature.toBody) setExtrudeToBody(feature.id, { kind: 'first' });
                            } else {
                              setPickingToBody(null);
                            }
                          }}
                        />
                      ))}
                    </Segmented>
                    {feature.method === 'revolve' ? (
                      <>
                        <div className="control-group">
                          <span className="field-label">{t('extrude.axis')}</span>
                          <Segmented ariaLabel={t('extrude.revolveAxis')}>
                            {(['x', 'y', 'z'] as const).map((axis) => (
                              <SegmentedTab
                                key={axis}
                                label={axis.toUpperCase()}
                                active={
                                  revolveSpec.axis.kind === 'world' &&
                                  revolveSpec.axis.axis === axis
                                }
                                onClick={() => {
                                  setPickingRevolveAxis(null);
                                  setRevolveAxis(feature.id, { kind: 'world', axis });
                                }}
                              />
                            ))}
                            <SegmentedTab
                              label={t('extrude.edge')}
                              icon={<Spline size={12} />}
                              active={Boolean(edgeAxis) || pickingRevolveAxis === feature.id}
                              onClick={() =>
                                setPickingRevolveAxis(
                                  pickingRevolveAxis === feature.id ? null : feature.id,
                                )
                              }
                            />
                          </Segmented>
                          {(edgeAxis || pickingRevolveAxis === feature.id) && (
                            <ObjectPickerField
                              compact
                              label={t('extrude.selectEdge')}
                              value={edgeAxisLabel}
                              placeholder={t('extrude.selectEdge')}
                              icon={<Spline size={12} />}
                              active={pickingRevolveAxis === feature.id}
                              invalid={edgeAxis !== undefined && !axisResolved}
                              onClick={() =>
                                setPickingRevolveAxis(
                                  pickingRevolveAxis === feature.id ? null : feature.id,
                                )
                              }
                              // A picked edge is one object: dropping it leaves
                              // the sweep on a world axis, which is never empty.
                              onClear={
                                edgeAxis
                                  ? () => setRevolveAxis(feature.id, { kind: 'world', axis: 'z' })
                                  : undefined
                              }
                              clearLabel={t('common.clear')}
                              testId="revolve-axis-picker"
                            />
                          )}
                        </div>
                        <div className="control-group">
                          <span className="field-label">{t('extrude.rotation')}</span>
                          <div className="dimension-row">
                            <ParamField
                              icon={<ArrowRightFromLine size={14} />}
                              label={t('extrude.angleStart')}
                              suffix="°"
                              value={feature.revolve?.start ?? revolveSpec.start}
                              resolved={revolveSpec.start}
                              error={paramError(feature.id, 'revolve.start')}
                              allowNegative
                              onCommit={(value) => setRevolveAngles(feature.id, { start: value })}
                            />
                            <ParamField
                              icon={<ArrowRightToLine size={14} />}
                              label={t('extrude.angleEnd')}
                              suffix="°"
                              value={feature.revolve?.end ?? revolveSpec.end}
                              resolved={revolveSpec.end}
                              error={paramError(feature.id, 'revolve.end')}
                              allowNegative
                              onCommit={(value) => setRevolveAngles(feature.id, { end: value })}
                            />
                            <span className="dimension-toggle">
                              <IconButton
                                label={t('extrude.invertRevolve')}
                                tooltip={t('extrude.invertRevolve')}
                                active={revolveSpec.inverted}
                                className="dimension-toggle-button"
                                onClick={() =>
                                  setRevolveInverted(feature.id, !revolveSpec.inverted)
                                }
                              >
                                <ArrowLeftRight size={15} />
                              </IconButton>
                            </span>
                          </div>
                        </div>
                      </>
                    ) : feature.end === 'to-body' ? null : (
                      <div className="control-group">
                        {feature.end !== 'through-all' && feature.end !== 'symmetric' && (
                          <span className="field-label">{t('extrude.distance')}</span>
                        )}
                        <div className="dimension-row">
                          {feature.end !== 'through-all' && (
                            <ParamField
                              axis="↑"
                              label={t('extrude.distance')}
                              suffix="mm"
                              value={feature.distance}
                              resolved={
                                resolvedFeature?.type === 'extrude'
                                  ? resolvedFeature.distance
                                  : undefined
                              }
                              error={paramError(feature.id, 'distance')}
                              onCommit={(value) =>
                                setFeatureParameter(feature.id, 'distance', value)
                              }
                            />
                          )}
                          {feature.end !== 'symmetric' && (
                            <span className="dimension-toggle">
                              <IconButton
                                label={t('extrude.reverseDirection')}
                                tooltip={t('extrude.reverseDirection')}
                                active={feature.reversed}
                                className="dimension-toggle-button"
                                onClick={() => setExtrudeReversed(feature.id, !feature.reversed)}
                              >
                                <ArrowLeftRight size={15} />
                              </IconButton>
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </PanelSection>

                {feature.method === 'extrude' && feature.end === 'to-body' && (
                  <>
                    <PanelSection title={t('extrude.toBody')}>
                      {/* Which face ends the sweep, with the invert button next
                          to the tabs for aiming it at a body on the other side
                          of the profile. */}
                      <div className="dimension-row extrude-target-row">
                        <Segmented ariaLabel={t('extrude.toBody')}>
                          {EXTRUDE_TO_BODY_KINDS.map((kind) => (
                            <SegmentedTab
                              key={kind.id}
                              label={t(kind.label as never)}
                              icon={kind.icon}
                              active={toBodyKind === kind.id}
                              onClick={() =>
                                setExtrudeToBody(feature.id, { ...feature.toBody, kind: kind.id })
                              }
                            />
                          ))}
                        </Segmented>
                        <span className="dimension-toggle">
                          <IconButton
                            label={t('extrude.reverseDirection')}
                            tooltip={t('extrude.reverseDirection')}
                            active={feature.reversed}
                            className="dimension-toggle-button"
                            onClick={() => setExtrudeReversed(feature.id, !feature.reversed)}
                          >
                            <ArrowLeftRight size={15} />
                          </IconButton>
                        </span>
                      </div>
                    </PanelSection>

                    <PanelSection title={t('extrude.toBodyMode')}>
                      <div className="section-stack">
                        <Segmented ariaLabel={t('extrude.toBodyMode')}>
                          {EXTRUDE_TO_BODY_MODES.map((mode) => (
                            <SegmentedTab
                              key={mode.id}
                              label={t(mode.label as never)}
                              icon={mode.icon}
                              active={toBodyMode === mode.id}
                              onClick={() => setExtrudeToBodyMode(feature.id, mode.id)}
                            />
                          ))}
                        </Segmented>
                        {/* Only a gap and a layer have a size; ending on the face
                            is the shape of the profile itself. */}
                        {toBodyMode !== 'solid' && (
                          <div className="control-group">
                            <span className="field-label">{t(toBodySizeLabel as never)}</span>
                            <div className="dimension-row">
                              <ParamField
                                icon={
                                  toBodyMode === 'shell' ? (
                                    <ArrowLeftFromLine size={14} />
                                  ) : (
                                    <ArrowRightToLine size={14} />
                                  )
                                }
                                label={t(toBodySizeLabel as never)}
                                suffix="mm"
                                value={toBodySize}
                                resolved={toBodyResolved}
                                error={paramError(feature.id, 'toBodyOffset')}
                                onCommit={(value) =>
                                  setExtrudeToBodyOffset(feature.id, value, toBodyMode)
                                }
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </PanelSection>
                  </>
                )}

                {feature.method === 'extrude' && secondDirectionAllowed(feature) && (
                  <PanelSection
                    title={t('extrude.secondDirection')}
                    action={
                      <Switch
                        label={t('extrude.secondDirection')}
                        checked={feature.secondDirection !== undefined}
                        onChange={(enabled) =>
                          setExtrudeSecondDirection(
                            feature.id,
                            enabled
                              ? {
                                  end: 'blind',
                                  distance:
                                    resolvedFeature?.type === 'extrude'
                                      ? Math.abs(resolvedFeature.distance)
                                      : 0,
                                }
                              : undefined,
                          )
                        }
                      />
                    }
                  >
                    {feature.secondDirection && (
                      <div className="section-stack">
                        <Segmented ariaLabel={t('extrude.secondEnd')}>
                          {EXTRUDE_SECOND_ENDS.filter(
                            (end) => end.id !== 'through-all' || throughAllAllowed(feature.op),
                          ).map((end) => (
                            <SegmentedTab
                              key={end.id}
                              label={t(end.label as never)}
                              icon={end.icon}
                              active={feature.secondDirection?.end === end.id}
                              onClick={() =>
                                setExtrudeSecondDirection(feature.id, {
                                  end: end.id,
                                  distance: feature.secondDirection?.distance ?? 10,
                                })
                              }
                            />
                          ))}
                        </Segmented>
                        {feature.secondDirection.end !== 'through-all' && (
                          <div className="dimension-row">
                            <ParamField
                              axis="↓"
                              label={t('extrude.distance')}
                              suffix="mm"
                              value={feature.secondDirection?.distance ?? 0}
                              resolved={
                                resolvedFeature?.type === 'extrude'
                                  ? resolvedFeature.secondDirection?.distance
                                  : undefined
                              }
                              error={paramError(feature.id, 'secondDirection.distance')}
                              onCommit={(value) =>
                                setExtrudeSecondDirection(feature.id, {
                                  end: feature.secondDirection?.end ?? 'blind',
                                  distance: value,
                                })
                              }
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </PanelSection>
                )}

                {featureError && (
                  <FormError
                    title={t('inspector.operationError')}
                    message={translate(t, `errors.${featureError}`, featureError)}
                  />
                )}

                {feature.op !== 'new' && (
                  <PickableSection
                    title={t('extrude.bodies')}
                    count={feature.bodyIds.length > 0 ? feature.bodyIds.length : undefined}
                    picking={pickingBodies === feature.id}
                    onTogglePicking={() =>
                      setPickingExtrudeBodies(pickingBodies === feature.id ? null : feature.id)
                    }
                    pickLabel={t('extrude.pickBodies')}
                    finishLabel={t('extrude.finishPick')}
                    hint={feature.bodyIds.length === 0 ? t('extrude.allBodiesHint') : undefined}
                    emptyHint={t('extrude.allBodiesHint')}
                    pickHint={t('extrude.pickBodiesHint')}
                    removeLabel={t('extrude.removeObject')}
                    rows={bodyRows}
                  />
                )}

                {feature.method === 'extrude' && feature.end === 'to-body' && (
                  <PanelSection title={t('extrude.toBodySearch')}>
                    {/* The body is optional: without one the sweep takes the
                        nearest body for "first" and the farthest for "last",
                        with one it ignores everything else on the way. */}
                    <ObjectPickerField
                      compact
                      label={t('extrude.toBodyBody')}
                      value={toBodyBodyName}
                      placeholder={t('extrude.toBodyAnyBody')}
                      icon={<Box size={12} />}
                      active={pickingToBody === feature.id}
                      onClick={() =>
                        setPickingToBody(pickingToBody === feature.id ? null : feature.id)
                      }
                      onClear={
                        feature.toBody?.bodyId
                          ? () => {
                              setPickingToBody(null);
                              setExtrudeToBody(feature.id, { ...feature.toBody, kind: toBodyKind });
                            }
                          : undefined
                      }
                      clearLabel={t('common.clear')}
                      testId="extrude-to-body-picker"
                    />
                  </PanelSection>
                )}

                <PickableSection
                  title={t('extrude.objects')}
                  count={extrudeObjects.length}
                  picking={picking === feature.id}
                  onTogglePicking={() =>
                    setPickingExtrude(picking === feature.id ? null : feature.id)
                  }
                  pickLabel={t('extrude.pickFaces')}
                  finishLabel={t('extrude.finishPick')}
                  emptyHint={t('extrude.noObjects')}
                  pickHint={t('extrude.pickHint')}
                  removeLabel={t('extrude.removeObject')}
                  rows={faceRows}
                />
              </>
            )}

            {feature.type === 'import-mesh' && <ImportMeshSection feature={feature} />}
            {feature.type === 'array' && <ArraySection feature={feature} />}
            {feature.type === 'transform' && <TransformSection feature={feature} />}

            {treatmentFeature && (
              <>
                <PanelSection title={t('edgeTreatment.kind')}>
                  <Segmented ariaLabel={t('edgeTreatment.kind')}>
                    <SegmentedTab
                      label={t('edgeTreatment.fillet')}
                      icon={<FilletIcon />}
                      active={treatmentFeature.kind === 'fillet'}
                      onClick={() => setEdgeTreatmentKind(treatmentFeature.id, 'fillet')}
                    />
                    <SegmentedTab
                      label={t('edgeTreatment.chamfer')}
                      icon={<ChamferIcon />}
                      active={treatmentFeature.kind === 'chamfer'}
                      onClick={() => setEdgeTreatmentKind(treatmentFeature.id, 'chamfer')}
                    />
                  </Segmented>
                </PanelSection>

                <PanelSection
                  title={t(
                    treatmentFeature.kind === 'fillet'
                      ? 'edgeTreatment.radius'
                      : 'edgeTreatment.distance',
                  )}
                >
                  <div className="dimension-row">
                    <ParamField
                      icon={<MoveVertical size={13} />}
                      label={t(
                        treatmentFeature.kind === 'fillet'
                          ? 'edgeTreatment.radius'
                          : 'edgeTreatment.distance',
                      )}
                      suffix="mm"
                      value={treatmentFeature.size}
                      resolved={treatmentSize}
                      error={paramError(treatmentFeature.id, 'size')}
                      warning={treatmentWarning}
                      onCommit={(value) => setFeatureParameter(treatmentFeature.id, 'size', value)}
                    />
                  </div>
                </PanelSection>

                <PickableSection
                  title={t('edgeTreatment.targets')}
                  count={treatmentRows.length}
                  picking={pickingEdges === treatmentFeature.id}
                  onTogglePicking={() =>
                    setPickingEdges(
                      pickingEdges === treatmentFeature.id ? null : treatmentFeature.id,
                    )
                  }
                  pickLabel={t('extrude.pickFaces')}
                  finishLabel={t('extrude.finishPick')}
                  emptyHint={t('edgeTreatment.emptyHint')}
                  pickHint={t('edgeTreatment.pickHint')}
                  removeLabel={t('extrude.removeObject')}
                  rows={treatmentRows}
                />
              </>
            )}

            {shellFeature && (
              <>
                <PanelSection title={t('shell.direction')}>
                  <Segmented ariaLabel={t('shell.direction')}>
                    <SegmentedTab
                      label={t('shell.cavity')}
                      icon={<Box size={12} />}
                      active={shellFeature.direction === 'inward'}
                      onClick={() => setShellDirection(shellFeature.id, 'inward')}
                    />
                    <SegmentedTab
                      label={t('shell.shell')}
                      icon={<ShellIcon size={12} />}
                      active={shellFeature.direction === 'outward'}
                      onClick={() => setShellDirection(shellFeature.id, 'outward')}
                    />
                  </Segmented>
                </PanelSection>

                <PanelSection title={t('shell.thickness')}>
                  <div className="dimension-row">
                    <ParamField
                      icon={<MoveVertical size={13} />}
                      label={t('shell.thickness')}
                      suffix="mm"
                      value={shellFeature.thickness}
                      resolved={shellThickness}
                      error={paramError(shellFeature.id, 'thickness')}
                      warning={shellWarning}
                      onCommit={(value) => setFeatureParameter(shellFeature.id, 'thickness', value)}
                    />
                    {shellFeature.direction === 'outward' && (
                      <ParamField
                        icon={<ArrowLeftRight size={13} />}
                        label={t('shell.offset')}
                        suffix="mm"
                        allowNegative
                        value={shellFeature.offset ?? 0}
                        resolved={resolvedShell?.offset}
                        error={paramError(shellFeature.id, 'offset')}
                        onCommit={(value) =>
                          setFeatureParameter(
                            shellFeature.id,
                            'offset',
                            typeof value === 'number' ? Math.max(0, value) : value,
                          )
                        }
                      />
                    )}
                  </div>
                </PanelSection>

                <PickableSection
                  title={t('shell.targets')}
                  count={shellBodyRows.length}
                  picking={pickingShellBodies === shellFeature.id}
                  onTogglePicking={() =>
                    setPickingShellBodies(
                      pickingShellBodies === shellFeature.id ? null : shellFeature.id,
                    )
                  }
                  pickLabel={t('shell.pickBodies')}
                  finishLabel={t('extrude.finishPick')}
                  emptyHint={t('shell.emptyBodies')}
                  pickHint={t('shell.pickBodiesHint')}
                  removeLabel={t('extrude.removeObject')}
                  rows={shellBodyRows}
                />

                <PickableSection
                  title={t('shell.openFaces')}
                  count={shellFaceRows.length}
                  picking={pickingShellFaces === shellFeature.id}
                  onTogglePicking={() =>
                    setPickingShellFaces(
                      pickingShellFaces === shellFeature.id ? null : shellFeature.id,
                    )
                  }
                  pickLabel={t('shell.pickFaces')}
                  finishLabel={t('extrude.finishPick')}
                  emptyHint={t('shell.emptyFaces')}
                  pickHint={t('shell.pickFacesHint')}
                  removeLabel={t('extrude.removeObject')}
                  rows={shellFaceRows}
                />

                {featureError && (
                  <FormError
                    title={t('inspector.operationError')}
                    message={translate(t, `errors.${featureError}`, featureError)}
                  />
                )}
              </>
            )}

            {booleanFeature && (
              <>
                <PanelSection title={t('boolean.operation')}>
                  <Segmented ariaLabel={t('boolean.operation')}>
                    {BOOLEAN_OPS.map((op) => (
                      <SegmentedTab
                        key={op.id}
                        label={t(op.label as never)}
                        icon={op.icon}
                        active={booleanFeature.op === op.id}
                        onClick={() => setBooleanOp(booleanFeature.id, op.id)}
                      />
                    ))}
                  </Segmented>
                </PanelSection>

                <PickableSection
                  title={t('boolean.bodies')}
                  count={booleanBodyRows.length}
                  picking={pickingBooleanBodies === booleanFeature.id}
                  onTogglePicking={() =>
                    setPickingBooleanBodies(
                      pickingBooleanBodies === booleanFeature.id ? null : booleanFeature.id,
                    )
                  }
                  pickLabel={t('boolean.pickBodies')}
                  finishLabel={t('extrude.finishPick')}
                  emptyHint={t('boolean.emptyBodies')}
                  pickHint={t('boolean.pickBodiesHint')}
                  removeLabel={t('extrude.removeObject')}
                  rows={booleanBodyRows}
                  toggle={
                    <BooleanKeepToggle
                      keep={booleanFeature.keepBodies ?? false}
                      hint={t('boolean.keepBodiesHint')}
                      onChange={(keep) => setBooleanKeep(booleanFeature.id, 'bodies', keep)}
                    />
                  }
                />

                <PickableSection
                  title={t('boolean.tools')}
                  count={booleanToolRows.length}
                  picking={pickingBooleanTools === booleanFeature.id}
                  onTogglePicking={() =>
                    setPickingBooleanTools(
                      pickingBooleanTools === booleanFeature.id ? null : booleanFeature.id,
                    )
                  }
                  pickLabel={t('boolean.pickTools')}
                  finishLabel={t('extrude.finishPick')}
                  emptyHint={t('boolean.emptyTools')}
                  pickHint={t('boolean.pickToolsHint')}
                  removeLabel={t('extrude.removeObject')}
                  rows={booleanToolRows}
                  toggle={
                    <BooleanKeepToggle
                      keep={booleanFeature.keepTools ?? false}
                      hint={t('boolean.keepToolsHint')}
                      onChange={(keep) => setBooleanKeep(booleanFeature.id, 'tools', keep)}
                    />
                  }
                />
              </>
            )}

            {isPrimitive(feature) && (
              <>
                <PanelSection title={t('inspector.position')}>
                  <div className="dimension-row">
                    {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                      <ParamField
                        key={axis}
                        axis={axis}
                        allowNegative
                        label={`${t(`inspector.position${axis}` as never)} · mm`}
                        suffix="mm"
                        value={feature.transform.translation[index]!}
                        resolved={
                          resolvedFeature?.type === 'primitive'
                            ? resolvedFeature.transform.translation[index]!
                            : undefined
                        }
                        error={paramError(feature.id, `transform.translation.${index}`)}
                        onCommit={(value) =>
                          setFeatureParameter(feature.id, `transform.translation.${index}`, value)
                        }
                      />
                    ))}
                  </div>
                </PanelSection>
                <PanelSection title={t('inspector.size')}>
                  {primitiveSizeFields(feature)}
                </PanelSection>
              </>
            )}

            {feature.type !== 'extrude' && featureError && (
              <FormError message={translate(t, `errors.${featureError}`, featureError)} />
            )}
          </>
        ) : body ? (
          detailEdge ? (
            <PanelSection title={t('quick.operation')}>
              <p className="hint">{t('quick.edgeHint')}</p>
            </PanelSection>
          ) : detailFace ? (
            <PanelSection title={t('quick.operation')}>
              {quickExtrude ? (
                <>
                  <StatRow
                    label={t('extrude.operation')}
                    value={t(`extrude.op_${quickExtrude.op}` as never)}
                  />
                  <StatRow
                    label={t('extrude.distance')}
                    value={`${formatNumber(quickExtrudeResolved?.distance ?? 0, locale)} mm`}
                  />
                  <Button onClick={() => select({ kind: 'feature', id: quickExtrude.id })}>
                    {t('quick.editOperation')}
                  </Button>
                </>
              ) : detailPlanar ? (
                <p className="hint">{t('quick.noOperation', { kind: t('quick.body') })}</p>
              ) : (
                <p className="hint">{t('quick.curvedFace')}</p>
              )}
            </PanelSection>
          ) : null
        ) : (
          <>
            <div className="inspector-field">
              <TextField label={t('inspector.name')} value={project.name} onCommit={renameModel} />
            </div>
            <PanelSection title={t('inspector.properties')} divided>
              <StatRow label={t('inspector.features')} value={project.features.length} />
              <StatRow
                label={t('inspector.bodies')}
                value={solidBodiesInHistory(project, consumedBodies).length}
              />
              <StatRow
                label={t('inspector.meshes')}
                value={
                  bodiesInHistory(project, consumedBodies).filter((body) => body.kind === 'mesh')
                    .length
                }
              />
              {project.historyEnd && <p className="hint">{t('inspector.rolledBack')}</p>}
            </PanelSection>
            <VariablesSection modelId={project.id} />
            <header className="panel-header panel-context-header">
              <span>{t('inspector.project')}</span>
            </header>
            <div className="inspector-field">
              <TextField label={t('inspector.name')} value={projectName} onCommit={renameProject} />
            </div>
            <PanelSection title={t('inspector.properties')} divided>
              <StatRow label={t('inspector.units')} value={projectUnits} />
            </PanelSection>
            <VariablesSection />
          </>
        )}

        {!feature && body && (
          <PanelSection title={t('inspector.metrics')} divided>
            {importedStats ? (
              <>
                <StatRow
                  label={t('inspector.triangles')}
                  value={formatNumber(importedStats.triangleCount, locale, 0)}
                />
                <StatRow
                  label={t('inspector.vertices')}
                  value={formatNumber(importedStats.vertexCount, locale, 0)}
                />
                <StatRow
                  label={t('inspector.watertight')}
                  value={importedStats.watertight ? t('common.yes') : t('common.no')}
                />
                <StatRow
                  label={t('inspector.volume')}
                  value={`${formatNumber(importedStats.volume, locale, 1)} mm³`}
                />
                <StatRow
                  label={t('inspector.surfaceArea')}
                  value={`${formatNumber(importedStats.surfaceArea, locale, 1)} mm²`}
                />
                <StatRow
                  label={t('inspector.components')}
                  value={formatNumber(importedStats.componentCount, locale, 0)}
                />
                <StatRow label={t('inspector.bounds')} value={boundsOf(mesh)} />
              </>
            ) : (
              <>
                <StatRow label={t('inspector.faces')} value={stats?.faces ?? '—'} />
                <StatRow label={t('inspector.edges')} value={stats?.edges ?? '—'} />
                <StatRow
                  label={t('inspector.triangles')}
                  value={mesh ? formatNumber(mesh.triangleCount, locale, 0) : '—'}
                />
                <StatRow
                  label={t('inspector.vertices')}
                  value={mesh ? formatNumber(mesh.vertexCount, locale, 0) : '—'}
                />
                <StatRow label={t('inspector.bounds')} value={boundsOf(mesh)} />
              </>
            )}
          </PanelSection>
        )}
      </div>
    </div>
  );
}
