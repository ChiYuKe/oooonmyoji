export const appearanceThemes = ['dark', 'graphite', 'warm', 'contrast', 'pink', 'light'] as const;
export type AppearanceTheme = typeof appearanceThemes[number];
export function isAppearanceTheme(value: unknown): value is AppearanceTheme {
  return typeof value === 'string' && (appearanceThemes as readonly string[]).includes(value);
}
export function themeColorScheme(theme: AppearanceTheme): 'dark' | 'light' {
  return theme === 'light' || theme === 'pink' ? 'light' : 'dark';
}
export function themeBackground(theme: AppearanceTheme): string {
  return { dark: '#141414', graphite: '#262626', warm: '#211e1b', contrast: '#080808', pink: '#fac5d7', light: '#dfe4e8' }[theme];
}
