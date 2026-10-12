import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';

import { PaywallSheet } from '@/components/paywall-sheet';
import { AppText, Button, IconButton, Note, Screen, Segmented } from '@/components/ui';
import { PRIVACY_POLICY_URL, SUPPORT_EMAIL } from '@/lib/ads/ad-config';
import { formatAdFreeRemaining } from '@/lib/ads/ad-policy';
import { AD_PLACEMENTS } from '@/lib/ads/ad-units';
import { useAds, type AdsContextValue } from '@/lib/ads/ads-context';
import { isTestAdsMode } from '@/lib/ads/ads-mode';
import { useEntitlement } from '@/lib/entitlement';
import { useAppTheme } from '@/theme/preferences';
import type { ThemePreference } from '@/theme/palette';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const NETWORK_NOTE =
  'Your saved articles never leave your device. DigestLocal has no account and no cloud library. When you save a page, the app downloads that page and its images once. Reading, listening, summaries, and quizzes use the copy on this device and do not download images again.\n\nAds are loaded from Google AdMob and never receive your article text, saved links, or quiz results. We request non-personalized ads by default.';

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, preference, setPreference } = useAppTheme();
  const { isPro, proEnabled, setPro, billing } = useEntitlement();
  const ads = useAds();
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const [billingAvailable, setBillingAvailable] = useState(false);
  const [price, setPrice] = useState<string | null>(null);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [restoreNote, setRestoreNote] = useState<string | null>(null);
  const [debugNow, setDebugNow] = useState(() => Date.now());

  useEffect(() => {
    if (!proEnabled) return;
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
  }, [billing, proEnabled]);

  useEffect(() => {
    if (!isPro && ads.canOfferRewarded('ad_free')) ads.preloadRewarded();
  }, [ads, isPro]);

  useEffect(() => {
    if (!isTestAdsMode() && !ads.adFree) return;
    const id = setInterval(() => setDebugNow(Date.now()), isTestAdsMode() ? 1000 : 30_000);
    return () => clearInterval(id);
  }, [ads.adFree]);

  const openPrivacyPolicy = () => {
    void WebBrowser.openBrowserAsync(PRIVACY_POLICY_URL);
  };

  const openSupport = () => {
    void Linking.openURL(`mailto:${SUPPORT_EMAIL}`);
  };

  const adFreeLabel = ads.adFree && ads.adFreeUntil ? formatAdFreeRemaining(ads.adFreeUntil, debugNow) : null;
  const adFreeReady = ads.canOfferRewarded('ad_free') && ads.rewardedLoaded;

  const showPaywall = proEnabled && ads.config.paywallEnabled && billingAvailable && !isPro;
  const showPrivacyChoices = !isPro && (ads.privacyOptionsRequired || ads.ready);

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
          <Button label={`Email ${SUPPORT_EMAIL}`} variant="secondary" onPress={openSupport} />
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
          ) : null}
          {showPaywall ? <Button label="Remove ads (Pro)" onPress={() => setPaywallOpen(true)} /> : null}

          {!isPro ? (
            <View style={[styles.row, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
              <AppText variant="uiMedium">Take a break from ads</AppText>
              <AppText variant="meta" color={colors.faint}>
                One short ad turns off banners and full-screen ads for 1 hour. Hours stack up to 3, and you can take 6 breaks each day.
              </AppText>
              {adFreeLabel ? (
                <AppText variant="ui" color={colors.soft}>
                  Ad-free: {adFreeLabel}
                </AppText>
              ) : null}
              <Button
                label="Watch a short ad for 1 hour ad-free"
                variant="secondary"
                disabled={!adFreeReady}
                onPress={() => void ads.showRewarded('ad_free')}
              />
              {!ads.canOfferRewarded('ad_free') ? (
                <AppText variant="meta" color={colors.faint}>
                  Not available right now
                </AppText>
              ) : !ads.rewardedLoaded ? (
                <AppText variant="meta" color={colors.faint}>
                  Ad not ready
                </AppText>
              ) : null}
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
            {proEnabled ? (
              <Button label={isPro ? 'Dev: toggle Pro (on)' : 'Dev: toggle Pro'} variant="secondary" onPress={() => void setPro(!isPro)} />
            ) : null}
            <Button
              label="Dev: show consent form (debug geography EEA)"
              variant="secondary"
              onPress={() => void ads.showConsentDebug()}
            />
          </View>
        ) : null}

        {isTestAdsMode() ? (
          <View style={styles.block}>
            <AppText variant="label" color={colors.faint}>
              Ads status
            </AppText>
            <AppText variant="meta" color={colors.soft}>
              {adsStatusText(ads, debugNow)}
            </AppText>
            <Button label="Reset ad counters" variant="secondary" onPress={() => void ads.resetAdCounters()} />
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
      {proEnabled ? (
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
      ) : null}
    </Screen>
  );
}

function initStatusLabel(status: AdsContextValue['initStatus']): string {
  if (status === 'retry-on-foreground') return 'retries when the app returns to the foreground';
  if (status === 'ready') return 'ready';
  if (status === 'running') return 'starting';
  return 'not started';
}

function adFreeReadout(ads: AdsContextValue, now: number): string {
  const passes = `${ads.adFreePassesToday}/${ads.config.adFreePassPerDay} passes today`;
  if (ads.adFreeUntil == null) return `inactive (${passes})`;
  if (ads.adFreeUntil > now) {
    const left = formatAdFreeRemaining(ads.adFreeUntil, now) ?? 'active';
    return `${left}, stack cap ${ads.config.adFreePassMaxHours}h (${passes})`;
  }
  const holdUntil = ads.adFreeUntil + ads.config.afterAdFreeCooldownSec * 1000;
  if (holdUntil > now) {
    const seconds = Math.ceil((holdUntil - now) / 1000);
    return `expired, interstitial hold ${seconds}s (${passes})`;
  }
  return `inactive (${passes})`;
}

function extraSpeedsLabel(ads: AdsContextValue): string {
  if (ads.isPro) return 'unlocked';
  if (ads.extraSpeedsUntil != null && ads.extraSpeedsUntil > Date.now()) {
    return `unlocked until ${new Date(ads.extraSpeedsUntil).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })}`;
  }
  return 'locked (1.5× and 2×)';
}

function adsStatusText(ads: AdsContextValue, now: number): string {
  const seconds =
    ads.sessionStartedAt == null ? 0 : Math.max(0, Math.floor((now - ads.sessionStartedAt) / 1000));
  const lastInterstitial =
    ads.lastFullscreenAt == null
      ? 'none'
      : new Date(ads.lastFullscreenAt).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
  const units = AD_PLACEMENTS.map((placement) => `${placement}: ${ads.unitId(placement) ?? 'off'}`).join('\n');
  return [
    `Initialized: ${ads.ready ? 'yes' : 'no'} (${initStatusLabel(ads.initStatus)})`,
    `Consent: ${ads.consentStatus} (canRequestAds: ${ads.canRequestAds ? 'yes' : 'no'})`,
    `Session: ${ads.sessionCount} · ${seconds}s into this session (each cold start is a new session)`,
    `Save counter: ${ads.saveInterstitialCounter} (counts saves from session ${ads.config.minSessionForInterstitial})`,
    `Last interstitial: ${lastInterstitial}`,
    `Today's interstitials: ${ads.fullscreenTodayCount}`,
    `Interstitial load: ${ads.interstitialLoadState}`,
    `Rewarded load: ${ads.rewardedLoadState}`,
    `Quiz free questions: ${ads.config.quizFreeQuestionCap}`,
    `Ad-free: ${adFreeReadout(ads, now)}`,
    `Quiz rewards today: ${ads.quizRewardsToday}/${ads.config.quizUnlockPerDay}`,
    `Quiz offers: ${ads.quizOffersShown} shown, ${ads.quizOffersAccepted} accepted`,
    `Extra speeds: ${extraSpeedsLabel(ads)}`,
    `Last ad error: ${ads.lastLoadError ?? 'none'}`,
    `Last decision: ${ads.lastDecision}`,
    'Unit IDs:',
    units,
  ].join('\n');
}

const styles = StyleSheet.create({
  content: { paddingTop: 12, paddingBottom: 48, gap: 18 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  block: { gap: 10 },
  row: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
});
