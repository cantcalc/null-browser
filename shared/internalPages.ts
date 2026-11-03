export const SETTINGS_SECTIONS = [
  'general', 'appearance', 'search', 'privacy', 'sites', 'languages',
  'downloads', 'extensions', 'shortcuts', 'backup', 'about',
] as const;

export type SettingsSection = typeof SETTINGS_SECTIONS[number];

/** Only known NULL settings routes are accepted; this is not a remote protocol. */
export function normalizeSettingsUrl(value?: string): string | null {
  if (!value) return null;
  const match = /^(?:null|vyro|aero|browser):\/\/settings(?:\/([a-z]+))?\/?$/i.exec(value.trim());
  if (!match) return null;
  const section = (match[1] || 'general').toLowerCase();
  if (!(SETTINGS_SECTIONS as readonly string[]).includes(section)) return null;
  return section === 'general' ? 'null://settings' : `null://settings/${section}`;
}

export const isSettingsUrl = (value?: string): boolean => normalizeSettingsUrl(value) !== null;

export function settingsSectionFromUrl(value?: string): SettingsSection {
  return (normalizeSettingsUrl(value)?.split('/')[3] || 'general') as SettingsSection;
}

export function settingsUrl(section: SettingsSection = 'general'): string {
  return section === 'general' ? 'null://settings' : `null://settings/${section}`;
}

export function isNewTabUrl(value?: string): boolean {
  return !value || /^(?:null|vyro|aero|browser):\/\/newtab\/?$/i.test(value.trim()) || /^about:blank(?:[#?].*)?$/i.test(value);
}

export function isInternalPageUrl(value?: string): boolean {
  return isNewTabUrl(value) || isSettingsUrl(value);
}

export const internalPageTitle = (value?: string): string => isSettingsUrl(value) ? '설정' : '새 탭';
