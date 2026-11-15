import { useTranslation } from 'react-i18next';
import { ALT_KEY } from '../hooks/useShortcuts';
import { useUiStore } from '../stores/uiStore';
import { cameraScheme, type CameraScheme } from '../viewport/cameraControls';
import { cameraHintLines } from '../viewport/cameraHint';
import { inputProfile, resolvedPointerKind } from '../viewport/inputProfile';

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
  const scheme = given ?? cameraScheme(storedScheme);
  const lines = cameraHintLines(
    scheme,
    {
      profile: inputProfile(preference),
      pointer: resolvedPointerKind(preference),
      altLabel: ALT_KEY,
    },
    (key) => t(key as never),
  );
  return (
    <span className="tooltip-stack">
      {intro && <span>{t('nav.hintCube')}</span>}
      {lines.map((line) => (
        <span key={line.id}>{line.text}</span>
      ))}
      {intro && <span>{t('nav.hintMenu')}</span>}
    </span>
  );
}
