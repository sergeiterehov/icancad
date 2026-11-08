import { useEffect } from 'react';
import { useThemeStore } from '../stores/themeStore';

export function useApplyTheme(): void {
  const theme = useThemeStore((state) => state.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
}
