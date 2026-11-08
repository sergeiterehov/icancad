import { featureBodyId, type BodyMeta, type Feature, type PrimitiveFeature } from '@icancad/model';
import { Box } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDocumentStore } from '../stores/documentStore';
import { useKernelStore } from '../stores/kernelStore';
import { DimensionField, PanelSection, StatRow, TextField } from './Controls';
import { formatNumber } from './format';
import { SectionPanel } from './SectionPanel';
import { translate } from './translate';

function isPrimitive(feature: Feature | undefined): feature is PrimitiveFeature {
  return feature?.type === 'primitive';
}

interface ResolvedItem {
  key: string;
  kind: 'body' | 'feature';
  name: string;
  bodyId: string | null;
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
  const featureErrors = useKernelStore((state) => state.featureErrors);

  const feature =
    selection.length === 1 && selection[0]?.kind === 'feature'
      ? project.features.find((candidate) => candidate.id === selection[0]?.id)
      : undefined;
  const body =
    selection.length === 1 && selection[0]?.kind === 'body'
      ? project.bodies.find((candidate) => candidate.id === selection[0]?.id)
      : undefined;

  const selectedBodyId = body?.id ?? (feature ? featureBodyId(feature.id) : null);
  const mesh = selectedBodyId ? meshes[selectedBodyId] : undefined;
  const statsFeatureId = feature?.id ?? body?.createdBy;
  const stats = statsFeatureId ? shapeStats[statsFeatureId] : undefined;
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

  const updateBody = (current: BodyMeta, name: string) => {
    apply({ type: 'body/update', bodyId: current.id, patch: { name } });
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
                    name: match.name,
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
                    bodyId: featureBodyId(match.id),
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
                      {item.kind === 'body' ? t('inspector.body') : t('inspector.operation')}
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
                      : feature.type
                }
              />
            </PanelSection>

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
              onCommit={(name) => updateBody(body, name)}
            />
            <StatRow label={t('inspector.visibility')} value={body.visible ? '✓' : '—'} />
          </PanelSection>
        ) : (
          <PanelSection title={t('inspector.project')}>
            <TextField label={t('inspector.name')} value={project.name} onCommit={renameProject} />
            <StatRow label={t('inspector.units')} value={project.units} />
            <StatRow label={t('inspector.features')} value={project.features.length} />
            <StatRow label={t('inspector.bodies')} value={project.bodies.length} />
            {project.historyEnd && <p className="hint">{t('inspector.rolledBack')}</p>}
          </PanelSection>
        )}

        {(feature || body) && (
          <PanelSection title={t('inspector.statistics')}>
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
          </PanelSection>
        )}
      </div>
    </div>
  );
}
