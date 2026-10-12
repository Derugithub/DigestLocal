import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { adRequestOptions } from '@/lib/ads/ad-config';
import { fullscreenReloadDelayMs } from '@/lib/ads/ad-policy';
import { useAds } from '@/lib/ads/ads-context';
import type { AdPlacement, BannerSizeName } from '@/lib/ads/ad-units';
import { loadGoogleMobileAds } from '@/lib/ads/native-ads';
import { AppText } from '@/components/ui';
import { useAppTheme } from '@/theme/preferences';

/**
 * Banner wrapper. Renders nothing unless the central policy allows the placement.
 * The Google Mobile Ads module is required only after that check.
 * A failed load hides the ad and tries again with backoff, instead of staying hidden.
 */
export function AdBanner({
  placement,
  size,
  width,
}: {
  placement: 'shelf_banner' | 'article_end_banner';
  size: BannerSizeName;
  width?: number;
}) {
  const ads = useAds();
  const allowed = ads.canShowPlacement(placement) && !ads.suppressed;
  const unitId = allowed ? ads.unitId(placement) : null;
  if (!allowed || !unitId) return null;
  return <NativeBanner placement={placement} size={size} unitId={unitId} width={width} />;
}

function NativeBanner({
  placement,
  size,
  unitId,
  width,
}: {
  placement: AdPlacement;
  size: BannerSizeName;
  unitId: string;
  width?: number;
}) {
  const { colors } = useAppTheme();
  const ads = useAds();
  const [attempt, setAttempt] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const native = loadGoogleMobileAds();
  const BannerAd = native.BannerAd;
  const bannerSize = native.BannerAdSize[size];

  useEffect(() => {
    if (!waiting) return;
    const delay = fullscreenReloadDelayMs(attempt);
    const id = setTimeout(() => {
      setWaiting(false);
      setAttempt((value) => value + 1);
    }, delay);
    return () => clearTimeout(id);
  }, [attempt, waiting]);

  if (ads.isPro || ads.adFree || ads.suppressed) return null;

  return (
    <View style={styles.slot}>
      <AppText variant="label" color={colors.faint} style={styles.label}>
        Advertisement
      </AppText>
      <View style={[styles.divider, { backgroundColor: colors.line }]} />
      {waiting ? null : (
        <BannerAd
          key={`${unitId}-${attempt}`}
          unitId={unitId}
          size={bannerSize}
          width={width}
          maxHeight={placement === 'article_end_banner' ? 250 : undefined}
          requestOptions={adRequestOptions(ads.config)}
          onAdFailedToLoad={(error) => {
            setWaiting(true);
            ads.recordAdLoadError(error);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { gap: 8 },
  label: { paddingHorizontal: 22 },
  divider: { height: StyleSheet.hairlineWidth, width: '100%' },
});
