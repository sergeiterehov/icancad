import { useTranslation } from 'react-i18next';
import { ALT_KEY } from '../hooks/useShortcuts';
import { useUiStore } from '../stores/uiStore';
import { cameraScheme, type CameraScheme } from '../viewport/cameraControls';
import { cameraHintLines, type HintLine } from '../viewport/cameraHint';
import { inputProfile, resolvedPointerKind } from '../viewport/inputProfile';
import { SketchIcon } from './featureIcons';

/** The icon a hint line asks for, so the hint stays a table of text. */
function lineIcon(line: HintLine) {
  if (line.icon === 'sketch') return <SketchIcon size={12} />;
  return null;
}

/**
 * What the camera does with the input at hand, one gesture per line. The nav
 * cube shows it under an introduction; a scheme in the menu shows its own.
 */
export function CameraHint({
  scheme: given,
  intro = false,
}: {
  scheme?: CameraScheme;
  intro?: boolean;
}) {
  const { t } = useTranslation();
  const storedScheme = useUiStore((state) => state.cameraScheme);
  const preference = useUiStore((state) => state.inputPreference);
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const scheme = given ?? cameraScheme(storedScheme);
  const lines = cameraHintLines(
    scheme,
    {
      profile: inputProfile(preference),
      pointer: resolvedPointerKind(preference),
      altLabel: ALT_KEY,
      // Only the cube is read while a sketch is open, so only its hint carries
      // the rule that a facing view pans instead of turning.
      sketching: intro && activeSketchId !== null,
    },
    (key) => t(key as never),
  );
  return (
    <span className="tooltip-stack">
      {intro && <span className="tooltip-stack-heading">{t('nav.hintOperations')}</span>}
      {lines.map((line) =>
        line.divider ? (
          <span key={line.id} className="tooltip-stack-divider" role="presentation" />
        ) : (
          <span key={line.id} className={line.heading ? 'tooltip-stack-heading' : undefined}>
            {lineIcon(line)}
            {line.text}
          </span>
        ),
      )}
    </span>
  );
}
