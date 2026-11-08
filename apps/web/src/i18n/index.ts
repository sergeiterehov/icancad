import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ru from './locales/ru.json';

export const SUPPORTED_LOCALES = ['en', 'ru'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const STORAGE_KEY = 'icancad.locale';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}

function isLocale(value: string | null | undefined): value is Locale {
  return value === 'en' || value === 'ru';
}

export function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // localStorage can be unavailable in private mode.
  }
  const languages = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
  return languages.some((language) => language?.toLowerCase().startsWith('ru')) ? 'ru' : 'en';
}

export function applyLocaleToDocument(locale: Locale): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
}

export async function setLocale(locale: Locale): Promise<void> {
  await i18n.changeLanguage(locale);
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Ignore storage failures.
  }
  applyLocaleToDocument(locale);
}

export async function initI18n(): Promise<typeof i18n> {
  const locale = detectLocale();
  await i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      ru: { translation: ru },
    },
    lng: locale,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  applyLocaleToDocument(locale);
  return i18n;
}

export { i18n };
