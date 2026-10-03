/**
 * Design tokens — DESIGN.md ("Executive Campaign Operations").
 *
 * Key names follow the starter's BNA UI contract (`useColor('primary')` etc.)
 * so every vendored component keeps working. Extra tokens (surface tiers,
 * fixed/container chips) exist so screens can render the `stich_ui/` mocks
 * without hard-coding hex values.
 */
const lightColors = {
  // Base — Light canvas #F6F7FB / ink #0F1222
  background: '#F6F7FB',
  foreground: '#0F1222',

  // Cards — crisp white over the slate canvas
  card: '#FFFFFF',
  cardForeground: '#0F1222',

  popover: '#FFFFFF',
  popoverForeground: '#0F1222',

  // Primary — Deep Indigo
  primary: '#3B2FD6',
  primaryForeground: '#FFFFFF',

  // Secondary — indigo-tinted surface (secondary buttons, tints)
  secondary: '#ECECFF',
  secondaryForeground: '#0F1222',

  muted: 'rgba(91, 97, 120, 0.12)',
  mutedForeground: '#5B6178',

  accent: '#F3F2FF',
  accentForeground: '#0F1222',

  destructive: '#DC2626',
  destructiveForeground: '#FFFFFF',

  // Hairline boundaries
  border: '#E4E7F0',
  input: '#E4E7F0',
  ring: '#3B2FD6',

  text: '#0F1222',
  textMuted: '#5B6178',

  tint: '#3B2FD6',
  icon: '#5B6178',
  tabIconDefault: '#5B6178',
  tabIconSelected: '#3B2FD6',

  // Functional accents — DESIGN.md §Colors
  blue: '#0EA5E9',
  green: '#16A34A',
  red: '#DC2626',
  orange: '#F5A524',
  yellow: '#F59E0B',
  pink: '#DB2777',
  purple: '#7C3AED',
  teal: '#14B8A6',
  indigo: '#3B2FD6',

  // Semantic states
  //
  // `success` is darkened from #16A34A for the light theme only: paired with a
  // white foreground it measured 3.3:1, under the 4.5:1 WCAG AA floor for the
  // 14–15px text in Chip and Badge. #15803D measures 5.0:1 on white and is
  // still recognisably the same green. The dark theme below keeps the brighter
  // #16A34A, which is the right choice against a dark surface.
  success: '#15803D',
  successForeground: '#FFFFFF',
  warning: '#F59E0B',
  warningForeground: '#1A1200',
  info: '#0EA5E9',
  infoForeground: '#04283A',
  error: '#DC2626',
  errorForeground: '#FFFFFF',

  // Surface tiers (DESIGN.md front-matter) — overlays & nested containers
  surfaceContainerLowest: '#FFFFFF',
  surfaceContainerLow: '#F3F2FF',
  surfaceContainer: '#ECECFF',
  surfaceContainerHigh: '#E5E6FE',
  surfaceContainerHighest: '#E0E1F8',

  // Outlines
  outline: '#777587',
  outlineVariant: '#C7C4D8',

  // Inverse (tooltips, snackbar surfaces)
  inverseSurface: '#2D2F41',
  inverseOnSurface: '#F0EFFF',

  // Pastel chips — identical in light & dark, they carry their own ink
  primaryFixed: '#E2DFFF',
  onPrimaryFixed: '#2100BD',
  secondaryFixed: '#FFDDB5',
  onSecondaryFixed: '#6C4400',
  tertiaryFixed: '#C9E6FF',
  onTertiaryFixed: '#003C58',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#93000A',
  secondaryContainer: '#FFAD2E',
  onSecondaryContainer: '#6C4400',

  // Indigo fills — bars, pills, progress rails
  primaryContainer: '#3B2FD6',
  onPrimaryContainer: '#FFFFFF',
  tertiary: '#003C58',
  tertiaryContainer: '#00547A',
  onTertiaryContainer: '#79C9FF',
};

const darkColors = {
  // Base — obsidian #0B0D14
  background: '#0B0D14',
  foreground: '#F2F4FA',

  card: '#141824',
  cardForeground: '#F2F4FA',

  popover: '#171B29',
  popoverForeground: '#F2F4FA',

  // Lifted indigo so links/icons stay legible on obsidian
  primary: '#6E63FF',
  primaryForeground: '#0B0D14',

  secondary: '#1C2130',
  secondaryForeground: '#F2F4FA',

  muted: 'rgba(154, 162, 188, 0.16)',
  mutedForeground: '#9AA2BC',

  accent: '#1C2130',
  accentForeground: '#F2F4FA',

  destructive: '#EF4444',
  destructiveForeground: '#FFFFFF',

  border: '#262C3F',
  input: '#262C3F',
  ring: '#6E63FF',

  text: '#F2F4FA',
  textMuted: '#9AA2BC',

  tint: '#6E63FF',
  icon: '#9AA2BC',
  tabIconDefault: '#9AA2BC',
  tabIconSelected: '#6E63FF',

  blue: '#38BDF8',
  green: '#22C55E',
  red: '#EF4444',
  orange: '#F5A524',
  yellow: '#F59E0B',
  pink: '#F472B6',
  purple: '#A78BFA',
  teal: '#2DD4BF',
  indigo: '#6E63FF',

  success: '#16A34A',
  successForeground: '#FFFFFF',
  warning: '#F59E0B',
  warningForeground: '#1A1200',
  info: '#0EA5E9',
  infoForeground: '#04283A',
  error: '#DC2626',
  errorForeground: '#FFFFFF',

  surfaceContainerLowest: '#171B29',
  surfaceContainerLow: '#1A1F2E',
  surfaceContainer: '#1E2434',
  surfaceContainerHigh: '#252B3D',
  surfaceContainerHighest: '#2C3347',

  outline: '#9AA2BC',
  outlineVariant: '#262C3F',

  inverseSurface: '#E0E1F8',
  inverseOnSurface: '#181B2B',

  primaryFixed: '#E2DFFF',
  onPrimaryFixed: '#2100BD',
  secondaryFixed: '#FFDDB5',
  onSecondaryFixed: '#6C4400',
  tertiaryFixed: '#C9E6FF',
  onTertiaryFixed: '#003C58',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#93000A',
  secondaryContainer: '#FFAD2E',
  onSecondaryContainer: '#6C4400',

  primaryContainer: '#6E63FF',
  onPrimaryContainer: '#FFFFFF',
  tertiary: '#79C9FF',
  tertiaryContainer: '#00547A',
  onTertiaryContainer: '#79C9FF',
};

export const Colors = {
  light: lightColors,
  dark: darkColors,
};

export { darkColors, lightColors };
export type ColorKeys = keyof typeof lightColors;

/** Fixed brand gradient used by the dashboard hero card (both modes). */
export const BRAND_GRADIENT = ['#3B2FD6', '#2F24B8', '#2100BD'] as const;

/** Categorical palette for donut / chart segments (accessible on both modes). */
export const CHART_COLORS = [
  '#3B2FD6',
  '#00547A',
  '#F5A524',
  '#835400',
  '#777587',
  '#16A34A',
  '#DB2777',
] as const;

export const withOpacity = (color: string, opacity: number) => {
  if (color.startsWith('rgba')) {
    return color;
  }

  if (color.startsWith('#')) {
    const hex = color.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

  return color;
};
