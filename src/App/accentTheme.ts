export const ACCENT_THEMES = ['orange', 'red', 'green', 'blue', 'purple'] as const;

export type AccentTheme = (typeof ACCENT_THEMES)[number];

const STORAGE_KEY = 'chaingraph.accent-theme';

function isAccentTheme(value: string | null): value is AccentTheme {
  return ACCENT_THEMES.some((theme) => theme === value);
}

export function readAccentTheme(): AccentTheme {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
    return isAccentTheme(stored) ? stored : 'orange';
  } catch {
    return 'orange';
  }
}

export function applyAccentTheme(theme: AccentTheme, persist = true) {
  document.documentElement.dataset.accentTheme = theme;
  if (!persist) return;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, theme);
  } catch {
    // The active theme still applies when storage is unavailable.
  }
}
