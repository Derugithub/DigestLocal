export const palette = {
  light: {
    bg: '#F4EFE6',
    elevated: '#FBF7F1',
    ink: '#1B1612',
    soft: '#5C534A',
    faint: '#8A7D70',
    line: '#E4D8C8',
    accent: '#C2412D',
    accentText: '#FFF8F3',
    accentSoft: '#F8E4DA',
    chip: '#E9DFD1',
    good: '#1E6A45',
    goodSoft: '#E4F2E9',
    bad: '#9C2F2F',
    badSoft: '#F8E6E3',
  },
  dark: {
    bg: '#13110F',
    elevated: '#1E1A16',
    ink: '#F6F1E8',
    soft: '#D2C4B2',
    faint: '#9A8C7C',
    line: '#342E28',
    accent: '#E38972',
    accentText: '#1B1612',
    accentSoft: '#3A2822',
    chip: '#2A241E',
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
  display: 'Fraunces_600SemiBold',
  displayItalic: 'Fraunces_600SemiBold_Italic',
  body: 'SourceSerif4_400Regular',
  bodyItalic: 'SourceSerif4_400Regular_Italic',
  bodySemi: 'SourceSerif4_600SemiBold',
  ui: 'Outfit_400Regular',
  uiMedium: 'Outfit_500Medium',
  uiSemi: 'Outfit_600SemiBold',
} as const;
