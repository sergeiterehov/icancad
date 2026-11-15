import { describe, expect, it } from 'vitest';
import { CAMERA_SCHEMES, type CameraScheme } from '../src/viewport/cameraControls';
import { cameraHintLines, type HintInput } from '../src/viewport/cameraHint';

const schemeOf = (id: string): CameraScheme => CAMERA_SCHEMES.find((scheme) => scheme.id === id)!;
const t = (key: string) => key;
const mouse: HintInput = { profile: 'pointer', pointer: 'mouse', altLabel: 'Alt' };
const trackpad: HintInput = { profile: 'pointer', pointer: 'trackpad', altLabel: '⌥' };
const touch: HintInput = { profile: 'touch', pointer: 'mouse', altLabel: '⌥' };
const lines = (scheme: CameraScheme, input: HintInput) => cameraHintLines(scheme, input, t);

describe('camera hint', () => {
  it('gives a mouse one gesture per line, spelled out', () => {
    expect(lines(schemeOf('blender'), mouse)).toEqual([
      { id: 'orbit', text: 'nav.actionOrbit: nav.buttonMiddle' },
      { id: 'pan', text: 'nav.actionPan: nav.keyShift + nav.buttonMiddle' },
      { id: 'zoom', text: 'nav.actionZoom: nav.gestureWheel' },
    ]);
  });

  it('follows Blender on a trackpad: two fingers turn, Shift pans, a pinch zooms', () => {
    expect(lines(schemeOf('blender'), trackpad)).toEqual([
      { id: 'orbit', text: 'nav.actionOrbit: nav.gestureTwoFingers' },
      { id: 'pan', text: 'nav.actionPan: nav.keyShift + nav.gestureTwoFingers' },
      { id: 'zoom', text: 'nav.actionZoom: nav.gesturePinch' },
    ]);
  });

  it('shows the Alt twin on a trackpad for the schemes without a wheel gesture', () => {
    // Fusion pans with the wheel button, so on a trackpad it is Alt with the
    // left button, and the label follows the keyboard: ⌥ on a Mac.
    expect(lines(schemeOf('fusion'), trackpad)).toEqual([
      { id: 'orbit', text: 'nav.actionOrbit: nav.keyShift + ⌥ + nav.buttonLeft' },
      { id: 'pan', text: 'nav.actionPan: ⌥ + nav.buttonLeft' },
      { id: 'zoom', text: 'nav.actionZoom: nav.gesturePinch' },
    ]);
  });

  it('names the modifier a scheme needs', () => {
    expect(lines(schemeOf('solidworks'), mouse)[1]).toEqual({
      id: 'pan',
      text: 'nav.actionPan: nav.keyCtrl + nav.buttonMiddle',
    });
  });

  it('describes fingers when the device has no pointer at all', () => {
    expect(lines(schemeOf('blender'), touch)).toEqual([
      { id: 'orbit', text: 'nav.actionOrbit: nav.gestureOneFinger' },
      { id: 'pan', text: 'nav.actionPan: nav.gestureTwoFingers' },
      { id: 'zoom', text: 'nav.actionZoom: nav.gesturePinch' },
    ]);
  });

  it('never leaves a line without a gesture', () => {
    for (const scheme of CAMERA_SCHEMES) {
      for (const input of [mouse, trackpad, touch]) {
        const list = lines(scheme, input);
        expect(list.length).toBeGreaterThanOrEqual(3);
        for (const line of list) expect(line.text.split(': ')[1]).toBeTruthy();
      }
    }
  });

  it('adds the sketch rule to the hint while a sketch is open', () => {
    // A sketch turns a turn into a pan, and the cube's hint is where that is
    // learnt. The rule is a part of its own: a rule, the name with the icon of
    // the sketch, and the sentence that says what a turn does now.
    const lines = cameraHintLines(schemeOf('blender'), { ...mouse, sketching: true }, t);
    expect(lines.slice(0, -3)).toEqual(cameraHintLines(schemeOf('blender'), mouse, t));
    expect(lines.slice(-3)).toEqual([
      { id: 'sketch-divider', text: '', divider: true },
      { id: 'sketch-heading', text: 'nav.hintSketch', heading: true, icon: 'sketch' },
      { id: 'sketch-rule', text: 'nav.hintSketchPans' },
    ]);
  });

  it('leaves the rule out when no sketch is open', () => {
    expect(lines(schemeOf('blender'), mouse).some((line) => line.id.startsWith('sketch'))).toBe(
      false,
    );
  });
});
