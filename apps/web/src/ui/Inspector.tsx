import { sketchTopology, tessellateEntity } from '@icancad/sketch';
import {
  bodiesInHistory,
  featureBodyId,
  objectName,
  objectVisible,
  resolveBody,
  sketchObjectId,
  type Feature,
  type PrimitiveFeature,
  type SketchEntity,
  type SketchFeature,
} from '@icancad/model';
import { Box, MoveVertical } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocumentStore } from '../stores/documentStore';
import { useKernelStore } from '../stores/kernelStore';
import { useUiStore } from '../stores/uiStore';
import { DimensionField, PanelSection, StatRow, TextField } from './Controls';
import { formatNumber } from './format';
import { useContextMenuStore } from './ContextMenu';
import { SectionPanel } from './SectionPanel';
import { referenceMenuItems } from '../sketch/referenceMenu';
import { measureInfo, measuresForEntity } from '../sketch/measure';
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
  kind: 'body' | 'feature' | 'sketch';
  name: string;
  bodyId: string | null;
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
                  {referenceSummary(feature, entity.id, locale) ??
                    sketchEntityMeta(entity, locale)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </PanelSection>
  );
}

export function Inspector() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
  const selection = useDocumentStore((state) => state.selection);
  const project = useDocumentStore((state) => state.project);
  const apply = useDocumentStore((state) => state.apply);
  const renameProject = useDocumentStore((state) => state.renameProject);
  const meshes = useKernelStore((state) => state.meshes);
  const shapeStats = useKernelStore((state) => state.shapeStats);
  const meshStats = useKernelStore((state) => state.meshStats);
  const featureErrors = useKernelStore((state) => state.featureErrors);
  const activeSketchId = useUiStore((state) => state.activeSketchId);

  const feature =
    selection.length === 1 && selection[0]?.kind === 'feature'
      ? project.features.find((candidate) => candidate.id === selection[0]?.id)
      : undefined;
  const bodyRef =
    selection.length === 1 && selection[0]?.kind === 'body'
      ? project.bodies.find((candidate) => candidate.id === selection[0]?.id)
      : undefined;
  const body = bodyRef ? resolveBody(project, bodyRef) : undefined;
  // A sketch is an object of its own: the tree selects the object, the timeline
  // chip selects the operation that created it.
  const sketchObject =
    selection.length === 1 && selection[0]?.kind === 'sketch'
      ? project.features.find(
          (candidate): candidate is SketchFeature =>
            candidate.id === selection[0]?.id && candidate.type === 'sketch',
        )
      : undefined;

  const sketchGeometry = sketchObject ? sketchTopology(sketchObject.entities) : undefined;
  const sketchOffset =
    feature?.type === 'sketch' && feature.plane.type === 'datum' ? feature.plane.offset : 0;
  const selectedBodyId = body?.id ?? (feature ? featureBodyId(feature.id) : null);
  const mesh = selectedBodyId ? meshes[selectedBodyId] : undefined;
  const statsFeatureId = feature?.id ?? body?.createdBy;
  const stats = statsFeatureId ? shapeStats[statsFeatureId] : undefined;
  const importedStats = statsFeatureId ? meshStats[statsFeatureId] : undefined;
  const featureError = feature
    ? featureErrors[feature.id]
    : body
      ? featureErrors[body.createdBy]
      : undefined;
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
    <div className="panel">
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
                      <Box size={14} />
                    </span>
                    <span className="tree-name">{item.name}</span>
                    <span className="tree-meta">
                      {item.kind === 'body'
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
                value={objectName(project, sketchObjectId(sketchObject.id), sketchObject.name)}
                onCommit={(name) => renameObject(sketchObjectId(sketchObject.id), name)}
              />
              <StatRow
                label={t('inspector.visibility')}
                value={objectVisible(project, sketchObjectId(sketchObject.id)) ? '✓' : '—'}
              />
            </PanelSection>

            {sketchGeometry.faces.length > 0 && (
              <PanelSection title={t('inspector.faces')} count={sketchGeometry.faces.length}>
                <div className="selection-list">
                  {sketchGeometry.faces.map((face, index) => (
                    <div key={face.id} className="selection-item">
                      <span className="tree-name">{t('sketch.face', { index: index + 1 })}</span>
                      <span className="tree-meta">
                        {formatNumber(face.area, locale, 1)} mm²
                      </span>
                    </div>
                  ))}
                </div>
              </PanelSection>
            )}

            <PanelSection title={t('inspector.edges')} count={sketchGeometry.edges.length}>
              {sketchGeometry.edges.length === 0 ? (
                <p className="hint">{t('sketch.noGeometry')}</p>
              ) : (
                <div className="selection-list">
                  {sketchGeometry.edges.map((edge, index) => (
                    <div key={edge.id} className="selection-item">
                      <span className="tree-name">{t('sketch.edge', { index: index + 1 })}</span>
                      <span className="tree-meta">
                        {formatNumber(edge.length, locale, 1)} mm
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </PanelSection>

            {sketchGeometry.points.length > 0 && (
              <PanelSection title={t('inspector.points')} count={sketchGeometry.points.length}>
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
                {translate(t, `errors.${featureErrors[sketchObject.id]}`, featureErrors[sketchObject.id])}
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
              <StatRow
                label={t('inspector.createdBy')}
                value={
                  feature.type === 'primitive'
                    ? t('features.box')
                    : feature.type === 'import-mesh'
                      ? t('features.importMesh')
                      : feature.type === 'sketch'
                        ? t('features.sketch')
                        : feature.type
                }
              />
            </PanelSection>

            {feature.type === 'sketch' && (
              <PanelSection title={t('sketch.placement')}>
                <div className="sketch-plane-row">
                  <div className="plane-select" role="group" aria-label={t('sketch.plane')}>
                    {(['XY', 'XZ', 'YZ'] as const).map((plane) => (
                      <button
                        key={plane}
                        type="button"
                        data-active={
                          feature.plane.type === 'datum' && feature.plane.plane === plane
                            ? 'true'
                            : undefined
                        }
                        onClick={() =>
                          apply({
                            type: 'feature/replace',
                            feature: {
                              ...feature,
                              plane: { type: 'datum', plane, offset: sketchOffset },
                            },
                          })
                        }
                      >
                        {plane}
                      </button>
                    ))}
                  </div>
                  <SketchOffsetField
                    label={t('sketch.offset')}
                    value={sketchOffset}
                    unit="mm"
                    onCommit={(offset) =>
                      apply({
                        type: 'feature/replace',
                        feature: {
                          ...feature,
                          plane: {
                            type: 'datum',
                            plane: feature.plane.type === 'datum' ? feature.plane.plane : 'XY',
                            offset,
                          },
                        },
                      })
                    }
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

            {featureError && (
              <div className="error-box">
                {translate(t, `errors.${featureError}`, featureError)}
              </div>
            )}
          </>
        ) : body ? (
          <PanelSection title={t('inspector.selection')}>
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
            <StatRow label={t('inspector.bodies')} value={bodiesInHistory(project).length} />
            {project.historyEnd && <p className="hint">{t('inspector.rolledBack')}</p>}
          </PanelSection>
        )}

        {((feature && feature.type !== 'sketch') || body) && (
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
