export const isMacOS = () => window.electronAPI?.platform === 'darwin';

export const shortcutLabel = (macOS: string, windows: string) => (isMacOS() ? macOS : windows);
