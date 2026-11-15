import type { CameraBinding, CameraScheme } from './cameraControls';
import type { InputProfile, PointerKind } from './inputProfile';

/**
 * The lines of the camera hint: one gesture per line, spelled out. The gestures
 * are read from the scheme itself and from the device in hand, so the hint can
 * never drift from what the buttons actually do.
 */

export interface HintInput {
  profile: InputProfile;
  pointer: PointerKind;
  /** What the keyboard calls Alt: ⌥ on an Apple keyboard. */
  altLabel: string;
}

export interface HintLine {
  id: string;
  /** The finished line; the caller only has to lay it out. */
  text: string;
}

export type Translate = (key: string) => string;

export function cameraHintLines(
  scheme: CameraScheme,
  input: HintInput,
  t: Translate,
): HintLine[] {
  const line = (id: string, action: string, parts: string[]): HintLine => ({
    id,
    text: `${t(action)}: ${parts.join(' + ')}`,
  });
  const buttonOf = (binding: CameraBinding): string =>
    t(binding.button === 1 ? 'nav.buttonMiddle' : 'nav.buttonLeft');
  const keysOf = (binding: CameraBinding): string[] => [
    ...(binding.shift ? [t('nav.keyShift')] : []),
    ...(binding.ctrl ? [t('nav.keyCtrl')] : []),
    ...(binding.alt ? [input.altLabel] : []),
  ];
  // A mouse has a wheel button; a trackpad drives the same scheme with Alt and
  // the left button, so the hint shows whichever of the two the device has.
  const drag = (id: string, action: string, list: readonly CameraBinding[]): HintLine | null => {
    const binding = list.find((candidate) =>
      input.pointer === 'mouse'
        ? candidate.button === 1
        : candidate.button === 0 && candidate.alt,
    );
    return binding ? line(id, action, [...keysOf(binding), buttonOf(binding)]) : null;
  };

  if (input.profile === 'touch') {
    return [
      line('orbit', 'nav.actionOrbit', [t('nav.gestureOneFinger')]),
      line('pan', 'nav.actionPan', [t('nav.gestureTwoFingers')]),
      line('zoom', 'nav.actionZoom', [t('nav.gesturePinch')]),
    ];
  }

  if (input.pointer === 'trackpad' && scheme.scrollOrbits) {
    return [
      line('orbit', 'nav.actionOrbit', [t('nav.gestureTwoFingers')]),
      line('pan', 'nav.actionPan', [t('nav.keyShift'), t('nav.gestureTwoFingers')]),
      line('zoom', 'nav.actionZoom', [t('nav.gesturePinch')]),
    ];
  }

  const zoom = line('zoom', 'nav.actionZoom', [
    t(input.pointer === 'mouse' ? 'nav.gestureWheel' : 'nav.gesturePinch'),
  ]);
  return [
    drag('orbit', 'nav.actionOrbit', scheme.orbit),
    drag('pan', 'nav.actionPan', scheme.pan),
    zoom,
  ].filter((candidate): candidate is HintLine => candidate !== null);
}
