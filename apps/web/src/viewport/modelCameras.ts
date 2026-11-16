import type { ViewportCamera } from './handle';

/**
 * The camera of every model, remembered by the app rather than by the project.
 * A view is how this machine looks at a model, so it stays here instead of
 * travelling inside the document: a project opened elsewhere starts from the
 * default pose and is fitted to what it holds.
 */
export type CameraBook = Record<string, Record<string, ViewportCamera>>;

/** Where a camera belongs: one model of one project. */
export interface CameraHome {
  projectId: string;
  modelId: string;
}

export const MODEL_CAMERAS_KEY = 'icancad.modelCameras';

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A pose read from storage, or null when it is missing or unusable. */
export function storedCamera(value: unknown): ViewportCamera | null {
  if (!value || typeof value !== 'object') return null;
  const pose = value as Record<string, unknown>;
  const target = pose.target;
  if (!Array.isArray(target) || target.length !== 3) return null;
  const [x, y, z] = target as unknown[];
  if (!finite(x) || !finite(y) || !finite(z)) return null;
  if (!finite(pose.distance) || pose.distance <= 0) return null;
  if (!finite(pose.azimuth) || !finite(pose.polar)) return null;
  return {
    target: [x, y, z],
    distance: pose.distance,
    azimuth: pose.azimuth,
    polar: pose.polar,
    // A pose written before the horizon could tilt has none.
    roll: finite(pose.roll) ? pose.roll : 0,
  };
}

/** The whole book, with every entry that cannot be used left out. */
export function cameraBookFrom(raw: string | null): CameraBook {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // An entry that cannot be read costs the remembered views, nothing else.
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const book: CameraBook = {};
  for (const [projectId, models] of Object.entries(parsed as Record<string, unknown>)) {
    if (!models || typeof models !== 'object') continue;
    const poses: Record<string, ViewportCamera> = {};
    for (const [modelId, value] of Object.entries(models as Record<string, unknown>)) {
      const pose = storedCamera(value);
      if (pose) poses[modelId] = pose;
    }
    if (Object.keys(poses).length > 0) book[projectId] = poses;
  }
  return book;
}

/** The camera a model was last seen with, or null when it has never been seen. */
export function cameraOf(book: CameraBook, home: CameraHome): ViewportCamera | null {
  return book[home.projectId]?.[home.modelId] ?? null;
}

/** The book with one camera put in its place; the given book is not changed. */
export function withCamera(book: CameraBook, home: CameraHome, pose: ViewportCamera): CameraBook {
  return {
    ...book,
    [home.projectId]: { ...book[home.projectId], [home.modelId]: pose },
  };
}

export function loadCameraBook(): CameraBook {
  try {
    return cameraBookFrom(localStorage.getItem(MODEL_CAMERAS_KEY));
  } catch {
    // localStorage can be unavailable in private mode.
    return {};
  }
}

export function saveCameraBook(book: CameraBook): void {
  try {
    localStorage.setItem(MODEL_CAMERAS_KEY, JSON.stringify(book));
  } catch {
    // Blocked or full storage only costs the remembered view.
  }
}
