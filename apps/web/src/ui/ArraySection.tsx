import {
  activeModel,
  resolveBody,
  type ArrayDirection,
  type ArrayFeature,
  type ArrayPath,
  type Model,
} from '@icancad/model';
import {
  ArrowLeftRight,
  ArrowRight,
  Box,
  Angle,
  Diff,
  Plus,
  RotateCw,
  Spline,
  X,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
import { rebuildScene } from '../kernel/rebuild';
import { pathKey, useDocumentStore } from '../stores/documentStore';
import { useKernelStore } from '../stores/kernelStore';
import { useUiStore } from '../stores/uiStore';
import {
  DimensionField,
  IconButton,
  ObjectPickerField,
  PanelSection,
  Segmented,
  SegmentedTab,
} from './Controls';
import { FeatureIcon } from './featureIcons';
import { PickableSection, type PickableRow } from './PickableSection';
import { Tooltip } from './Tooltip';

const AXES = ['x', 'y', 'z'] as const;

/** One picked path as a row: the edge of a body, or a curve of a sketch. */
function pathRow(path: ArrayPath, model: Model): PickableRow {
  if (path.kind === 'body-edge') {
    const body = model.bodies.find((candidate) => candidate.id === path.bodyId);
    const resolved = body ? resolveBody(model, body) : undefined;
    return {
      key: pathKey(path),
      icon: <Box size={14} style={{ color: resolved?.color }} />,
      name: resolved?.name ?? path.bodyId,
    };
  }
  const sketch = model.features.find(
    (candidate) => candidate.id === path.sketchId && candidate.type === 'sketch',
  );
  return {
    key: pathKey(path),
    icon: <Spline size={14} />,
    name: sketch?.name ?? path.sketchId,
  };
}

function directionIcon(kind: ArrayDirection['kind']) {
  switch (kind) {
    case 'linear':
      return <ArrowRight size={12} />;
    case 'rotation':
      return <RotateCw size={12} />;
    case 'path':
      return <Spline size={12} />;
  }
}

/**
 * Settings of the array operation: what is repeated, and the directions that
 * repeat it. Directions are listed in the order they apply, so the panel reads
 * like the nesting it produces (ADR 0029).
 */
export function ArraySection({ feature }: { feature: ArrayFeature }) {
  const { t } = useTranslation();
  const project = useDocumentStore((state) => state.project);
  const setArrayTarget = useDocumentStore((state) => state.setArrayTarget);
  const toggleArrayBody = useDocumentStore((state) => state.toggleArrayBody);
  const toggleArrayOperation = useDocumentStore((state) => state.toggleArrayOperation);
  const addArrayDirection = useDocumentStore((state) => state.addArrayDirection);
  const removeArrayDirection = useDocumentStore((state) => state.removeArrayDirection);
  const setArrayDirectionKind = useDocumentStore((state) => state.setArrayDirectionKind);
  const setArrayCount = useDocumentStore((state) => state.setArrayCount);
  const setArraySpacing = useDocumentStore((state) => state.setArraySpacing);
  const setArrayAngle = useDocumentStore((state) => state.setArrayAngle);
  const setArrayAxis = useDocumentStore((state) => state.setArrayAxis);
  const setArrayTilt = useDocumentStore((state) => state.setArrayTilt);
  const setArrayAxisArc = useDocumentStore((state) => state.setArrayAxisArc);
  const invertArrayDirection = useDocumentStore((state) => state.invertArrayDirection);
  const toggleArrayPath = useDocumentStore((state) => state.toggleArrayPath);
  const pickingBodies = useUiStore((state) => state.pickingArrayBodies);
  const pickingOperations = useUiStore((state) => state.pickingArrayOperations);
  const pickingArc = useUiStore((state) => state.pickingArrayArc);
  const pickingPath = useUiStore((state) => state.pickingArrayPath);
  const setPickingBodies = useUiStore((state) => state.setPickingArrayBodies);
  const setPickingOperations = useUiStore((state) => state.setPickingArrayOperations);
  const setPickingArc = useUiStore((state) => state.setPickingArrayArc);
  const setPickingPath = useUiStore((state) => state.setPickingArrayPath);
  const endPicking = useUiStore((state) => state.endPicking);
  const featureError = useKernelStore((state) => state.featureErrors[feature.id]);

  // Picking belongs to one operation: selecting anything else ends it.
  useEffect(() => {
    if (pickingBodies && pickingBodies !== feature.id) setPickingBodies(null);
    if (pickingOperations && pickingOperations !== feature.id) setPickingOperations(null);
    if (pickingArc && pickingArc.featureId !== feature.id) setPickingArc(null);
    if (pickingPath && pickingPath.featureId !== feature.id) setPickingPath(null);
  }, [
    pickingBodies,
    pickingOperations,
    pickingArc,
    pickingPath,
    feature.id,
    setPickingBodies,
    setPickingOperations,
    setPickingArc,
    setPickingPath,
  ]);

  // The volume the array repeats is measured once the picking ends, so the
  // copies appear without touching a setting. Picking itself stays cheap: the
  // selection changes are just a list, not a stamp.
  const wasPicking = useRef(Boolean(pickingBodies ?? pickingOperations));
  useEffect(() => {
    const picking = Boolean(pickingBodies ?? pickingOperations);
    if (wasPicking.current && !picking) {
      void rebuildScene(
        activeModel(useDocumentStore.getState().project),
        i18n.t('status.rebuild'),
      ).catch(() => undefined);
    }
    wasPicking.current = picking;
  }, [pickingBodies, pickingOperations]);

  useEffect(() => {
    const anyPicking = Boolean(
      pickingBodies ?? pickingOperations ?? pickingArc ?? pickingPath,
    );
    if (!anyPicking) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      endPicking();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pickingBodies, pickingOperations, pickingArc, pickingPath, endPicking]);

  const model = activeModel(project);

  const bodyRows: PickableRow[] = feature.bodyIds.map((bodyId) => {
    const body = model.bodies.find((candidate) => candidate.id === bodyId);
    const resolved = body ? resolveBody(model, body) : undefined;
    return {
      key: bodyId,
      icon: resolved ? <Box size={14} style={{ color: resolved.color }} /> : <Box size={14} />,
      name: resolved?.name ?? bodyId,
      onRemove: () => toggleArrayBody(feature.id, bodyId),
    };
  });

  const operationRows: PickableRow[] = feature.featureIds.map((operationId) => {
    const operation = model.features.find((candidate) => candidate.id === operationId);
    const bodies = model.bodies.filter((body) => body.createdBy === operationId).length;
    // Operations that make their own bodies are repeated as copies; the rest
    // are repeated by the material they add and remove.
    const createsBodies =
      operation?.type === 'primitive' ||
      (operation?.type === 'extrude' && operation.op === 'new') ||
      (operation?.type === 'shell' && operation.direction === 'outward');
    return {
      key: operationId,
      icon: operation ? <FeatureIcon feature={operation} size={14} /> : <Box size={14} />,
      name: operation?.name ?? t('array.missingOperation'),
      meta: operation
        ? createsBodies && bodies > 0
          ? t('array.copies', { count: bodies })
          : t('array.modifies')
        : operationId,
      onRemove: () => toggleArrayOperation(feature.id, operationId),
    };
  });

  return (
    <>
      <PanelSection title={t('array.repeat')}>
        <Segmented ariaLabel={t('array.repeat')}>
          <SegmentedTab
            label={t('array.geometry')}
            icon={<Diff size={12} />}
            active={feature.target === 'geometry'}
            onClick={() => {
              setPickingBodies(null);
              setPickingOperations(null);
              setArrayTarget(feature.id, 'geometry');
            }}
          />
          <SegmentedTab
            label={t('array.bodies')}
            icon={<Box size={12} />}
            active={feature.target === 'bodies'}
            onClick={() => {
              setPickingOperations(null);
              setPickingBodies(null);
              setArrayTarget(feature.id, 'bodies');
            }}
          />
        </Segmented>
      </PanelSection>

      {feature.target === 'geometry' ? (
        <PickableSection
          title={t('array.operations')}
          count={operationRows.length}
          picking={pickingOperations === feature.id}
          onTogglePicking={() =>
            setPickingOperations(pickingOperations === feature.id ? null : feature.id)
          }
          pickLabel={t('array.pickOperations')}
          finishLabel={t('extrude.finishPick')}
          emptyHint={t('array.emptyOperations')}
          pickHint={t('array.pickOperationsHint')}
          removeLabel={t('extrude.removeObject')}
          rows={operationRows}
        />
      ) : (
        <PickableSection
          title={t('array.targets')}
          count={bodyRows.length}
          picking={pickingBodies === feature.id}
          onTogglePicking={() => setPickingBodies(pickingBodies === feature.id ? null : feature.id)}
          pickLabel={t('array.pickBodies')}
          finishLabel={t('extrude.finishPick')}
          emptyHint={t('array.emptyBodies')}
          pickHint={t('array.pickBodiesHint')}
          removeLabel={t('extrude.removeObject')}
          rows={bodyRows}
        />
      )}

      <PanelSection
        title={t('array.directions')}
        count={feature.directions.length}
        divided
        action={
          <IconButton
            label={t('array.addDirection')}
            tooltip={
              <span className="tooltip-stack">
                <span>{t('array.addDirection')}</span>
                <span className="tooltip-hint">{t('array.multiHint')}</span>
              </span>
            }
            disabled={feature.directions.length >= 3}
            onClick={() => addArrayDirection(feature.id)}
          >
            <Plus size={14} />
          </IconButton>
        }
      >
        <div className="section-stack">
          {feature.directions.map((direction, index) => {
            const pickingArcFor =
              pickingArc?.featureId === feature.id && pickingArc.index === index;
            const pickingCurves =
              pickingPath?.featureId === feature.id && pickingPath.index === index;
            // A rotation turns around a world axis, offset by the radius the
            // copies ride at, until an arc of a sketch is picked: then it turns
            // around that arc's centre, inside the plane it is drawn in.
            const rotationAxis = direction.kind === 'rotation' ? direction.axis : null;
            const worldAxis =
              rotationAxis?.kind === 'world' ? rotationAxis.axis : null;
            const arcAxis = rotationAxis?.kind === 'arc' ? rotationAxis : null;
            const tilt = direction.kind === 'linear' ? (direction.angle ?? 0) : 0;
            const axisIndex =
              direction.kind === 'rotation'
                ? worldAxis
                  ? AXES.indexOf(worldAxis)
                  : -1
                : AXES.findIndex((_, position) => {
                    const value = direction.kind === 'linear' ? direction.direction[position] : 0;
                    return Math.abs(value ?? 0) > 0.5;
                  });
            const reversed =
              direction.kind === 'linear'
                ? axisIndex >= 0 && (direction.direction[axisIndex] ?? 0) < 0
                : direction.kind === 'rotation'
                  ? direction.inverted === true
                  : false;
            const arcSketch = arcAxis
              ? model.features.find(
                  (candidate) => candidate.id === arcAxis.sketchId && candidate.type === 'sketch',
                )
              : undefined;
            const curveRows =
              direction.kind === 'path' ? direction.paths.map((path) => pathRow(path, model)) : [];
            const brokenPath = featureError === 'ARRAY_PATH_BROKEN';
            return (
              <div className="array-direction" key={index}>
                <div className="array-direction-head">
                  <span className="field-label">{t('array.direction', { index: index + 1 })}</span>
                  <IconButton
                    label={t('array.removeDirection')}
                    tooltip={t('array.removeDirection')}
                    onClick={() => removeArrayDirection(feature.id, index)}
                  >
                    <X size={13} />
                  </IconButton>
                </div>
                <Segmented ariaLabel={t('array.direction', { index: index + 1 })}>
                  {(['linear', 'rotation', 'path'] as const).map((kind) => (
                    <SegmentedTab
                      key={kind}
                      label={t(`array.${kind}` as never)}
                      icon={directionIcon(kind)}
                      active={direction.kind === kind}
                      onClick={() => setArrayDirectionKind(feature.id, index, kind)}
                    />
                  ))}
                </Segmented>

                <div className="dimension-row">
                  <DimensionField
                    axis="N"
                    label={t('array.count')}
                    value={direction.count}
                    onCommit={(count) => setArrayCount(feature.id, index, count)}
                  />
                  {direction.kind === 'linear' && (
                    <DimensionField
                      icon={<ArrowRight size={13} />}
                      label={t('array.spacing')}
                      suffix="mm"
                      allowNegative
                      value={direction.spacing}
                      onCommit={(spacing) => setArraySpacing(feature.id, index, spacing)}
                    />
                  )}
                  {direction.kind === 'rotation' && (
                    // The span is a number between 0 and 360: which way the
                    // copies turn is the switch next to it, never a minus sign.
                    <DimensionField
                      icon={<RotateCw size={13} />}
                      label={t('array.angle')}
                      tooltip={t('array.angleHint')}
                      suffix="°"
                      allowNegative={false}
                      value={direction.angle}
                      onCommit={(angle) => setArrayAngle(feature.id, index, angle)}
                    />
                  )}
                  {/* Turning the array around is turning its step around: the
                      switch belongs to the step, not to the axis. */}
                  {direction.kind !== 'path' && (
                    <IconButton
                      label={t('array.reverse')}
                      tooltip={t('array.reverse')}
                      active={reversed}
                      onClick={() => invertArrayDirection(feature.id, index)}
                    >
                      <ArrowLeftRight size={14} />
                    </IconButton>
                  )}
                </div>

                {direction.kind !== 'path' && (
                  <div className="control-group">
                    <span className="field-label">{t('array.axis')}</span>
                    {/* The axis and the one setting that belongs to it share a
                        row: the axis needs no value, the setting needs no
                        heading of its own (ADR 0029). */}
                    <div className="array-axis-row">
                      <Segmented ariaLabel={t('array.axis')} compact>
                        {AXES.map((axis, position) => (
                          <SegmentedTab
                            key={axis}
                            square
                            label={axis.toUpperCase()}
                            active={
                              direction.kind === 'rotation'
                                ? // While an arc is being picked the tabs stand
                                  // aside: only one axis is the choice at a
                                  // time.
                                  !pickingArcFor && worldAxis !== null && axisIndex === position
                                : axisIndex === position
                            }
                            onClick={() => {
                              setPickingArc(null);
                              setArrayAxis(feature.id, index, axis);
                            }}
                          />
                        ))}
                        {direction.kind === 'rotation' && (
                          <SegmentedTab
                            label={t('array.arc')}
                            active={Boolean(arcAxis) || pickingArcFor}
                            onClick={() =>
                              setPickingArc(
                                pickingArcFor ? null : { featureId: feature.id, index },
                              )
                            }
                          />
                        )}
                      </Segmented>

                      {direction.kind === 'linear' && (
                        <DimensionField
                          icon={<Angle size={13} />}
                          label={t('array.tilt')}
                          tooltip={t('array.tiltHint')}
                          suffix="°"
                          value={tilt}
                          onCommit={(next) => setArrayTilt(feature.id, index, next)}
                        />
                      )}

                      {direction.kind === 'rotation' && (arcAxis || pickingArcFor) && (
                        <Tooltip content={t('array.arcHint')}>
                          <ObjectPickerField
                            compact
                            label={t('array.arc')}
                            value={
                              arcSketch
                                ? t('array.arcOfSketch', { sketch: arcSketch.name })
                                : undefined
                            }
                            placeholder={t('array.pickArc')}
                            icon={<Spline size={13} />}
                            active={pickingArcFor}
                            onClick={() =>
                              setPickingArc(
                                pickingArcFor ? null : { featureId: feature.id, index },
                              )
                            }
                            onClear={() => setArrayAxisArc(feature.id, index, null)}
                            clearLabel={t('common.clear')}
                          />
                        </Tooltip>
                      )}
                    </div>
                  </div>
                )}

                {direction.kind === 'path' && (
                  <PickableSection
                    title={t('array.curves')}
                    count={direction.paths.length}
                    // The curves belong to the direction above them: no rule
                    // cutting the block in two.
                    divided={false}
                    picking={pickingCurves}
                    onTogglePicking={() =>
                      setPickingPath(pickingCurves ? null : { featureId: feature.id, index })
                    }
                    pickLabel={t('array.pickCurves')}
                    finishLabel={t('extrude.finishPick')}
                    error={brokenPath ? t('array.pathBroken') : undefined}
                    emptyHint={t('array.emptyCurves')}
                    pickHint={t('array.pickCurvesHint')}
                    removeLabel={t('array.removeCurve')}
                    rows={curveRows.map((row) => ({
                      ...row,
                      onRemove: () => {
                        const path = direction.paths.find(
                          (candidate) => pathKey(candidate) === row.key,
                        );
                        if (path) toggleArrayPath(feature.id, index, path);
                      },
                    }))}
                  />
                )}
              </div>
            );
          })}
          {feature.directions.length === 0 && (
            <p className="panel-hint">{t('array.emptyDirections')}</p>
          )}
        </div>
      </PanelSection>
    </>
  );
}
