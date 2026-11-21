import type { Feature, SketchEntity } from '@icancad/model';
import { crosshairPlusDot } from '@lucide/lab';
import {
  Box,
  Circle,
  CircleDot,
  Cone,
  Cuboid,
  Cylinder,
  Torus,
  DraftingCompass,
  Ellipse,
  FileUp,
  Icon,
  LayoutArrowDown,
  Layers,
  LineSquiggle,
  LoaderCircle,
  PackageOpen,
  Pill,
  Pyramid,
  SquaresIntersect,
  SquaresSubtract,
  SquaresUnite,
  Trash2,
  Waypoints,
} from 'lucide-react';
import { ChamferIcon, FilletIcon } from './edgeIcons';

/** The shell operation: a body with its inside exposed. */
export function ShellIcon({ size = 16 }: { size?: number }) {
  return <PackageOpen size={size} />;
}

/** A sketch is drawn as a drafting compass, wherever the object is shown. */
export function SketchIcon({ size = 16 }: { size?: number }) {
  return <DraftingCompass size={size} />;
}

/** Experimental Lucide Lab point marker. */
export function PointIcon({ size = 16 }: { size?: number }) {
  return <Icon iconNode={crosshairPlusDot} size={size} />;
}

/**
 * The icon of a sketch entity. The tool rail and the geometry list share it, so
 * a line looks the same while it is drawn and in the list of what was drawn.
 */
export function SketchEntityIcon({
  type,
  size = 13,
}: {
  type: SketchEntity['type'];
  size?: number;
}) {
  switch (type) {
    case 'point':
      return <PointIcon size={size} />;
    case 'line':
      return <Waypoints size={size} />;
    case 'circle':
      return <CircleDot size={size} />;
    case 'arc':
      return <LoaderCircle size={size} />;
    case 'ellipse':
      return <Ellipse size={size} />;
    case 'bezier':
      return <LineSquiggle size={size} />;
  }
}

/** The icon of an extrude operation, shared by the inspector and the timeline. */
export function ExtrudeOpIcon({
  op,
  size = 12,
}: {
  op: 'new' | 'add' | 'subtract' | 'intersect';
  size?: number;
}) {
  switch (op) {
    case 'new':
      return <Box size={size} />;
    case 'add':
      return <SquaresUnite size={size} />;
    case 'subtract':
      return <SquaresSubtract size={size} />;
    case 'intersect':
      return <SquaresIntersect size={size} />;
  }
}

/** The icon of an operation, shared by the timeline and the delete dialog. */
export function FeatureIcon({ feature, size = 16 }: { feature: Feature; size?: number }) {
  switch (feature.type) {
    case 'primitive':
      switch (feature.kind) {
        case 'box':
          return <Cuboid size={size} />;
        case 'sphere':
          return <Circle size={size} />;
        case 'cylinder':
          return <Cylinder size={size} />;
        case 'cone':
          return <Cone size={size} />;
        case 'torus':
          return <Torus size={size} />;
        case 'pyramid':
          return <Pyramid size={size} />;
        case 'capsule':
          return <Pill size={size} />;
      }
      return <Box size={size} />;
    case 'sketch':
      return <SketchIcon size={size} />;
    case 'extrude':
      return <ExtrudeOpIcon op={feature.op} size={size} />;
    case 'boolean':
      return (
        <ExtrudeOpIcon
          op={feature.op === 'union' ? 'add' : feature.op === 'subtract' ? 'subtract' : 'intersect'}
          size={size}
        />
      );
    case 'import-mesh':
      return <FileUp size={size} />;
    case 'delete-body':
      return <Trash2 size={size} />;
    // The history names the concrete operation, so it shows the kind's icon.
    case 'edge-treatment':
      return feature.kind === 'chamfer' ? <ChamferIcon size={size} /> : <FilletIcon size={size} />;
    case 'shell':
      return <ShellIcon size={size} />;
    case 'array':
      return <LayoutArrowDown size={size} />;
    default:
      return <Layers size={size} />;
  }
}
