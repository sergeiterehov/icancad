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
  /** A sketch is open, where a facing view pans instead of turning. */
  sketching?: boolean;
}

export interface HintLine {
  id: string;
  /** The finished line; the caller only has to lay it out. */
  text: string;
  /** Names what the lines under it are about, rather than stating a gesture. */
  heading?: boolean;
  /** A rule between two parts of the hint instead of a line of text. */
  divider?: boolean;
  /** An icon drawn before the text. */
  icon?: 'sketch';
}

export type Translate = (key: string) => string;

export function cameraHintLines(scheme: CameraScheme, input: HintInput, t: Translate): HintLine[] {
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
      input.pointer === 'mouse' ? candidate.button === 1 : candidate.button === 0 && candidate.alt,
    );
    return binding ? line(id, action, [...keysOf(binding), buttonOf(binding)]) : null;
  };

  if (input.profile === 'touch') {
    return withSketch(
      [
        line('orbit', 'nav.actionOrbit', [t('nav.gestureOneFinger')]),
        line('pan', 'nav.actionPan', [t('nav.gestureTwoFingers')]),
        line('zoom', 'nav.actionZoom', [t('nav.gesturePinch')]),
      ],
      input,
      t,
    );
  }

  if (input.pointer === 'trackpad' && scheme.scrollOrbits) {
    return withSketch(
      [
        line('orbit', 'nav.actionOrbit', [t('nav.gestureTwoFingers')]),
        line('pan', 'nav.actionPan', [t('nav.keyShift'), t('nav.gestureTwoFingers')]),
        line('zoom', 'nav.actionZoom', [t('nav.gesturePinch')]),
      ],
      input,
      t,
    );
  }

  const zoom = line('zoom', 'nav.actionZoom', [
    t(input.pointer === 'mouse' ? 'nav.gestureWheel' : 'nav.gesturePinch'),
  ]);
  return withSketch(
    [
      drag('orbit', 'nav.actionOrbit', scheme.orbit),
      drag('pan', 'nav.actionPan', scheme.pan),
      zoom,
    ].filter((candidate): candidate is HintLine => candidate !== null),
    input,
    t,
  );
}

/**
 * A sketch changes what a turn means, and the cube is where that is learnt: the
 * rule is added to the hint of the cube, which is the only hint shown while a
 * sketch is open. It sits under a rule of its own, apart from the gestures, and
 * carries the icon of the sketch wherever it is mentioned.
 */
function withSketch(lines: HintLine[], input: HintInput, t: Translate): HintLine[] {
  if (!input.sketching) return lines;
  return [
    ...lines,
    { id: 'sketch-divider', text: '', divider: true },
    { id: 'sketch-heading', text: t('nav.hintSketch'), heading: true, icon: 'sketch' },
    { id: 'sketch-rule', text: t('nav.hintSketchPans') },
  ];
}
