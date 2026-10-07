import '@/global.css';

import {
  Fraunces_600SemiBold,
  Fraunces_600SemiBold_Italic,
} from '@expo-google-fonts/fraunces';
import { Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold } from '@expo-google-fonts/outfit';
import {
  SourceSerif4_400Regular,
  SourceSerif4_400Regular_Italic,
  SourceSerif4_600SemiBold,
} from '@expo-google-fonts/source-serif-4';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';

import { DatabaseProvider } from '@/lib/database';
import { isThemePreference, ThemePreferenceProvider, THEME_KEY, useAppTheme } from '@/theme/preferences';
import type { ThemePreference } from '@/theme/palette';
import Storage from 'expo-sqlite/kv-store';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_600SemiBold_Italic,
    SourceSerif4_400Regular,
    SourceSerif4_400Regular_Italic,
    SourceSerif4_600SemiBold,
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
  });
  const [preference, setPreference] = useState<ThemePreference>('system');
  const [preferenceReady, setPreferenceReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) setPreferenceReady(true);
    }, 2500);
    Storage.getItem(THEME_KEY)
      .then((value) => {
        if (!cancelled && isThemePreference(value)) setPreference(value);
      })
      .catch(() => undefined)
      .finally(() => {
        if (cancelled) return;
        clearTimeout(timer);
        setPreferenceReady(true);
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if ((fontsLoaded || fontError) && preferenceReady) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontsLoaded, fontError, preferenceReady]);

  if ((!fontsLoaded && !fontError) || !preferenceReady) return null;

  return (
    <ThemePreferenceProvider preference={preference} onChange={setPreference}>
      <DatabaseProvider>
        <ThemedNavigation />
      </DatabaseProvider>
    </ThemePreferenceProvider>
  );
}

function ThemedNavigation() {
  const { colors, scheme } = useAppTheme();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.bg).catch(() => undefined);
  }, [colors.bg]);

  return (
    <ThemeProvider
      value={{
        ...base,
        colors: {
          ...base.colors,
          background: colors.bg,
          card: colors.bg,
          text: colors.ink,
          border: colors.line,
          primary: colors.accent,
        },
      }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: 'slide_from_right',
        }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="add" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="settings" />
        <Stack.Screen name="article/[id]" />
      </Stack>
    </ThemeProvider>
  );
}
