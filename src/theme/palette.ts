export const palette = {
  light: {
    bg: '#F7F2EA',
    elevated: '#FBF8F3',
    ink: '#2A2A2A',
    soft: '#5C564E',
    faint: '#8A847A',
    line: '#E6DCCE',
    accent: '#E8A838',
    accentText: '#2A2A2A',
    accentSoft: '#F3E2BC',
    chip: '#EFE6D8',
    good: '#1E6A45',
    goodSoft: '#E4F2E9',
    bad: '#9C2F2F',
    badSoft: '#F8E6E3',
  },
  dark: {
    bg: '#2A2A2A',
    elevated: '#353330',
    ink: '#F7F2EA',
    soft: '#D9D0C4',
    faint: '#A39A90',
    line: '#45403A',
    accent: '#E8A838',
    accentText: '#2A2A2A',
    accentSoft: '#4A3A1E',
    chip: '#3A3632',
    good: '#9ED7B8',
    goodSoft: '#1A2C23',
    bad: '#F0B2AA',
    badSoft: '#3A2422',
  },
} as const;

export type Palette = { [Key in keyof typeof palette.light]: string };
export type ThemePreference = 'system' | 'light' | 'dark';
export type ColorScheme = 'light' | 'dark';

export const Fonts = {
  display: 'Inter_700Bold',
  displayItalic: 'Inter_400Regular_Italic',
  body: 'Inter_400Regular',
  bodyItalic: 'Inter_400Regular_Italic',
  bodySemi: 'Inter_600SemiBold',
  ui: 'Inter_400Regular',
  uiMedium: 'Inter_500Medium',
  uiSemi: 'Inter_600SemiBold',
} as const;
