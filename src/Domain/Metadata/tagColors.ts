/** Shared tag presets for editors, label grouping and example workspaces. */
export const TAG_COLOR = {
  red: '#e36d73',
  orange: '#e9944c',
  gold: '#e3c653',
  lime: '#a4c977',
  forest: '#55976a',
  mint: '#9bdbaf',
  teal: '#65cbbb',
  cyan: '#54afcb',
  blue: '#5d83d4',
  lavender: '#9c9aed',
  purple: '#b36acb',
  rose: '#e888a5',
  brown: '#a17b5c',
  slate: '#748c9e',
  silver: '#b8c4ca',
  ivory: '#e8dfc5',
} as const;

// Hue-ordered colors vary in lightness and saturation, followed by earthy/neutral choices.
export const TAG_COLORS = Object.values(TAG_COLOR);
export const DEFAULT_TAG_COLOR = TAG_COLOR.teal;
export type TagColor = (typeof TAG_COLORS)[number];
