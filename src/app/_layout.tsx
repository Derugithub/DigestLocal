import '@/global.css';

import {
  Inter_400Regular,
  Inter_400Regular_Italic,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { ShareIntentProvider } from 'expo-share-intent';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { IncomingShare } from '@/components/incoming-share';
import { DatabaseProvider } from '@/lib/database';
import { isThemePreference, ThemePreferenceProvider, THEME_KEY, useAppTheme } from '@/theme/preferences';
import type { ThemePreference } from '@/theme/palette';
import Storage from 'expo-sqlite/kv-store';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_400Regular_Italic,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
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
    <ShareIntentProvider
      options={{
        // The default clears a share when Android pauses the activity on the way in.
        resetOnBackground: false,
        disabled: Platform.OS === 'web',
      }}>
      <ThemePreferenceProvider preference={preference} onChange={setPreference}>
        <DatabaseProvider>
          <ThemedNavigation />
        </DatabaseProvider>
      </ThemePreferenceProvider>
    </ShareIntentProvider>
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
      <IncomingShare />
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
