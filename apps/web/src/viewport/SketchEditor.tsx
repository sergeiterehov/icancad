import { createId, type SketchEntity, type SketchFeature } from '@icancad/model';
import { datumFrame, type Point2 } from '@icancad/sketch';
import {
  Check,
  Circle,
  CircleDot,
  CircleSlashed,
  Disc,
  Minus,
  MousePointer2,
  PenTool,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocumentStore } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import { IconButton } from '../ui/Controls';
import { getViewport } from './handle';

type Tool = 'select' | 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'bezier';

type ToolLabel =
  | 'sketch.toolSelect'
  | 'sketch.toolPoint'
  | 'sketch.toolLine'
  | 'sketch.toolCircle'
  | 'sketch.toolArc'
  | 'sketch.toolEllipse'
  | 'sketch.toolBezier';

const TOOLS: { tool: Tool; icon: typeof Circle; label: ToolLabel }[] = [
  { tool: 'select', icon: MousePointer2, label: 'sketch.toolSelect' },
  { tool: 'point', icon: CircleDot, label: 'sketch.toolPoint' },
  { tool: 'line', icon: Minus, label: 'sketch.toolLine' },
  { tool: 'circle', icon: Circle, label: 'sketch.toolCircle' },
  { tool: 'arc', icon: CircleSlashed, label: 'sketch.toolArc' },
  { tool: 'ellipse', icon: Disc, label: 'sketch.toolEllipse' },
  { tool: 'bezier', icon: PenTool, label: 'sketch.toolBezier' },
];

function distance(a: Point2, b: Point2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function SketchEditor() {
  const { t } = useTranslation();
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const setActiveSketch = useUiStore((state) => state.setActiveSketch);
  const selectionIds = useUiStore((state) => state.sketchSelectionIds);
  const setSketchSelection = useUiStore((state) => state.setSketchSelection);
  const project = useDocumentStore((state) => state.project);
  const apply = useDocumentStore((state) => state.apply);
  const sketch = project.features.find(
    (feature): feature is SketchFeature =>
      feature.id === activeSketchId && feature.type === 'sketch',
  );
  const frame = sketch
    ? sketch.plane.type === 'datum'
      ? datumFrame(sketch.plane.plane, sketch.plane.offset)
      : (sketch.plane.frame ?? datumFrame('XY', 0))
    : null;

  const [tool, setTool] = useState<Tool>('select');
  const [draft, setDraft] = useState<Point2[]>([]);
  const [hover, setHover] = useState<Point2 | null>(null);
  const pointerDown = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setDraft([]);
    setHover(null);
    setTool('select');
  }, [activeSketchId]);

  useEffect(() => {
    if (activeSketchId && !sketch) setActiveSketch(null);
  }, [activeSketchId, sketch, setActiveSketch]);

  useEffect(() => {
    if (!activeSketchId || !frame) return;
    const viewport = getViewport();
    const camera = viewport?.getCameraState() ?? null;
    viewport?.alignSketch(frame);
    return () => {
      if (camera) viewport?.setCameraState(camera);
    };
  }, [activeSketchId]);

  useEffect(() => {
    getViewport()?.setSketchOverlay(null, []);
    return () => getViewport()?.setSketchOverlay(null, []);
  }, [activeSketchId]);

  const commitEntities = (entities: SketchEntity[]) => {
    if (!sketch) return;
    apply({ type: 'feature/replace', feature: { ...sketch, entities } });
  };

  const addEntity = (entity: SketchEntity) => {
    if (!sketch) return;
    commitEntities([...sketch.entities, entity]);
  };

  const finishBezier = () => {
    if (draft.length >= 2) {
      addEntity({
        id: createId('entity'),
        type: 'bezier',
        construction: false,
        points: draft.map((point) => [point[0], point[1]] as [number, number]),
      });
    }
    setDraft([]);
  };

  const addPoint = (point: Point2) => {
    if (tool === 'point') {
      addEntity({
        id: createId('entity'),
        type: 'point',
        construction: false,
        x: point[0],
        y: point[1],
      });
      return;
    }
    if (tool === 'bezier') {
      setDraft([...draft, point]);
      return;
    }
    if (tool === 'line') {
      if (draft.length === 0) setDraft([point]);
      else {
        addEntity({
          id: createId('entity'),
          type: 'line',
          construction: false,
          x1: draft[0]![0],
          y1: draft[0]![1],
          x2: point[0],
          y2: point[1],
        });
        setDraft([]);
      }
      return;
    }
    if (tool === 'circle') {
      if (draft.length === 0) setDraft([point]);
      else {
        const radius = distance(draft[0]!, point);
        if (radius > 0.01) {
          addEntity({
            id: createId('entity'),
            type: 'circle',
            construction: false,
            cx: draft[0]![0],
            cy: draft[0]![1],
            r: radius,
          });
        }
        setDraft([]);
      }
      return;
    }
    if (tool === 'arc') {
      if (draft.length < 2) setDraft([...draft, point]);
      else {
        const [origin, start] = draft as [Point2, Point2];
        const radius = distance(origin, start);
        if (radius > 0.01) {
          addEntity({
            id: createId('entity'),
            type: 'arc',
            construction: false,
            cx: origin[0],
            cy: origin[1],
            r: radius,
            startAngle: Math.atan2(start[1] - origin[1], start[0] - origin[0]),
            endAngle: Math.atan2(point[1] - origin[1], point[0] - origin[0]),
          });
        }
        setDraft([]);
      }
      return;
    }
    if (tool === 'ellipse') {
      if (draft.length === 0) setDraft([point]);
      else {
        const rx = Math.abs(point[0] - draft[0]![0]);
        const ry = Math.abs(point[1] - draft[0]![1]);
        if (rx > 0.01 && ry > 0.01) {
          addEntity({
            id: createId('entity'),
            type: 'ellipse',
            construction: false,
            cx: draft[0]![0],
            cy: draft[0]![1],
            rx,
            ry,
            rotation: 0,
          });
        }
        setDraft([]);
      }
    }
  };

  useEffect(() => {
    if (!activeSketchId || !sketch) return;
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="viewport-canvas"]');
    if (!canvas) return;
    canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';

    const onPointerDown = (event: PointerEvent) => {
      if (event.button === 0) pointerDown.current = { x: event.clientX, y: event.clientY };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (tool === 'select') return;
      const pick = getViewport()?.pickSketch(event.clientX, event.clientY);
      if (pick) {
        setHover([Math.round(pick.point[0] * 2) / 2, Math.round(pick.point[1] * 2) / 2]);
      }
    };
    const onClick = (event: MouseEvent) => {
      const down = pointerDown.current;
      pointerDown.current = null;
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
      const pick = getViewport()?.pickSketch(event.clientX, event.clientY);
      if (!pick) return;
      if (tool === 'select') {
        const key = pick.entityId
          ? pick.pointIndex !== null
            ? `${pick.entityId}#${pick.pointIndex}`
            : pick.entityId
          : null;
        const additive = event.metaKey || event.ctrlKey || event.shiftKey;
        if (!key) {
          if (!additive) setSketchSelection([]);
        } else if (!additive) {
          setSketchSelection([key]);
        } else {
          setSketchSelection(
            selectionIds.includes(key)
              ? selectionIds.filter((candidate) => candidate !== key)
              : [...selectionIds, key],
          );
        }
        return;
      }
      addPoint([Math.round(pick.point[0] * 2) / 2, Math.round(pick.point[1] * 2) / 2]);
    };
    const onDoubleClick = () => {
      if (tool === 'bezier') finishBezier();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('dblclick', onDoubleClick);
    return () => {
      canvas.style.cursor = '';
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('dblclick', onDoubleClick);
    };
  }, [activeSketchId, tool, draft, sketch, selectionIds, setSketchSelection]);

  const previewEntity = (): SketchEntity | null => {
    if (!hover) return null;
    if (tool === 'line' && draft[0]) {
      return {
        id: 'preview',
        type: 'line',
        construction: false,
        x1: draft[0][0],
        y1: draft[0][1],
        x2: hover[0],
        y2: hover[1],
      };
    }
    if (tool === 'circle' && draft[0]) {
      return {
        id: 'preview',
        type: 'circle',
        construction: false,
        cx: draft[0][0],
        cy: draft[0][1],
        r: distance(draft[0], hover),
      };
    }
    if (tool === 'arc' && draft[0]) {
      const radius = distance(draft[0], draft[1] ?? hover);
      return {
        id: 'preview',
        type: 'arc',
        construction: false,
        cx: draft[0][0],
        cy: draft[0][1],
        r: Math.max(radius, 0.01),
        startAngle: Math.atan2(
          (draft[1] ?? hover)[1] - draft[0][1],
          (draft[1] ?? hover)[0] - draft[0][0],
        ),
        endAngle: Math.atan2(hover[1] - draft[0][1], hover[0] - draft[0][0]),
      };
    }
    if (tool === 'ellipse' && draft[0]) {
      return {
        id: 'preview',
        type: 'ellipse',
        construction: false,
        cx: draft[0][0],
        cy: draft[0][1],
        rx: Math.max(Math.abs(hover[0] - draft[0][0]), 0.01),
        ry: Math.max(Math.abs(hover[1] - draft[0][1]), 0.01),
        rotation: 0,
      };
    }
    if (tool === 'bezier' && draft.length > 0) {
      return {
        id: 'preview',
        type: 'bezier',
        construction: false,
        points: [...draft, hover].map((point) => [point[0], point[1]] as [number, number]),
      };
    }
    return null;
  };

  useEffect(() => {
    if (!activeSketchId) return;
    getViewport()?.setSketchOverlay(previewEntity(), draft);
  }, [activeSketchId, tool, draft, hover]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === 'Escape') {
        setDraft([]);
        setHover(null);
        setSketchSelection([]);
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const entityIds = selectionIds.filter((key) => !key.includes('#'));
        if (entityIds.length > 0 && sketch) {
          commitEntities(sketch.entities.filter((entity) => !entityIds.includes(entity.id)));
          setSketchSelection([]);
        }
      }
      if (event.key === 'Enter' && tool === 'bezier') finishBezier();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!sketch || !activeSketchId) return null;

  const entitySelection = selectionIds.filter((key) => !key.includes('#'));
  const hint =
    tool === 'line'
      ? draft.length === 0
        ? t('sketch.startLine')
        : t('sketch.finishLine')
      : tool === 'circle'
        ? draft.length === 0
          ? t('sketch.centerCircle')
          : t('sketch.radiusCircle')
        : tool === 'arc'
          ? draft.length === 0
            ? t('sketch.centerArc')
            : draft.length === 1
              ? t('sketch.startArc')
              : t('sketch.endArc')
          : tool === 'ellipse'
            ? draft.length === 0
              ? t('sketch.centerEllipse')
              : t('sketch.cornerEllipse')
            : tool === 'bezier'
              ? draft.length > 0
                ? t('sketch.finishBezier')
                : t('sketch.addBezier')
              : '';

  return (
    <div className="sketch-overlay">
      <div className="sketch-toolbar">
        {TOOLS.map(({ tool: value, icon: Icon, label }) => (
          <IconButton
            key={value}
            label={t(label)}
            active={tool === value}
            onClick={() => {
              setTool(value);
              setDraft([]);
              setHover(null);
            }}
          >
            <Icon size={16} />
          </IconButton>
        ))}
        <div className="tool-separator" />
        <IconButton
          label={t('common.delete')}
          disabled={entitySelection.length === 0}
          onClick={() => {
            commitEntities(sketch.entities.filter((entity) => !entitySelection.includes(entity.id)));
            setSketchSelection([]);
          }}
        >
          <Trash2 size={15} />
        </IconButton>
        <IconButton
          label={t('sketch.done')}
          onClick={() => {
            setDraft([]);
            setActiveSketch(null);
          }}
        >
          <Check size={17} />
        </IconButton>
      </div>

      <div className="sketch-hint">
        {hint || (sketch.entities.length === 0 ? t('sketch.empty') : '')}
      </div>
    </div>
  );
}
