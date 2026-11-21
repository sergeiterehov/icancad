import type { ExpressionDiagnostic } from '@icancad/formula';
import { activeModel, resolveBody, type ParamValue, type TransformFeature } from '@icancad/model';
import { Box, Scaling } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useResolvedFeature } from '../hooks/useResolvedFeature';
import { scaleFactor, scalePercent } from '../quick/transform';
import { useDocumentStore } from '../stores/documentStore';
import { useFormulaStore } from '../stores/formulaStore';
import { useKernelStore } from '../stores/kernelStore';
import { useUiStore } from '../stores/uiStore';
import { PanelSection, ParamField } from './Controls';
import { SketchIcon } from './featureIcons';
import { formulaMessage } from './formulaMessage';
import { PickableSection, type PickableRow } from './PickableSection';
import { translate } from './translate';

const AXES = ['X', 'Y', 'Z'] as const;
/** Shared empty maps, so a selector without an entry stays reference-stable. */
const NO_ERRORS: Record<string, string> = {};
const NO_FORMULA_ERRORS: Record<string, Record<string, ExpressionDiagnostic>> = {};
const AXIS_INDEX = [0, 1, 2] as const;

/** The percentage the field shows for a parameter that stores a factor. */
function percentOf(value: ParamValue): ParamValue {
  return typeof value === 'number' ? scalePercent(value) : value;
}

/** A formula is authored in percent too, so it is divided on its way in. */
function factorOf(value: ParamValue): ParamValue {
  return typeof value === 'number' ? scaleFactor(value) : { formula: `(${value.formula}) / 100` };
}

/** Settings of the transform operation: what it moves, and by how much (ADR 0037). */
export function TransformSection({ feature }: { feature: TransformFeature }) {
  const { t } = useTranslation();
  const project = useDocumentStore((state) => state.project);
  const geometry = useResolvedFeature(feature);
  const toggleBody = useDocumentStore((state) => state.toggleTransformBody);
  const toggleSketch = useDocumentStore((state) => state.toggleTransformSketch);
  const setFeatureParameter = useDocumentStore((state) => state.setFeatureParameter);
  const picking = useUiStore((state) => state.pickingTransformTargets);
  const setPicking = useUiStore((state) => state.setPickingTransformTargets);
  const formulaErrors = useFormulaStore((state) => state.resolution?.errors) ?? NO_FORMULA_ERRORS;
  const bodyErrors = useKernelStore((state) => state.featureBodyErrors[feature.id]) ?? NO_ERRORS;
  const objectErrors =
    useKernelStore((state) => state.featureObjectErrors[feature.id]) ?? NO_ERRORS;
  const paramError = (path: string) => formulaMessage(t, formulaErrors[feature.id]?.[path]);

  // The picker belongs to one operation: selecting anything else ends it.
  useEffect(() => {
    if (picking && picking !== feature.id) setPicking(null);
  }, [picking, feature.id, setPicking]);

  useEffect(() => {
    if (picking !== feature.id) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') useUiStore.getState().endPicking();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [picking, feature.id]);

  const model = activeModel(project);
  const rows: PickableRow[] = [
    ...feature.bodyIds.map((bodyId): PickableRow => {
      const body = model.bodies.find((candidate) => candidate.id === bodyId);
      const resolved = body ? resolveBody(model, body) : undefined;
      const error = bodyErrors[bodyId] ?? (body ? undefined : 'UNKNOWN_BODY');
      return {
        key: bodyId,
        icon: resolved ? <Box size={14} style={{ color: resolved.color }} /> : <Box size={14} />,
        name: resolved?.name ?? bodyId,
        ...(error ? { error: translate(t, `errors.${error}`, error) } : {}),
        onRemove: () => toggleBody(feature.id, bodyId),
      };
    }),
    ...feature.sketchIds.map((sketchId): PickableRow => {
      const sketch = model.features.find((candidate) => candidate.id === sketchId);
      const error = objectErrors[`sketch:${sketchId}`] ?? (sketch ? undefined : 'UNKNOWN_FEATURE');
      return {
        key: sketchId,
        icon: <SketchIcon size={14} />,
        name: sketch?.name ?? sketchId,
        ...(error ? { error: translate(t, `errors.${error}`, error) } : {}),
        onRemove: () => toggleSketch(feature.id, sketchId),
      };
    }),
  ];

  return (
    <>
      <PanelSection title={t('transform.position')}>
        <div className="dimension-row">
          {AXES.map((axis, index) => (
            <ParamField
              key={axis}
              axis={axis}
              allowNegative
              label={`${t(`inspector.position${axis}` as never)} · mm`}
              tooltip={t('transform.positionHint')}
              suffix="mm"
              value={feature.transform.translation[index]!}
              resolved={geometry?.transform.translation[index]}
              error={paramError(`transform.translation.${index}`)}
              onCommit={(value) =>
                setFeatureParameter(feature.id, `transform.translation.${index}`, value)
              }
            />
          ))}
        </div>
      </PanelSection>

      <PanelSection title={t('transform.rotation')}>
        <div className="dimension-row">
          {AXIS_INDEX.map((index) => {
            const axis = AXES[index]!;
            return (
              <ParamField
                key={axis}
                axis={axis}
                allowNegative
                label={t('sketch.rotationAxis', { axis })}
                suffix="°"
                value={feature.transform.rotation[index]!}
                resolved={geometry?.transform.rotation[index]}
                error={paramError(`transform.rotation.${index}`)}
                onCommit={(value) =>
                  setFeatureParameter(feature.id, `transform.rotation.${index}`, value)
                }
              />
            );
          })}
        </div>
      </PanelSection>

      <PanelSection title={t('transform.scale')}>
        <div className="dimension-row">
          <ParamField
            icon={<Scaling size={13} />}
            label={t('transform.scale')}
            suffix="%"
            value={percentOf(feature.transform.scale)}
            resolved={geometry ? scalePercent(geometry.transform.scale) : undefined}
            error={paramError('transform.scale')}
            onCommit={(value) => setFeatureParameter(feature.id, 'transform.scale', factorOf(value))}
          />
        </div>
      </PanelSection>

      <PickableSection
        title={t('transform.targets')}
        count={rows.length}
        picking={picking === feature.id}
        onTogglePicking={() => setPicking(picking === feature.id ? null : feature.id)}
        pickLabel={t('transform.pickTargets')}
        finishLabel={t('extrude.finishPick')}
        emptyHint={t('transform.emptyTargets')}
        pickHint={t('transform.pickTargetsHint')}
        removeLabel={t('extrude.removeObject')}
        rows={rows}
      />

      {feature.sketchIds.length > 0 && <p className="panel-hint">{t('transform.sketchHint')}</p>}
    </>
  );
}
