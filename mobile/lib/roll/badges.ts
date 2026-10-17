/**
 * English-only labels for the support and leaning BADGES.
 *
 * The rest of the app translates through i18n, but these two vocabularies
 * deliberately do not. They are read side by side across a team that mixes
 * Hindi and English speech, and the field shorthand already IS English
 * ("supporter", "center-right") in how the team says it — a translated chip
 * next to an untranslated one reads as two different scales, and a Devanagari
 * rendering of "center-left" is longer than the chip it has to fit in.
 *
 * Both maps are total: every value in `lib/roll/types.ts` has a label, so a
 * new leaning is a compile error here until it is named — which is the point.
 */
import type { Leaning, SupportCategory } from './types';

/** "With us / against us" — the voter's recorded intention. */
export const SUPPORT_BADGE: Record<SupportCategory, string> = {
  unknown: 'Not recorded',
  supporter: 'Supporter',
  opponent: 'Opponent',
};

/** The 5-point political scale, warm to cool. */
export const LEANING_BADGE: Record<Leaning, string> = {
  unknown: 'Not marked',
  right: 'Right',
  centerRight: 'Center-right',
  center: 'Center',
  centerLeft: 'Center-left',
  left: 'Left',
};
