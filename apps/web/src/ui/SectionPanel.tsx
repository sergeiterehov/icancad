import { createId, type SectionPlane, type SketchFeature } from '@icancad/model';
import { ArrowLeftRight, Eye, EyeOff, Hexagon, Plus, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveSectionPlane } from '../sketch/sectionPlane';
import { useDocumentStore } from '../stores/documentStore';
import { useKernelStore } from '../stores/kernelStore';
import { useUiStore } from '../stores/uiStore';
import { IconButton, NumberField, ObjectPickerField, PanelSection } from './Controls';
import { Tooltip } from './Tooltip';

type Axis = 'x' | 'y' | 'z';

function axisNormal(axis: Axis): SectionPlane['normal'] {
  if (axis === 'x') return [1, 0, 0];
  if (axis === 'y') return [0, 1, 0];
  return [0, 0, 1];
}

/** A plane follows a face once the face tab is chosen, even before a pick. */
function onFace(plane: SectionPlane): boolean {
  return plane.face !== undefined;
}

function currentAxis(plane: SectionPlane): Axis {
  const [x, y, z] = plane.normal;
  if (Math.abs(x) >= Math.abs(y) && Math.abs(x) >= Math.abs(z)) return 'x';
  if (Math.abs(y) >= Math.abs(z)) return 'y';
  return 'z';
}

function NumericInput({
  label,
  value,
  suffix,
  onCommit,
}: {
  label: string;
  value: number;
  suffix?: string;
  onCommit: (value: number) => void;
}) {
  return (
    <Tooltip content={label}>
      <NumberField
        label={label}
        value={value}
        allowNegative
        onCommit={onCommit}
        className="section-input"
        suffix={suffix ? <span className="section-input-suffix">{suffix}</span> : undefined}
      />
    </Tooltip>
  );
}

export function SectionPanel() {
  const { t } = useTranslation();
  const project = useDocumentStore((state) => state.project);
  const planes = project.view.sectionPlanes;
  const setSectionPlanes = useDocumentStore((state) => state.setSectionPlanes);
  const meshes = useKernelStore((state) => state.meshes);
  const pickingSectionFace = useUiStore((state) => state.pickingSectionFace);
  const setPickingSectionFace = useUiStore((state) => state.setPickingSectionFace);
  const enabled = useUiStore((state) => state.sectionEnabled);
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const sketchSectionEnabled = useUiStore((state) => state.sketchSectionEnabled);
  const setSketchSectionEnabled = useUiStore((state) => state.setSketchSectionEnabled);

  const sketch = project.features.find(
    (feature): feature is SketchFeature =>
      feature.type === 'sketch' && feature.id === activeSketchId,
  );

  useEffect(() => {
    if (!pickingSectionFace) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickingSectionFace(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pickingSectionFace, setPickingSectionFace]);

  useEffect(() => () => setPickingSectionFace(null), [setPickingSectionFace]);

  if (!enabled || (planes.length === 0 && !sketch)) return null;

  const update = (id: string, patch: Partial<SectionPlane>) => {
    setSectionPlanes(planes.map((plane) => (plane.id === id ? { ...plane, ...patch } : plane)));
  };

  const addPlane = () => {
    const axis = (['y', 'x', 'z'] as const)[planes.length % 3]!;
    setSectionPlanes([
      ...planes,
      {
        id: createId('section'),
        name: t('section.plane', { index: planes.length + 1 }),
        origin: [0, 0, 0],
        normal: axisNormal(axis),
        offset: 0,
        visible: true,
      },
    ]);
  };

  return (
    <PanelSection
      title={t('section.title')}
      count={planes.length + (sketch ? 1 : 0)}
      action={
        <IconButton label={t('section.add')} onClick={addPlane}>
          <Plus size={14} />
        </IconButton>
      }
    >
      <div className="section-planes">
        {sketch && (
          <div className="section-plane sketch-plane">
            <IconButton
              label={sketchSectionEnabled ? t('section.hide') : t('section.show')}
              active={sketchSectionEnabled}
              onClick={() => setSketchSectionEnabled(!sketchSectionEnabled)}
            >
              {sketchSectionEnabled ? <Eye size={14} /> : <EyeOff size={14} />}
            </IconButton>
            <span className="section-plane-name">{t('section.sketchPlane')}</span>
          </div>
        )}
        {planes.map((plane) => {
          const face = plane.face ?? null;
          const linked = face ? resolveSectionPlane(plane, meshes).faceLinked : false;
          // A face whose body has no mesh yet is still loading, not lost.
          const loading =
            face !== null &&
            !meshes[face.bodyId] &&
            project.bodies.some((body) => body.id === face.bodyId);
          const invalid = Boolean(face) && !linked && !loading;
          return (
            <div key={plane.id} className="section-plane">
              <IconButton
                label={plane.visible ? t('section.hide') : t('section.show')}
                active={plane.visible}
                onClick={() => update(plane.id, { visible: !plane.visible })}
              >
                {plane.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </IconButton>
              <div className="section-axis" role="group" aria-label={t('section.axis')}>
                {(['x', 'y', 'z'] as const).map((axis) => (
                  <button
                    key={axis}
                    type="button"
                    data-active={!onFace(plane) && currentAxis(plane) === axis ? 'true' : undefined}
                    aria-pressed={!onFace(plane) && currentAxis(plane) === axis}
                    aria-label={t('section.axisAlong', { axis: axis.toUpperCase() })}
                    onClick={() => {
                      setPickingSectionFace(null);
                      // An axis plane sits at the world origin; a face pose must
                      // not linger in it.
                      update(plane.id, {
                        normal: axisNormal(axis),
                        origin: [0, 0, 0],
                        face: undefined,
                      });
                    }}
                  >
                    {axis.toUpperCase()}
                  </button>
                ))}
                <button
                  type="button"
                  data-active={onFace(plane) ? 'true' : undefined}
                  aria-pressed={onFace(plane)}
                  aria-label={t('section.axisFace')}
                  onClick={() => {
                    if (onFace(plane)) return;
                    // A section on a face has nothing to show until the face is
                    // there, so choosing the tab starts the pick right away.
                    update(plane.id, { face: null });
                    setPickingSectionFace(plane.id);
                  }}
                >
                  <Hexagon size={12} />
                </button>
              </div>
              {onFace(plane) && (
                <div className="section-face">
                  <ObjectPickerField
                    compact
                    label={t('section.selectFace')}
                    value={face ? t('section.face', { index: Number(face.topoId) + 1 }) : undefined}
                    placeholder={t('section.selectFace')}
                    icon={<Hexagon size={12} />}
                    active={pickingSectionFace === plane.id}
                    invalid={invalid}
                    onClick={() =>
                      setPickingSectionFace(pickingSectionFace === plane.id ? null : plane.id)
                    }
                    testId="section-face-picker"
                  />
                </div>
              )}
              <div className="section-offset">
                <NumericInput
                  label={t('section.offset')}
                  value={plane.offset}
                  suffix="mm"
                  onCommit={(offset) => update(plane.id, { offset })}
                />
              </div>
              <IconButton
                label={t('section.invert')}
                active={plane.inverted}
                onClick={() => update(plane.id, { inverted: !plane.inverted })}
              >
                <ArrowLeftRight size={14} />
              </IconButton>
              <IconButton
                label={t('section.remove')}
                onClick={() => {
                  setPickingSectionFace(null);
                  setSectionPlanes(planes.filter((candidate) => candidate.id !== plane.id));
                }}
              >
                <Trash2 size={14} />
              </IconButton>
            </div>
          );
        })}
      </div>
    </PanelSection>
  );
}
