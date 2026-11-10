import { crosshairPlusDot } from '@lucide/lab';
import { Box, Icon, SquaresIntersect, SquaresSubtract, SquaresUnite } from 'lucide-react';

/** Experimental Lucide Lab point marker. */
export function PointIcon({ size = 16 }: { size?: number }) {
  return <Icon iconNode={crosshairPlusDot} size={size} />;
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
