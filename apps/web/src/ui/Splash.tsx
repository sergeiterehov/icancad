import { useTranslation } from 'react-i18next';

export function Splash() {
  const { t } = useTranslation();
  return (
    <div className="splash">
      <div className="splash-mark">
        <span className="brand-mark large">IC</span>
        <span className="spinner" />
      </div>
      <p className="splash-caption">{t('splash.loading')}</p>
    </div>
  );
}
