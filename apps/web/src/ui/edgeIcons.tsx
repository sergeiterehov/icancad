import {
  CircleArrowDownRightExit,
  SquareArrowDownRightEnter,
  SquareRoundCorner,
} from 'lucide-react';

/** The Edge treatment tool: one tool that makes both kinds. */
export function EdgeToolIcon({ size = 17 }: { size?: number }) {
  return <SquareRoundCorner size={size} />;
}

/** A chamfer cuts the corner off square. */
export function ChamferIcon({ size = 14 }: { size?: number }) {
  return <SquareArrowDownRightEnter size={size} />;
}

/** A fillet leaves the corner rounded. */
export function FilletIcon({ size = 14 }: { size?: number }) {
  return <CircleArrowDownRightExit size={size} />;
}
