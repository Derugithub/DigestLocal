import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText, IconButton, Note, Screen, Segmented } from '@/components/ui';
import { useAppTheme } from '@/theme/preferences';
import type { ThemePreference } from '@/theme/palette';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, preference, setPreference } = useAppTheme();
  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.top}>
          <IconButton icon="chevron-back" label="Back to shelf" onPress={() => router.back()} />
          <AppText variant="label" color={colors.accent}>
            Settings
          </AppText>
        </View>
        <AppText variant="title">Preferences</AppText>

        <View style={styles.block}>
          <AppText variant="label" color={colors.faint}>
            Theme
          </AppText>
          <Segmented value={preference} options={THEME_OPTIONS} onChange={setPreference} />
          <AppText variant="meta" color={colors.faint}>
            System follows this device. Light and dark stay on until you change them.
          </AppText>
        </View>

        <View style={styles.block}>
          <AppText variant="label" color={colors.faint}>
            Network
          </AppText>
          <Note
            kicker="One download"
            body="The only network use is the optional fetch when you save a new public page. DigestLocal does not sync, sign in, or send saved text anywhere. Reading, listening, summaries, and quizzes use the copy in the local SQLite database."
          />
        </View>

        <View style={styles.block}>
          <AppText variant="label" color={colors.faint}>
            About
          </AppText>
          <AppText variant="body" color={colors.ink}>
            DigestLocal is an offline reading shelf. Paste a URL, keep the article on this device, then read it, listen with the system voice, or generate a summary and quiz locally.
          </AppText>
          <AppText variant="ui" color={colors.soft}>
            Summaries and quizzes use the on-device heuristic-v2 engine. Questions ask what an idea means, why it matters, how ideas relate, and what the main points are. The engine does not call a language model. A later on-device model can replace it; the results stay in the article record.
          </AppText>
          <AppText variant="meta" color={colors.faint}>
            Version {version} · No account · No cloud library
          </AppText>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 12, paddingBottom: 48, gap: 18 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  block: { gap: 10 },
});
