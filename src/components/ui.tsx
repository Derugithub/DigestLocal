import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { renderFontChildren, systemFaceOverride, type FontWeight } from '@/theme/font-text';
import { useAppTheme } from '@/theme/preferences';
import { Fonts, type Palette } from '@/theme/palette';

const webPointer = Platform.OS === 'web' ? ({ cursor: 'pointer' } as const) : null;

export function Screen({
  children,
  style,
  padded = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={[styles.column, padded && styles.padded, style]}>{children}</View>
    </View>
  );
}

type TextVariant = 'display' | 'displayItalic' | 'title' | 'body' | 'bodySemi' | 'ui' | 'uiMedium' | 'label' | 'meta';

const variantStyle: Record<TextVariant, TextStyle> = {
  display: { fontFamily: Fonts.display, fontSize: 40, lineHeight: 46, letterSpacing: -0.5 },
  displayItalic: { fontFamily: Fonts.displayItalic, fontSize: 40, lineHeight: 46 },
  title: { fontFamily: Fonts.display, fontSize: 32, lineHeight: 38, letterSpacing: -0.3 },
  body: { fontFamily: Fonts.body, fontSize: 17, lineHeight: 26 },
  bodySemi: { fontFamily: Fonts.bodySemi, fontSize: 17, lineHeight: 26 },
  ui: { fontFamily: Fonts.ui, fontSize: 16, lineHeight: 22 },
  uiMedium: { fontFamily: Fonts.uiMedium, fontSize: 16, lineHeight: 22 },
  label: {
    fontFamily: Fonts.uiSemi,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  meta: { fontFamily: Fonts.ui, fontSize: 13, lineHeight: 18 },
};

const variantWeight: Record<TextVariant, FontWeight> = {
  display: '700',
  displayItalic: '400',
  title: '700',
  body: '400',
  bodySemi: '600',
  ui: '400',
  uiMedium: '500',
  label: '600',
  meta: '400',
};

export function AppText({
  children,
  variant = 'ui',
  color,
  style,
  ...rest
}: TextProps & {
  children?: ReactNode;
  variant?: TextVariant;
  color?: string;
}) {
  const { colors } = useAppTheme();
  const weight = variantWeight[variant];
  const only = typeof children === 'string' ? children : null;
  return (
    <Text
      {...rest}
      style={[variantStyle[variant], { color: color ?? colors.ink }, style, only ? systemFaceOverride(only, weight) : null]}>
      {renderFontChildren(children, weight)}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { colors } = useAppTheme();
  const palette = buttonPalette(colors, variant);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        webPointer,
        {
          backgroundColor: palette.background,
          borderColor: palette.border,
          opacity: disabled ? 0.45 : pressed ? 0.82 : 1,
        },
      ]}>
      {icon ? <Ionicons name={icon} size={18} color={palette.text} /> : null}
      <AppText variant="uiMedium" color={palette.text}>
        {label}
      </AppText>
    </Pressable>
  );
}

function buttonPalette(colors: Palette, variant: 'primary' | 'secondary' | 'ghost' | 'danger') {
  if (variant === 'primary') {
    return { background: colors.accent, border: colors.accent, text: colors.accentText };
  }
  if (variant === 'danger') {
    return { background: colors.badSoft, border: colors.badSoft, text: colors.bad };
  }
  if (variant === 'ghost') {
    return { background: 'transparent', border: 'transparent', text: colors.ink };
  }
  return { background: colors.elevated, border: colors.line, text: colors.ink };
}

export function IconButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        webPointer,
        { backgroundColor: colors.chip, opacity: pressed ? 0.7 : 1 },
      ]}>
      <Ionicons name={icon} size={20} color={colors.ink} />
    </Pressable>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.segment, { backgroundColor: colors.chip }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            style={[
              styles.segmentItem,
              webPointer,
              selected && { backgroundColor: colors.elevated, borderColor: colors.line },
            ]}>
            <AppText variant="uiMedium" color={selected ? colors.ink : colors.soft} style={styles.segmentLabel}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Note({
  kicker,
  body,
  active = false,
}: {
  kicker: string;
  body: string;
  active?: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <View
      style={[
        styles.note,
        {
          backgroundColor: active ? colors.accentSoft : colors.elevated,
          borderColor: active ? colors.accent : colors.line,
        },
      ]}>
      <AppText variant="label" color={active ? colors.accent : colors.faint}>
        {kicker}
      </AppText>
      <AppText variant="ui" color={colors.soft} style={styles.noteBody}>
        {body}
      </AppText>
    </View>
  );
}

export function LoadingState({ label }: { label: string }) {
  const { colors } = useAppTheme();
  return (
    <Screen>
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
        <AppText variant="ui" color={colors.soft}>
          {label}
        </AppText>
      </View>
    </Screen>
  );
}

export function ErrorState({ title, body }: { title: string; body: string }) {
  return (
    <Screen>
      <View style={styles.center}>
        <AppText variant="title">{title}</AppText>
        <AppText variant="ui" color={useAppTheme().colors.soft} style={styles.errorBody}>
          {body}
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  column: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  padded: { paddingHorizontal: 22 },
  button: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segment: {
    flexDirection: 'row',
    borderRadius: 16,
    padding: 4,
    gap: 4,
  },
  segmentItem: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  segmentLabel: { textAlign: 'center' },
  note: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 6,
  },
  noteBody: { lineHeight: 22 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 12 },
  errorBody: { textAlign: 'center' },
});
