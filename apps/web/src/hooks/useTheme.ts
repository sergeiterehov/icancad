import { useEffect } from 'react';
import { useThemeStore, type Theme } from '../stores/themeStore';

// The browser paints its own window chrome, status bar and task switcher with
// this colour, so the app has to hand it the same background it paints itself.
const THEME_COLORS: Record<Theme, string> = {
  dark: '#111318',
  light: '#f4f5f7',
};

export function useApplyTheme(): void {
  const theme = useThemeStore((state) => state.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((meta) => meta.setAttribute('content', THEME_COLORS[theme]));
  }, [theme]);
}
