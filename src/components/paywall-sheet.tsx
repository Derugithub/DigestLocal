import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import { useAppTheme } from '@/theme/preferences';

const BULLETS = [
  'No ads, no ad SDK',
  'All 8 quiz questions, fresh sets anytime',
  'Extra listening speeds',
  'Pay once, yours forever',
];

/**
 * Variant A from the monetization plan. Shown only when paywallEnabled and billing is available.
 * Fresh question sets and extra speeds are listed as planned; they are not sold in this build.
 */
export function PaywallSheet({
  visible,
  price,
  onClose,
  onBuy,
  onRestore,
  onAdFree,
}: {
  visible: boolean;
  price: string | null;
  onClose: () => void;
  onBuy: () => void;
  onRestore: () => void;
  onAdFree: () => void;
}) {
  const { colors } = useAppTheme();
  const priceLabel = price ? `Get Pro, ${price}` : 'Get Pro';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.bg, borderColor: colors.line }]}>
          <View style={styles.header}>
            <AppText variant="label" color={colors.accent}>
              DigestLocal Pro
            </AppText>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={10}>
              <AppText variant="uiMedium">Close</AppText>
            </Pressable>
          </View>
          <AppText variant="title">Go fully local.</AppText>
          <AppText variant="ui" color={colors.soft}>
            Pro removes ads, so the app never contacts an ad network.
          </AppText>
          <View style={styles.bullets}>
            {BULLETS.map((bullet) => (
              <AppText key={bullet} variant="ui" color={colors.ink}>
                • {bullet}
              </AppText>
            ))}
          </View>
          <Button label={priceLabel} onPress={onBuy} />
          <Button label="Watch an ad for 24 h ad-free" variant="secondary" onPress={onAdFree} />
          <Button label="Restore purchase" variant="ghost" onPress={onRestore} />
          <AppText variant="meta" color={colors.faint}>
            One-time purchase via Google Play. No account needed. Restore on any device signed in to the same Google account.
          </AppText>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(42, 42, 42, 0.35)',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 14,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bullets: { gap: 6 },
});
