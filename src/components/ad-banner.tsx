import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { adRequestOptions } from '@/lib/ads/ad-config';
import { useAds } from '@/lib/ads/ads-context';
import type { AdPlacement, BannerSizeName } from '@/lib/ads/ad-units';
import { loadGoogleMobileAds } from '@/lib/ads/native-ads';
import { AppText } from '@/components/ui';
import { useAppTheme } from '@/theme/preferences';

/**
 * Banner wrapper. Renders nothing unless the central policy allows the placement.
 * The Google Mobile Ads module is required only after that check.
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
  const [failed, setFailed] = useState(false);
  const native = loadGoogleMobileAds();
  const BannerAd = native.BannerAd;
  const bannerSize = native.BannerAdSize[size];

  if (failed || ads.isPro || ads.adFree || ads.suppressed) return null;

  return (
    <View style={styles.slot}>
      <AppText variant="label" color={colors.faint} style={styles.label}>
        Advertisement
      </AppText>
      <View style={[styles.divider, { backgroundColor: colors.line }]} />
      <BannerAd
        unitId={unitId}
        size={bannerSize}
        width={width}
        maxHeight={placement === 'article_end_banner' ? 250 : undefined}
        requestOptions={adRequestOptions(ads.config)}
        onAdFailedToLoad={() => setFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { gap: 8 },
  label: { paddingHorizontal: 22 },
  divider: { height: StyleSheet.hairlineWidth, width: '100%' },
});
