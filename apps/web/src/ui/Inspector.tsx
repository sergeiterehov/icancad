import type { TessellationResult } from '@icancad/kernel';
import { sketchTopology, tessellateEntity } from '@icancad/sketch';
import {
  bodiesInHistory,
  featureBodyId,
  objectName,
  objectVisible,
  resolveBody,
  sketchObjectId,
  solidBodiesInHistory,
  type Feature,
  type PrimitiveFeature,
  type SketchEntity,
  type ExtrudeFeature,
  type SketchFeature,
} from '@icancad/model';
import {
  AlertCircle,
  ArrowLeftRight,
  ArrowUp,
  Box,
  Check,
  ChevronsUpDown,
  Hexagon,
  Infinity as InfinityIcon,
  MoveVertical,
  PawPrint,
  PencilRuler,
  Pencil,
  Spline,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  bodyFaceKey,
  sketchFaceKey,
  useDocumentStore,
} from '../stores/documentStore';
import { useKernelStore } from '../stores/kernelStore';
import { useUiStore } from '../stores/uiStore';
import {
  DimensionField,
  IconButton,
  ObjectPickerField,
  PanelSection,
  Segmented,
  SegmentedTab,
  StatRow,
  Switch,
  TextField,
} from './Controls';
import { formatNumber } from './format';
import { useContextMenuStore } from './ContextMenu';
import { ExtrudeOpIcon, PointIcon } from './featureIcons';
import { SectionPanel } from './SectionPanel';
import { referenceMenuItems } from '../sketch/referenceMenu';
import { measureInfo, measuresForEntity } from '../sketch/measure';
import { sketchPlaneReady } from '../sketch/sectionPlane';
import { SketchConstraints } from './SketchConstraints';
import { Tooltip } from './Tooltip';
import { translate } from './translate';

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
    case 'bezier':
      return t('sketch.entityBezier');
  }
}

function ErrorBadge({ message }: { message: string }) {
  return (
    <Tooltip content={message} delay={150} className="error-badge">
      <AlertCircle size={13} aria-label={message} />
    </Tooltip>
  );
}

interface PickableRow {
  key: string;
  icon: ReactNode;
  name: string;
  meta?: ReactNode;
  error?: string;
  active?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
}

// A list that is read-only until its pencil button starts picking. The same
// shell serves picked faces and picked target bodies.
function PickableSection({
  title,
  count,
  picking,
  onTogglePicking,
  pickLabel,
  finishLabel,
  hint,
  emptyHint,
  pickHint,
  removeLabel,
  rows,
}: {
  title: string;
  count?: number;
  picking: boolean;
  onTogglePicking: () => void;
  pickLabel: string;
  finishLabel: string;
  hint?: string;
  emptyHint: string;
  pickHint: string;
  removeLabel: string;
  rows: PickableRow[];
}) {
  const actionLabel = picking ? finishLabel : pickLabel;
  return (
    <PanelSection
      title={title}
      count={count}
      action={
        <IconButton
          label={actionLabel}
          tooltip={actionLabel}
          active={picking}
          onClick={onTogglePicking}
        >
          {picking ? <Check size={14} /> : <Pencil size={14} />}
        </IconButton>
      }
    >
      {hint && <p className="panel-hint">{hint}</p>}
      {rows.length === 0 ? (
        !hint && <p className="panel-hint">{picking ? pickHint : emptyHint}</p>
      ) : (
        <div className="selection-list">
          {rows.map((row) => {
            const content = (
              <>
                <span className="tree-icon">{row.icon}</span>
                <span className="tree-name">{row.name}</span>
                <span className="tree-meta">
                  {row.meta}
                  {row.error && <ErrorBadge message={row.error} />}
                </span>
                {picking && row.onRemove && (
                  <IconButton
                    label={removeLabel}
                    tooltip={removeLabel}
                    onClick={row.onRemove}
                  >
                    <X size={13} />
                  </IconButton>
                )}
              </>
            );
            const className = 'selection-item';
            const active = row.active ? 'true' : undefined;
            const error = row.error ? 'true' : undefined;
            if (picking && row.onClick) {
              return (
                <button
                  key={row.key}
                  type="button"
                  className={className}
                  data-active={active}
                  data-error={error}
                  onClick={row.onClick}
                >
                  {content}
                </button>
              );
            }
            return (
              <div key={row.key} className={className} data-active={active} data-error={error}>
                {content}
              </div>
            );
          })}
        </div>
      )}
    </PanelSection>
  );
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
    case 'bezier':
      return `${entity.points.length}`;
  }
}

function SketchOffsetField({
  label,
  value,
  unit,
  onCommit,
}: {
  label: string;
  value: number;
  unit: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed !== value) onCommit(parsed);
    else setDraft(String(value));
  };

  return (
    <Tooltip content={label}>
      <label className="sketch-offset-field">
        <MoveVertical size={13} />
        <input
          className="sketch-offset-input"
          inputMode="decimal"
          aria-label={label}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setDraft(String(value));
              event.currentTarget.blur();
            }
          }}
        />
        <span className="sketch-offset-unit">{unit}</span>
      </label>
    </Tooltip>
  );
}

function referenceSummary(feature: SketchFeature, entityId: string, locale: string): string | null {
  const entity = feature.entities.find((candidate) => candidate.id === entityId);
  if (!entity) return null;
  const values: string[] = [];
  for (const reference of feature.references ?? []) {
    if (reference.entityId !== entityId) continue;
    const info = measureInfo(entity, reference.measure, locale, 'mm');
    if (info) values.push(info.text);
  }
  if (values.length === 0) return null;
  if (measuresForEntity(entity).length === 0) return null;
  return values.join(' · ');
}

function isPrimitive(feature: Feature | undefined): feature is PrimitiveFeature {
  return feature?.type === 'primitive';
}

interface ResolvedItem {
  key: string;
  kind: 'body' | 'mesh' | 'feature' | 'sketch';
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

const EXTRUDE_ENDS = [
  { id: 'blind' as const, label: 'extrude.end_blind', icon: <ArrowUp size={12} /> },
  { id: 'symmetric' as const, label: 'extrude.end_symmetric', icon: <ChevronsUpDown size={12} /> },
  {
    id: 'through-all' as const,
    label: 'extrude.end_through_all',
    icon: <InfinityIcon size={12} />,
  },
];

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

function sketchExtent(feature: SketchFeature, locale: string): string {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const entity of feature.entities) {
    if (entity.construction) continue;
    for (const [x, y] of tessellateEntity(entity)) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) return '—';
  return `${formatNumber(maxX - minX, locale, 1)} × ${formatNumber(maxY - minY, locale, 1)} mm`;
}

function SketchComposition({ feature }: { feature: SketchFeature }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
  const apply = useDocumentStore((state) => state.apply);
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const sketchSelectionIds = useUiStore((state) => state.sketchSelectionIds);
  const sketchConstraintId = useUiStore((state) => state.sketchConstraintId);
  const setSketchSelection = useUiStore((state) => state.setSketchSelection);
  const openMenu = useContextMenuStore((state) => state.open);

  const activeConstraint = feature.constraints.find(
    (constraint) => constraint.id === sketchConstraintId,
  );
  const selectedEntityIds = new Set(
    sketchSelectionIds.map((key) => key.split('#')[0]).filter((id): id is string => Boolean(id)),
  );
  const constraintEntityIds = new Set(activeConstraint?.refs.map((ref) => ref.entityId) ?? []);

  return (
    <PanelSection title={t('sketch.composition')} count={feature.entities.length}>
      {feature.entities.length === 0 ? (
        <p className="hint">{t('sketch.empty')}</p>
      ) : (
        <div className="selection-list">
          {feature.entities.map((entity) => {
            const dimmed = activeConstraint !== undefined && !constraintEntityIds.has(entity.id);
            const active = selectedEntityIds.has(entity.id);
            return (
              <button
                key={entity.id}
                type="button"
                className="selection-item sketch-entity-row"
                data-active={active ? 'true' : undefined}
                data-dimmed={dimmed ? 'true' : undefined}
                data-construction={entity.construction ? 'true' : undefined}
                disabled={activeSketchId !== feature.id}
                onClick={(event) => {
                  const additive = event.metaKey || event.ctrlKey || event.shiftKey;
                  if (!additive) {
                    setSketchSelection([entity.id]);
                    return;
                  }
                  const current = sketchSelectionIds.filter((key) => !key.includes('#'));
                  setSketchSelection(
                    current.includes(entity.id)
                      ? current.filter((id) => id !== entity.id)
                      : [...current, entity.id],
                  );
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setSketchSelection([entity.id]);
                  openMenu(
                    event.clientX,
                    event.clientY,
                    referenceMenuItems(
                      feature,
                      entity.id,
                      (key) => t(key as never),
                      locale,
                      (next) => apply({ type: 'feature/replace', feature: next }),
                    ),
                  );
                }}
              >
                <span className="tree-name">
                  {sketchEntityLabel((key) => t(key as never), entity)}
                </span>
                <span className="tree-meta">
                  {referenceSummary(feature, entity.id, locale) ?? sketchEntityMeta(entity, locale)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </PanelSection>
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
  const project = useDocumentStore((state) => state.project);
  const apply = useDocumentStore((state) => state.apply);
  const renameProject = useDocumentStore((state) => state.renameProject);
  const select = useDocumentStore((state) => state.select);
  const setExtrudeOp = useDocumentStore((state) => state.setExtrudeOp);
  const setExtrudeInput = useDocumentStore((state) => state.setExtrudeInput);
  const toggleExtrudeFace = useDocumentStore((state) => state.toggleExtrudeFace);
  const toggleExtrudeBodyFace = useDocumentStore((state) => state.toggleExtrudeBodyFace);
  const toggleExtrudeBodyTarget = useDocumentStore((state) => state.toggleExtrudeBodyTarget);
  const setExtrudeReversed = useDocumentStore((state) => state.setExtrudeReversed);
  const picking = useUiStore((state) => state.pickingExtrude);
  const pickingBodies = useUiStore((state) => state.pickingExtrudeBodies);
  const pickingSketchPlane = useUiStore((state) => state.pickingSketchPlane);
  const setPickingExtrude = useUiStore((state) => state.setPickingExtrude);
  const setPickingExtrudeBodies = useUiStore((state) => state.setPickingExtrudeBodies);
  const setPickingSketchPlane = useUiStore((state) => state.setPickingSketchPlane);
  const meshes = useKernelStore((state) => state.meshes);
  const shapeStats = useKernelStore((state) => state.shapeStats);
  const meshStats = useKernelStore((state) => state.meshStats);
  const featureErrors = useKernelStore((state) => state.featureErrors);
  const featureBodyErrors = useKernelStore((state) => state.featureBodyErrors);
  const featureObjectErrors = useKernelStore((state) => state.featureObjectErrors);
  const activeSketchId = useUiStore((state) => state.activeSketchId);

  const feature =
    selection.length === 1 && selection[0]?.kind === 'feature'
      ? project.features.find((candidate) => candidate.id === selection[0]?.id)
      : undefined;
  const bodyRef =
    selection.length === 1 &&
    (selection[0]?.kind === 'body' || selection[0]?.kind === 'mesh')
      ? project.bodies.find((candidate) => candidate.id === selection[0]?.id)
      : undefined;
  const body = bodyRef ? resolveBody(project, bodyRef) : undefined;
  // A sketch is an object of its own: the tree selects the object, the timeline
  // chip selects the operation that created it.
  // Faces belong to their sketch, so selecting them keeps the object panel open.
  const selectedSketchId =
    selection.length === 1 && selection[0]?.kind === 'sketch'
      ? selection[0].id
      : selection.length > 0 && selection.every((item) => item.kind === 'face')
        ? selection[0]!.id.split('#')[0]
        : undefined;
  const sketchObject = selectedSketchId
    ? project.features.find(
        (candidate): candidate is SketchFeature =>
          candidate.id === selectedSketchId && candidate.type === 'sketch',
      )
    : undefined;

  const sketchGeometry = sketchObject ? sketchTopology(sketchObject.entities) : undefined;
  const sketchOffset =
    feature?.type === 'sketch'
      ? feature.plane.type === 'datum'
        ? feature.plane.offset
        : (feature.plane.offset ?? 0)
      : 0;
  // One operation can own several bodies, so an operation shows the bounds of
  // all of them together.
  const ownedBodies = feature
    ? project.bodies.filter((candidate) => candidate.createdBy === feature.id)
    : [];
  const ownedMeshes = ownedBodies
    .map((candidate) => meshes[candidate.id])
    .filter((candidate): candidate is TessellationResult => Boolean(candidate));
  const mesh = body
    ? meshes[body.id]
    : ownedMeshes.length > 0
      ? mergeBounds(ownedMeshes)
      : undefined;
  const statsKey = body?.id ?? feature?.id;
  const stats = statsKey ? shapeStats[statsKey] : undefined;
  const importedStats = statsKey ? meshStats[statsKey] : undefined;
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
      pickingSketchPlane &&
      (pickingSketchPlane !== feature?.id ||
        feature?.type !== 'sketch' ||
        feature.plane.type !== 'face')
    ) {
      setPickingSketchPlane(null);
    }
  }, [
    picking,
    pickingBodies,
    pickingSketchPlane,
    feature,
    setPickingExtrude,
    setPickingExtrudeBodies,
    setPickingSketchPlane,
  ]);

  useEffect(() => {
    if (!pickingSketchPlane) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickingSketchPlane(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pickingSketchPlane, setPickingSketchPlane]);

  const extrudeFeature = feature?.type === 'extrude' ? feature : undefined;
  const setExtrudeEnd = (featureId: string, end: ExtrudeFeature['end']) =>
    apply({ type: 'feature/replace', feature: { ...extrudeFeature!, id: featureId, end } });
  const setExtrudeDistance = (featureId: string, distance: number) =>
    apply({ type: 'feature/replace', feature: { ...extrudeFeature!, id: featureId, distance } });
  const setExtrudeSecondDirection = (
    featureId: string,
    secondDirection: ExtrudeFeature['secondDirection'],
  ) =>
    apply({
      type: 'feature/replace',
      feature: { ...extrudeFeature!, id: featureId, secondDirection },
    });

  // What an extrude works on: the whole sketch, or the faces picked from it.
  const targetErrors = extrudeFeature
    ? (featureBodyErrors[extrudeFeature.id] ?? {})
    : {};
  interface ExtrudeObject {
    key: string;
    kind: 'sketch' | 'face' | 'body-face';
    name: string;
    meta: string;
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
              name: index >= 0 ? t('sketch.face', { index: index + 1 }) : t('extrude.face'),
              meta: name,
              remove: () => toggleExtrudeFace(extrudeFeature.id, sketch.id, regionId),
            });
          }
        }
      }
    }
    for (const ref of extrudeFeature.faceRefs ?? []) {
      const owner = project.bodies.find((candidate) => candidate.id === ref.bodyId);
      const key = bodyFaceKey(ref.bodyId, ref.faceId);
      const error = targetErrors[ref.bodyId];
      entries.set(key, {
        key,
        kind: 'body-face',
        name: t('sketch.face', { index: Number(ref.faceId) + 1 }),
        meta: owner ? objectName(project, owner.id, 'Body') : ref.bodyId,
        ...(error ? { error } : {}),
        remove: () =>
          toggleExtrudeBodyFace(
            extrudeFeature.id,
            ref.bodyId,
            ref.faceId,
            ref.normal,
            ref.origin,
          ),
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
    ? bodiesInHistory(project).filter((body) => body.createdBy !== extrudeFeature.id)
    : [];
  const targetBodies = otherObjects.filter((body) => body.kind !== 'mesh');
  const meshTargets = extrudeFeature
    ? otherObjects.filter(
        (body) => body.kind === 'mesh' && extrudeFeature.bodyIds.includes(body.id),
      )
    : [];
  const unknownTargets = extrudeFeature
    ? extrudeFeature.bodyIds.filter(
        (bodyId) => !otherObjects.some((body) => body.id === bodyId),
      )
    : [];

  const objectErrors = extrudeFeature
    ? (featureObjectErrors[extrudeFeature.id] ?? {})
    : {};
  const faceRows: PickableRow[] = extrudeObjects.map((entry) => {
    const error = objectErrors[entry.key] ?? entry.error;
    return {
      key: entry.key,
      icon: entry.kind === 'sketch' ? <PencilRuler size={14} /> : <Hexagon size={14} />,
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

  const updatePrimitive = (patch: Partial<PrimitiveFeature['params']>) => {
    if (!isPrimitive(feature)) return;
    apply({
      type: 'feature/replace',
      feature: { ...feature, params: { ...feature.params, ...patch } },
    });
  };

  const renameObject = (objectId: string, name: string) => {
    apply({ type: 'metadata/patch', objectId, patch: { name } });
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

  return (
    <div className="panel" data-testid="inspector">
      <header className="panel-header">
        <span>{t('panels.inspector')}</span>
      </header>

      <div className="panel-body">
        <SectionPanel />
        {resolved.length > 0 ? (
          <>
            <PanelSection title={t('inspector.selection')} count={resolved.length}>
              <div className="selection-list">
                {resolved.map((item) => (
                  <div key={item.key} className="selection-item">
                    <span className="tree-icon">
                      {item.kind === 'mesh' ? <PawPrint size={14} /> : <Box size={14} />}
                    </span>
                    <span className="tree-name">{item.name}</span>
                    <span className="tree-meta">
                      {item.kind === 'mesh'
                        ? t('inspector.mesh')
                        : item.kind === 'body'
                          ? t('inspector.body')
                          : item.kind === 'sketch'
                            ? t('inspector.sketch')
                            : t('inspector.operation')}
                    </span>
                  </div>
                ))}
              </div>
            </PanelSection>

            <PanelSection title={t('inspector.statistics')}>
              <StatRow
                label={t('inspector.triangles')}
                value={formatNumber(multiTriangles, locale, 0)}
              />
              <StatRow label={t('inspector.bounds')} value={multiBounds} />
            </PanelSection>
          </>
        ) : sketchObject && sketchGeometry ? (
          <>
            <PanelSection title={t('inspector.selection')}>
              <TextField
                label={t('inspector.name')}
                value={sketchObject.name}
                onCommit={(name) =>
                  apply({ type: 'feature/replace', feature: { ...sketchObject, name } })
                }
              />
              <StatRow
                label={t('inspector.visibility')}
                value={objectVisible(project, sketchObjectId(sketchObject.id)) ? '✓' : '—'}
              />
            </PanelSection>

            {sketchGeometry.faces.length > 0 && (
              <PanelSection
                title={t('inspector.faces')}
                count={sketchGeometry.faces.length}
                icon={<Hexagon size={13} />}
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
                        onClick={(event) =>
                          select(
                            { kind: 'face', id: faceKey },
                            { additive: event.metaKey || event.ctrlKey || event.shiftKey },
                          )
                        }
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
            >
              {sketchGeometry.edges.length === 0 ? (
                <p className="hint">{t('sketch.noGeometry')}</p>
              ) : (
                <div className="selection-list">
                  {sketchGeometry.edges.map((edge, index) => (
                    <div key={edge.id} className="selection-item">
                      <span className="tree-name">{t('sketch.edge', { index: index + 1 })}</span>
                      <span className="tree-meta">{formatNumber(edge.length, locale, 1)} mm</span>
                    </div>
                  ))}
                </div>
              )}
            </PanelSection>

            {sketchGeometry.points.length > 0 && (
              <PanelSection
                title={t('inspector.points')}
                count={sketchGeometry.points.length}
                icon={<PointIcon size={13} />}
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

            <PanelSection title={t('inspector.statistics')}>
              <StatRow label={t('inspector.bounds')} value={sketchExtent(sketchObject, locale)} />
            </PanelSection>

            {featureErrors[sketchObject.id] && (
              <div className="error-box">
                {translate(
                  t,
                  `errors.${featureErrors[sketchObject.id]}`,
                  featureErrors[sketchObject.id],
                )}
              </div>
            )}
          </>
        ) : feature ? (
          <>
            <PanelSection title={t('inspector.selection')}>
              <TextField
                label={t('inspector.name')}
                value={feature.name}
                onCommit={(name) =>
                  apply({ type: 'feature/replace', feature: { ...feature, name } })
                }
              />
            </PanelSection>

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
                                plane: { type: 'datum', plane, offset: sketchOffset },
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
                              plane: { type: 'face', offset: sketchOffset },
                            },
                          });
                        }}
                      />
                    </Segmented>
                    <SketchOffsetField
                      label={t('sketch.offset')}
                      value={sketchOffset}
                      unit="mm"
                      onCommit={(offset) =>
                        apply({
                          type: 'feature/replace',
                          feature: {
                            ...feature,
                            plane:
                              feature.plane.type === 'datum'
                                ? {
                                    type: 'datum',
                                    plane: feature.plane.plane,
                                    offset,
                                  }
                                : { ...feature.plane, offset },
                          },
                        })
                      }
                    />
                  </div>
                  {feature.plane.type === 'face' && (
                    <ObjectPickerField
                      label={t('sketch.planeFace')}
                      value={
                        sketchPlaneReady(feature)
                          ? t('sketch.face', {
                              index: Number(feature.plane.topoId) + 1,
                            })
                          : undefined
                      }
                      placeholder={t('sketch.selectFace')}
                      icon={<Hexagon size={14} />}
                      active={pickingSketchPlane === feature.id}
                      invalid={!sketchPlaneReady(feature) || Boolean(featureErrors[feature.id])}
                      onClick={() =>
                        setPickingSketchPlane(
                          pickingSketchPlane === feature.id ? null : feature.id,
                        )
                      }
                      testId="sketch-face-picker"
                    />
                  )}
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
                    <Segmented ariaLabel={t('extrude.end')}>
                      {EXTRUDE_ENDS.filter(
                        (end) => end.id !== 'through-all' || throughAllAllowed(feature.op),
                      ).map((end) => (
                        <SegmentedTab
                          key={end.id}
                          label={t(end.label as never)}
                          icon={end.icon}
                          active={feature.end === end.id}
                          onClick={() => setExtrudeEnd(feature.id, end.id)}
                        />
                      ))}
                    </Segmented>
                    <div className="dimension-row">
                      {feature.end !== 'through-all' && (
                        <DimensionField
                          axis="↑"
                          label={t('extrude.distance')}
                          suffix="mm"
                          value={feature.distance}
                          onCommit={(distance) => setExtrudeDistance(feature.id, distance)}
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
                </PanelSection>

                {feature.end !== 'symmetric' && (
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
                              ? { end: 'blind', distance: Math.abs(feature.distance) }
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
                            <DimensionField
                              axis="↓"
                              label={t('extrude.distance')}
                              suffix="mm"
                              value={feature.secondDirection.distance}
                              onCommit={(distance) =>
                                setExtrudeSecondDirection(feature.id, {
                                  end: feature.secondDirection?.end ?? 'blind',
                                  distance,
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
                  <PanelSection title={t('inspector.operationError')} className="operation-error">
                    <p className="operation-error-text">
                      {translate(t, `errors.${featureError}`, featureError)}
                    </p>
                  </PanelSection>
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
                    hint={
                      feature.bodyIds.length === 0 ? t('extrude.allBodiesHint') : undefined
                    }
                    emptyHint={t('extrude.allBodiesHint')}
                    pickHint={t('extrude.pickBodiesHint')}
                    removeLabel={t('extrude.removeObject')}
                    rows={bodyRows}
                  />
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

            {isPrimitive(feature) && (
              <PanelSection title={t('inspector.size')}>
                <div className="dimension-row">
                  <DimensionField
                    axis="X"
                    label={`${t('inspector.width')} · mm`}
                    suffix="mm"
                    value={feature.params.dx}
                    onCommit={(dx) => updatePrimitive({ dx })}
                  />
                  <DimensionField
                    axis="Y"
                    label={`${t('inspector.height')} · mm`}
                    suffix="mm"
                    value={feature.params.dy}
                    onCommit={(dy) => updatePrimitive({ dy })}
                  />
                  <DimensionField
                    axis="Z"
                    label={`${t('inspector.depth')} · mm`}
                    suffix="mm"
                    value={feature.params.dz}
                    onCommit={(dz) => updatePrimitive({ dz })}
                  />
                </div>
              </PanelSection>
            )}

            {feature.type !== 'extrude' && featureError && (
              <div className="error-box">
                {translate(t, `errors.${featureError}`, featureError)}
              </div>
            )}
          </>
        ) : body ? (
          <PanelSection
            title={body.kind === 'mesh' ? t('inspector.mesh') : t('inspector.selection')}
          >
            <TextField
              label={t('inspector.name')}
              value={body.name}
              onCommit={(name) => renameObject(body.id, name)}
            />
            <StatRow label={t('inspector.visibility')} value={body.visible ? '✓' : '—'} />
          </PanelSection>
        ) : (
          <PanelSection title={t('inspector.project')}>
            <TextField label={t('inspector.name')} value={project.name} onCommit={renameProject} />
            <StatRow label={t('inspector.units')} value={project.units} />
            <StatRow label={t('inspector.features')} value={project.features.length} />
            <StatRow label={t('inspector.bodies')} value={solidBodiesInHistory(project).length} />
            <StatRow
              label={t('inspector.meshes')}
              value={bodiesInHistory(project).filter((body) => body.kind === 'mesh').length}
            />
            {project.historyEnd && <p className="hint">{t('inspector.rolledBack')}</p>}
          </PanelSection>
        )}

        {((feature && feature.type !== 'sketch' && feature.type !== 'extrude') || body) && (
          <PanelSection title={t('inspector.statistics')}>
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
