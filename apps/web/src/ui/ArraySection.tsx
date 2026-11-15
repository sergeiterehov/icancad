import {
  activeModel,
  resolveBody,
  type ArrayDirection,
  type ArrayFeature,
  type SketchEntity,
  type SketchFeature,
} from '@icancad/model';
import { ArrowLeftRight, ArrowRight, Box, Grid3x3, History, RotateCw, Spline, X } from 'lucide-react';
import { useEffect, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocumentStore } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import { useContextMenuStore } from './ContextMenu';
import {
  Button,
  DimensionField,
  IconButton,
  ObjectPickerField,
  PanelSection,
  Segmented,
  SegmentedTab,
} from './Controls';
import { PickableSection, type PickableRow } from './PickableSection';

const AXES = ['x', 'y', 'z'] as const;

function entityLabel(t: (key: string) => string, entity: SketchEntity): string {
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
  const invertArrayDirection = useDocumentStore((state) => state.invertArrayDirection);
  const setArrayPath = useDocumentStore((state) => state.setArrayPath);
  const pickingBodies = useUiStore((state) => state.pickingArrayBodies);
  const pickingOperations = useUiStore((state) => state.pickingArrayOperations);
  const setPickingBodies = useUiStore((state) => state.setPickingArrayBodies);
  const setPickingOperations = useUiStore((state) => state.setPickingArrayOperations);
  const openMenu = useContextMenuStore((state) => state.open);

  // Picking belongs to one operation: selecting anything else ends it.
  useEffect(() => {
    if (pickingBodies && pickingBodies !== feature.id) setPickingBodies(null);
    if (pickingOperations && pickingOperations !== feature.id) setPickingOperations(null);
  }, [pickingBodies, pickingOperations, feature.id, setPickingBodies, setPickingOperations]);

  // The array owns the surface its target names. Reopening its settings must not
  // turn a timeline chip into a way to leave the operation being edited: the
  // chips are exactly what the operation list is filled from.
  useEffect(() => {
    if (feature.target === 'operations') setPickingOperations(feature.id);
    else setPickingBodies(feature.id);
  }, [feature.id, feature.target, setPickingBodies, setPickingOperations]);

  useEffect(() => {
    if (!pickingBodies && !pickingOperations) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPickingBodies(null);
      setPickingOperations(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pickingBodies, pickingOperations, setPickingBodies, setPickingOperations]);

  const model = activeModel(project);
  // Only sketches that exist before the array can carry its path: a later one
  // would make the operation depend on its own future.
  const arrayIndex = model.features.findIndex((candidate) => candidate.id === feature.id);
  const sketches = model.features.filter(
    (candidate, index): candidate is SketchFeature =>
      candidate.type === 'sketch' && (arrayIndex < 0 || index < arrayIndex),
  );

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
    return {
      key: operationId,
      icon: <History size={14} />,
      name: operation?.name ?? operationId,
      // A modifying extrude makes no bodies: it repeats its tool on the bodies
      // it already changed.
      meta:
        bodies > 0
          ? t('array.copies', { count: bodies })
          : operation?.type === 'extrude'
            ? t('array.modifies')
            : undefined,
      onRemove: () => toggleArrayOperation(feature.id, operationId),
    };
  });

  const openPathMenu = (event: MouseEvent<HTMLButtonElement>, index: number) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const items = sketches.flatMap((sketch) =>
      sketch.entities
        .filter((entity) => entity.type !== 'point')
        .map((entity) => ({
          id: `${sketch.id}#${entity.id}`,
          label: `${sketch.name} · ${entityLabel((key) => t(key as never), entity)}`,
          icon: directionIcon('path'),
          onSelect: () =>
            setArrayPath(feature.id, index, {
              kind: 'sketch-edge' as const,
              sketchId: sketch.id,
              entityId: entity.id,
            }),
        })),
    );
    openMenu(
      rect.left,
      rect.bottom + 6,
      items.length > 0
        ? items
        : [{ id: 'empty', label: t('array.noPath'), disabled: true, onSelect: () => undefined }],
    );
  };

  const pathName = (direction: Extract<ArrayDirection, { kind: 'path' }>): string | undefined => {
    if (!direction.path) return undefined;
    const sketch = sketches.find((candidate) => candidate.id === direction.path!.sketchId);
    const entity = sketch?.entities.find((candidate) => candidate.id === direction.path!.entityId);
    if (!sketch || !entity) return undefined;
    return `${sketch.name} · ${entityLabel((key) => t(key as never), entity)}`;
  };

  return (
    <>
      <PanelSection title={t('array.type')}>
        <Segmented ariaLabel={t('array.type')}>
          <SegmentedTab
            label={t('array.operations')}
            icon={<History size={12} />}
            active={feature.target === 'operations'}
            onClick={() => {
              setPickingBodies(null);
              setPickingOperations(feature.id);
              setArrayTarget(feature.id, 'operations');
            }}
          />
          <SegmentedTab
            label={t('array.bodies')}
            icon={<Box size={12} />}
            active={feature.target === 'bodies'}
            onClick={() => {
              setPickingOperations(null);
              setPickingBodies(feature.id);
              setArrayTarget(feature.id, 'bodies');
            }}
          />
        </Segmented>
      </PanelSection>

      {feature.target === 'operations' ? (
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
            tooltip={t('array.addDirection')}
            disabled={feature.directions.length >= 3}
            onClick={() => addArrayDirection(feature.id)}
          >
            <Grid3x3 size={14} />
          </IconButton>
        }
      >
        <div className="section-stack">
          {feature.directions.map((direction, index) => {
            const axisIndex =
              direction.kind === 'rotation'
                ? AXES.indexOf(
                    direction.axis.kind === 'world' ? direction.axis.axis : ('x' as const),
                  )
                : AXES.findIndex((_, position) => {
                    const value = direction.kind === 'linear' ? direction.direction[position] : 0;
                    return Math.abs(value ?? 0) > 0.5;
                  });
            const reversed =
              direction.kind === 'linear'
                ? axisIndex >= 0 && (direction.direction[axisIndex] ?? 0) < 0
                : direction.kind === 'rotation'
                  ? direction.angle < 0
                  : false;
            return (
              <div className="array-direction" key={index}>
                <div className="array-direction-head">
                  <span className="field-label">
                    {t('array.direction', { index: index + 1 })}
                  </span>
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
                    icon={<Grid3x3 size={13} />}
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
                    <DimensionField
                      icon={<RotateCw size={13} />}
                      label={t('array.angle')}
                      suffix="°"
                      allowNegative
                      value={direction.angle}
                      onCommit={(angle) => setArrayAngle(feature.id, index, angle)}
                    />
                  )}
                </div>

                {direction.kind !== 'path' && (
                  <div className="control-group">
                    <span className="field-label">{t('array.axis')}</span>
                    <div className="array-axis-row">
                      <Segmented ariaLabel={t('array.axis')}>
                        {AXES.map((axis, position) => (
                          <SegmentedTab
                            key={axis}
                            label={axis.toUpperCase()}
                            active={axisIndex === position}
                            onClick={() => setArrayAxis(feature.id, index, axis)}
                          />
                        ))}
                      </Segmented>
                      <IconButton
                        label={t('array.reverse')}
                        tooltip={t('array.reverse')}
                        active={reversed}
                        onClick={() => invertArrayDirection(feature.id, index)}
                      >
                        <ArrowLeftRight size={14} />
                      </IconButton>
                    </div>
                  </div>
                )}

                {direction.kind === 'path' && (
                  <ObjectPickerField
                    label={t('array.path')}
                    value={pathName(direction)}
                    placeholder={t('array.noPath')}
                    icon={<Spline size={13} />}
                    onClick={(event) => openPathMenu(event, index)}
                  />
                )}
              </div>
            );
          })}
          {feature.directions.length === 0 && (
            <p className="panel-hint">{t('array.emptyDirections')}</p>
          )}
          <Button
            onClick={() => addArrayDirection(feature.id)}
            disabled={feature.directions.length >= 3}
          >
            {t('array.addDirection')}
          </Button>
          {feature.directions.length > 1 && (
            <p className="panel-hint">{t('array.multiHint')}</p>
          )}
        </div>
      </PanelSection>
    </>
  );
}
