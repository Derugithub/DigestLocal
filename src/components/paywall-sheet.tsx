import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
 * Extra speeds can also be unlocked for 24 hours with a rewarded ad. They are not sold in this build.
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
  const insets = useSafeAreaInsets();
  const priceLabel = price ? `Get Pro, ${price}` : 'Get Pro';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}>
      <View style={[styles.backdrop, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
        {/* The sheet keeps its height on phones; a short window (landscape) caps it and lets it scroll. */}
        <ScrollView
          style={[styles.sheet, { backgroundColor: colors.bg, borderColor: colors.line }]}
          contentContainerStyle={[styles.sheetContent, { paddingBottom: 28 + insets.bottom }]}
          bounces={false}>
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
          <Button label="Watch a short ad for 1 hour ad-free" variant="secondary" onPress={onAdFree} />
          <Button label="Restore purchase" variant="ghost" onPress={onRestore} />
          <AppText variant="meta" color={colors.faint}>
            One-time purchase via Google Play. No account needed. Restore on any device signed in to the same Google account.
          </AppText>
        </ScrollView>
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
    flexGrow: 0,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
  },
  sheetContent: {
    paddingHorizontal: 22,
    paddingTop: 18,
    gap: 14,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bullets: { gap: 6 },
});
