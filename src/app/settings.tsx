import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { PaywallSheet } from '@/components/paywall-sheet';
import { AppText, Button, IconButton, Note, Screen, Segmented } from '@/components/ui';
import { PRIVACY_POLICY_URL } from '@/lib/ads/ad-config';
import { useAds } from '@/lib/ads/ads-context';
import { useEntitlement } from '@/lib/entitlement';
import { useAppTheme } from '@/theme/preferences';
import type { ThemePreference } from '@/theme/palette';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const NETWORK_NOTE =
  'Your saved articles never leave your device. DigestLocal has no account and no cloud library. When you save a page, the app downloads that page and its images once. Reading, listening, summaries, and quizzes use the copy on this device and do not download images again.\n\nAds are loaded from Google AdMob and never receive your article text, saved links, or quiz results. We request non-personalized ads by default. Pro removes ads entirely, so no ad network is contacted.';

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, preference, setPreference } = useAppTheme();
  const { isPro, setPro, billing } = useEntitlement();
  const ads = useAds();
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const [billingAvailable, setBillingAvailable] = useState(false);
  const [price, setPrice] = useState<string | null>(null);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [restoreNote, setRestoreNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    billing
      .isAvailable()
      .then((available) => {
        if (!cancelled) setBillingAvailable(available);
        return available ? billing.getProPrice() : null;
      })
      .then((nextPrice) => {
        if (!cancelled) setPrice(nextPrice);
      })
      .catch(() => {
        if (!cancelled) setBillingAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [billing]);

  useEffect(() => {
    if (!isPro && !ads.adFree && ads.canOfferRewarded('ad_free')) ads.preloadRewarded();
  }, [ads, isPro]);

  const openPrivacyPolicy = () => {
    void WebBrowser.openBrowserAsync(PRIVACY_POLICY_URL);
  };

  const adFreeLabel = ads.adFreeUntil
    ? `Ad-free until ${new Date(ads.adFreeUntil).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })}`
    : null;

  const showPaywall = ads.config.paywallEnabled && billingAvailable && !isPro;
  const showPrivacyChoices = ads.ready && !isPro;

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
            Privacy & ads
          </AppText>
          <Note kicker="Network & privacy" body={NETWORK_NOTE} />
          <Button label="Privacy policy" variant="secondary" onPress={openPrivacyPolicy} />
          {showPrivacyChoices ? (
            <Button
              label={ads.privacyOptionsRequired ? 'Privacy options' : 'Ad privacy choices'}
              variant="secondary"
              onPress={() => void ads.showPrivacyOptions()}
            />
          ) : null}

          {isPro ? (
            <AppText variant="ui" color={colors.ink}>
              Pro: ads removed. Thank you!
            </AppText>
          ) : showPaywall ? (
            <Button label="Remove ads (Pro)" onPress={() => setPaywallOpen(true)} />
          ) : (
            <View style={[styles.row, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
              <AppText variant="uiMedium">Remove ads (Pro)</AppText>
              <AppText variant="meta" color={colors.faint}>
                Coming soon. Meanwhile you can take a 24-hour break from ads.
              </AppText>
            </View>
          )}

          {!isPro && ads.adFree && adFreeLabel ? (
            <AppText variant="ui" color={colors.soft}>
              {adFreeLabel}
            </AppText>
          ) : null}
          {!isPro && !ads.adFree ? (
            <View style={[styles.row, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
              <AppText variant="uiMedium">Take a break from ads</AppText>
              <AppText variant="meta" color={colors.faint}>
                Watch one short ad to turn off banners and full-screen ads for 24 hours.
              </AppText>
              <Button
                label={ads.canOfferRewarded('ad_free') && ads.rewardedLoaded ? 'Watch ad' : ads.canOfferRewarded('ad_free') ? 'Ad not ready' : 'Not available right now'}
                variant="secondary"
                disabled={!ads.canOfferRewarded('ad_free') || !ads.rewardedLoaded}
                onPress={() => void ads.showRewarded('ad_free')}
              />
            </View>
          ) : null}
          {restoreNote ? (
            <AppText variant="meta" color={colors.soft}>
              {restoreNote}
            </AppText>
          ) : null}
        </View>

        {__DEV__ ? (
          <View style={styles.block}>
            <AppText variant="label" color={colors.faint}>
              Developer
            </AppText>
            <Button label={isPro ? 'Dev: toggle Pro (on)' : 'Dev: toggle Pro'} variant="secondary" onPress={() => void setPro(!isPro)} />
            <Button label="Dev: reset ad counters" variant="secondary" onPress={() => void ads.resetAdCounters()} />
            <Button
              label="Dev: show consent form (debug geography EEA)"
              variant="secondary"
              onPress={() => void ads.showConsentDebug()}
            />
          </View>
        ) : null}

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
            Version {version} · No account · No cloud library · Articles stay on this device
          </AppText>
        </View>
      </ScrollView>
      <PaywallSheet
        visible={paywallOpen}
        price={price}
        onClose={() => setPaywallOpen(false)}
        onBuy={() => {
          void billing.purchasePro().then((result) => {
            if (result === 'purchased') {
              void setPro(true);
              setPaywallOpen(false);
            }
          });
        }}
        onRestore={() => {
          void billing.restore().then((owned) => {
            if (owned) {
              void setPro(true);
              setPaywallOpen(false);
              setRestoreNote('Pro restored on this device.');
              return;
            }
            setRestoreNote('No purchase was found on this device.');
          });
        }}
        onAdFree={() => {
          setPaywallOpen(false);
          void ads.showRewarded('ad_free');
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 12, paddingBottom: 48, gap: 18 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  block: { gap: 10 },
  row: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
});
