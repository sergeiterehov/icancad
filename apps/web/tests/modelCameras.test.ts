import { describe, expect, it } from 'vitest';
import {
  cameraBookFrom,
  cameraOf,
  MODEL_CAMERAS_KEY,
  storedCamera,
  withCamera,
  type CameraBook,
} from '../src/viewport/modelCameras';

const POSE = {
  target: [1, 2, 3] as [number, number, number],
  distance: 120,
  azimuth: 0.5,
  polar: 1.1,
  roll: 0.2,
};

describe('the camera of a model', () => {
  it('is remembered per project and per model', () => {
    expect(MODEL_CAMERAS_KEY).toBe('icancad.modelCameras');
    const book: CameraBook = { projectA: { modelA: POSE } };
    expect(cameraOf(book, { projectId: 'projectA', modelId: 'modelA' })).toEqual(POSE);
    expect(cameraOf(book, { projectId: 'projectA', modelId: 'modelB' })).toBeNull();
    // The same model id in another project is another model.
    expect(cameraOf(book, { projectId: 'projectB', modelId: 'modelA' })).toBeNull();
  });

  it('keeps the orientation with the position', () => {
    const pose = storedCamera(POSE);
    expect(pose).toEqual(POSE);
    expect(pose?.azimuth).toBe(0.5);
    expect(pose?.polar).toBe(1.1);
    expect(pose?.roll).toBe(0.2);
  });

  it('reads a pose written before the horizon could tilt', () => {
    const { roll: _roll, ...level } = POSE;
    expect(storedCamera(level)).toEqual({ ...level, roll: 0 });
  });

  it('refuses a pose it cannot use', () => {
    expect(storedCamera(null)).toBeNull();
    expect(storedCamera('camera')).toBeNull();
    expect(storedCamera({ ...POSE, target: [1, 2] })).toBeNull();
    expect(storedCamera({ ...POSE, target: [1, 2, Number.NaN] })).toBeNull();
    expect(storedCamera({ ...POSE, distance: 0 })).toBeNull();
    expect(storedCamera({ ...POSE, azimuth: 'left' })).toBeNull();
  });

  it('drops the entries it cannot read and keeps the rest', () => {
    const book = cameraBookFrom(
      JSON.stringify({
        projectA: { modelA: POSE, modelB: { target: [0, 0, 0] } },
        projectB: 'nonsense',
        projectC: { modelC: { ...POSE, distance: -1 } },
      }),
    );
    expect(book).toEqual({ projectA: { modelA: POSE } });
    expect(cameraBookFrom('{oops')).toEqual({});
    expect(cameraBookFrom(null)).toEqual({});
    expect(cameraBookFrom('[]')).toEqual({});
  });

  it('puts a camera in place without touching the given book', () => {
    const book: CameraBook = { projectA: { modelA: POSE } };
    const other = { ...POSE, distance: 40 };
    const next = withCamera(book, { projectId: 'projectA', modelId: 'modelB' }, other);
    expect(next).toEqual({ projectA: { modelA: POSE, modelB: other } });
    expect(book).toEqual({ projectA: { modelA: POSE } });
    expect(withCamera(book, { projectId: 'projectB', modelId: 'modelB' }, other)).toEqual({
      projectA: { modelA: POSE },
      projectB: { modelB: other },
    });
  });
});
