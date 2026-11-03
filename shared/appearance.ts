export type BrowserTheme = 'noir' | 'paper';
export const INTERFACE_STYLE_IDS = ['core', 'air', 'studio', 'focus', 'outline'] as const;
export type InterfaceStyle = typeof INTERFACE_STYLE_IDS[number];
export const HOME_STYLE_IDS = ['center', 'compact', 'elevated', 'horizontal', 'grounded'] as const;
export type HomeStyle = typeof HOME_STYLE_IDS[number];

/** Preserve a legacy profile's light/dark preference, not its old tint. */
export function normalizeTheme(value: unknown): BrowserTheme {
  return value === 'paper' || value === 'light' || value === 'mist' || value === 'white' ? 'paper' : 'noir';
}

export function normalizeInterfaceStyle(value: unknown): InterfaceStyle {
  return INTERFACE_STYLE_IDS.includes(value as InterfaceStyle) ? value as InterfaceStyle : 'studio';
}

export function normalizeHomeStyle(value: unknown): HomeStyle {
  return HOME_STYLE_IDS.includes(value as HomeStyle) ? value as HomeStyle : 'center';
}
