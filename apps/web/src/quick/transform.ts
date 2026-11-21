import type { Transform } from '@icancad/model';

/** Bodies and sketches a new transform starts with. */
export interface TransformInput {
  bodyIds?: string[];
  sketchIds?: string[];
}

/** A transform that changes nothing until it is configured. */
export function defaultTransform(): Transform {
  return {
    translation: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
  };
}

/**
 * The scale is stored as a factor but written as a percentage: that is how a
 * drawing is measured by hand, so the panel field and the drag chip read it.
 */
export function scalePercent(factor: number): number {
  return Math.round(factor * 10000) / 100;
}

/** The factor a percentage typed into the field stands for. */
export function scaleFactor(percent: number): number {
  return percent / 100;
}
