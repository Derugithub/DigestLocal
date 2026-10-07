import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import Storage from 'expo-sqlite/kv-store';

import { palette, type ColorScheme, type Palette, type ThemePreference } from '@/theme/palette';

export const THEME_KEY = 'digestlocal.theme';

type ThemeContextValue = {
  preference: ThemePreference;
  scheme: ColorScheme;
  colors: Palette;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function ThemePreferenceProvider({
  preference,
  onChange,
  children,
}: {
  preference: ThemePreference;
  onChange: (preference: ThemePreference) => void;
  children: ReactNode;
}) {
  const system = useColorScheme();
  const scheme: ColorScheme = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;

  useEffect(() => {
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  }, [preference]);

  const setPreference = (next: ThemePreference) => {
    onChange(next);
    Storage.setItem(THEME_KEY, next).catch(() => {
      // The in-memory choice still applies for this session if storage is unavailable.
    });
  };

  return (
    <ThemeContext.Provider value={{ preference, scheme, colors: palette[scheme], setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useAppTheme must be used within ThemePreferenceProvider');
  return value;
}
