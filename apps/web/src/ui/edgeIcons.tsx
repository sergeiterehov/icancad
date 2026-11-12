import { Icon } from 'lucide-react';

// A body corner drawn three ways: the join of the stroke is the operation.
const CORNER = 'M4 20V10L10 4H20';
const ROUNDED_CORNER = 'M4 20V10A6 6 0 0 1 10 4H20';

function cornerPath(d: string, join: 'miter' | 'bevel' | 'round') {
  return [
    ['path', { d, strokeLinejoin: join, key: 'corner' }],
  ] as Array<[string, Record<string, unknown>]>;
}

/** The Edge treatment tool: a sharp corner, the starting point of both sides. */
export function EdgeToolIcon({ size = 17 }: { size?: number }) {
  return <Icon iconNode={cornerPath(CORNER, 'miter')} size={size} />;
}

/** A chamfer cuts the corner straight, exactly like a bevel join. */
export function ChamferIcon({ size = 14 }: { size?: number }) {
  return <Icon iconNode={cornerPath(CORNER, 'bevel')} size={size} />;
}

/** A fillet rounds the corner, exactly like a round join. */
export function FilletIcon({ size = 14 }: { size?: number }) {
  return <Icon iconNode={cornerPath(ROUNDED_CORNER, 'round')} size={size} />;
}
