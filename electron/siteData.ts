const ORIGIN_STORAGE_TYPES: Electron.ClearStorageDataOptions['storages'] = [
  'cookies',
  'indexdb',
  'localstorage',
  'cachestorage',
];

export function parseSiteOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

export async function clearOriginStorage(targetSession: Electron.Session, value: unknown): Promise<boolean> {
  const origin = parseSiteOrigin(value);
  if (!origin) return false;

  await targetSession.clearStorageData({
    origin,
    storages: ORIGIN_STORAGE_TYPES,
  });
  return true;
}
