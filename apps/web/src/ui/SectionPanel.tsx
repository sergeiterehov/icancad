import { createId, type SectionPlane, type SketchFeature } from '@icancad/model';
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocumentStore } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import { IconButton, PanelSection } from './Controls';
import { Tooltip } from './Tooltip';

type Axis = 'x' | 'y' | 'z';

function axisNormal(axis: Axis): SectionPlane['normal'] {
  if (axis === 'x') return [1, 0, 0];
  if (axis === 'y') return [0, 1, 0];
  return [0, 0, 1];
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
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number(draft.replace(',', '.'));
    if (Number.isFinite(parsed)) {
      if (parsed !== value) onCommit(parsed);
      else setDraft(String(value));
    } else {
      setDraft(String(value));
    }
  };

  return (
    <Tooltip content={label}>
      <span className="section-input">
        <input
          className="input"
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
        {suffix && <span className="section-input-suffix">{suffix}</span>}
      </span>
    </Tooltip>
  );
}

export function SectionPanel() {
  const { t } = useTranslation();
  const project = useDocumentStore((state) => state.project);
  const planes = project.view.sectionPlanes;
  const setSectionPlanes = useDocumentStore((state) => state.setSectionPlanes);
  const enabled = useUiStore((state) => state.sectionEnabled);
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const sketchSectionEnabled = useUiStore((state) => state.sketchSectionEnabled);
  const setSketchSectionEnabled = useUiStore((state) => state.setSketchSectionEnabled);

  const sketch = project.features.find(
    (feature): feature is SketchFeature =>
      feature.type === 'sketch' && feature.id === activeSketchId,
  );

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
        {planes.map((plane) => (
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
                  data-active={currentAxis(plane) === axis ? 'true' : undefined}
                  aria-pressed={currentAxis(plane) === axis}
                  aria-label={t('section.axisAlong', { axis: axis.toUpperCase() })}
                  onClick={() => update(plane.id, { normal: axisNormal(axis) })}
                >
                  {axis.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="section-offset">
              <NumericInput
                label={t('section.offset')}
                value={plane.offset}
                suffix="mm"
                onCommit={(offset) => update(plane.id, { offset })}
              />
            </div>
            <IconButton
              label={t('section.remove')}
              onClick={() =>
                setSectionPlanes(planes.filter((candidate) => candidate.id !== plane.id))
              }
            >
              <Trash2 size={14} />
            </IconButton>
          </div>
        ))}
      </div>
    </PanelSection>
  );
}
