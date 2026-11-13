import type { SketchEntity } from '@icancad/model';
import { crosshairPlusDot } from '@lucide/lab';
import {
  Box,
  CircleDot,
  Ellipse,
  Icon,
  LineSquiggle,
  LoaderCircle,
  SquaresIntersect,
  SquaresSubtract,
  SquaresUnite,
  Waypoints,
} from 'lucide-react';

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
