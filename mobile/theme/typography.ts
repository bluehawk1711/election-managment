import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import {
  NotoSansDevanagari_400Regular,
  NotoSansDevanagari_500Medium,
  NotoSansDevanagari_600SemiBold,
  NotoSansDevanagari_700Bold,
} from '@expo-google-fonts/noto-sans-devanagari';
import type { TextStyle } from 'react-native';

/** Passed straight to `useFonts` from expo-font in the root layout. */
export const FONT_ASSETS = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  NotoSansDevanagari_400Regular,
  NotoSansDevanagari_500Medium,
  NotoSansDevanagari_600SemiBold,
  NotoSansDevanagari_700Bold,
};

export type FontWeightName = 'regular' | 'medium' | 'semibold' | 'bold';

const INTER: Record<FontWeightName, string> = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
};

const NOTO: Record<FontWeightName, string> = {
  regular: 'NotoSansDevanagari_400Regular',
  medium: 'NotoSansDevanagari_500Medium',
  semibold: 'NotoSansDevanagari_600SemiBold',
  bold: 'NotoSansDevanagari_700Bold',
};

/** Devanagari needs a touch more leading than Latin at the same size. */
const HI_LINE_HEIGHT_FACTOR = 1.12;

export function isHindi(lang?: string | null): boolean {
  return (lang ?? '').toLowerCase().startsWith('hi');
}

export function fontFamilyFor(
  weight: FontWeightName,
  lang?: string | null
): string {
  return (isHindi(lang) ? NOTO : INTER)[weight];
}

/** Type scale — DESIGN.md §Typography. `letterSpacing` converted from em. */
export const TYPE = {
  headlineXl: { fontSize: 32, lineHeight: 40, letterSpacing: -0.8, weight: 'semibold' },
  headlineXlMobile: { fontSize: 26, lineHeight: 32, letterSpacing: -0.52, weight: 'semibold' },
  headlineLg: { fontSize: 24, lineHeight: 32, letterSpacing: -0.48, weight: 'semibold' },
  headlineMd: { fontSize: 20, lineHeight: 28, letterSpacing: -0.3, weight: 'semibold' },
  headlineSm: { fontSize: 16, lineHeight: 24, letterSpacing: -0.16, weight: 'semibold' },
  bodyLg: { fontSize: 16, lineHeight: 24, letterSpacing: 0, weight: 'regular' },
  bodyMd: { fontSize: 14, lineHeight: 20, letterSpacing: 0, weight: 'regular' },
  bodySm: { fontSize: 12, lineHeight: 16, letterSpacing: 0.06, weight: 'regular' },
  labelLg: { fontSize: 14, lineHeight: 20, letterSpacing: 0.07, weight: 'medium' },
  labelMd: { fontSize: 12, lineHeight: 16, letterSpacing: 0.12, weight: 'medium' },
  labelSm: { fontSize: 10, lineHeight: 14, letterSpacing: 0.4, weight: 'semibold' },
  metric: { fontSize: 20, lineHeight: 24, letterSpacing: -0.4, weight: 'semibold' },
} as const satisfies Record<
  string,
  {
    fontSize: number;
    lineHeight: number;
    letterSpacing: number;
    weight: FontWeightName;
  }
>;

export type TypeKey = keyof typeof TYPE;

/** Resolved text style for a scale step in the given language. */
export function typeStyle(key: TypeKey, lang?: string | null): TextStyle {
  const step = TYPE[key];
  return {
    fontFamily: fontFamilyFor(step.weight, lang),
    fontSize: step.fontSize,
    lineHeight: isHindi(lang)
      ? Math.round(step.lineHeight * HI_LINE_HEIGHT_FACTOR)
      : step.lineHeight,
    letterSpacing: step.letterSpacing,
  };
}

/** OpenType tabular figures for metrics, counters and clock values. */
export const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };
