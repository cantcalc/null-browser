export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  pinned: boolean;
  muted: boolean;
  audioPlaying: boolean;
  createdAt: number;
  lastActiveAt: number;
  lifecycle: 'active' | 'background' | 'crashed';
  workspaceId?: string;
}

export interface Workspace {
  id: string;
  name: string;
  color: string;
  icon?: string;
}

export interface ClosedTab {
  url: string;
  title: string;
  closedAt: number;
}

export interface DownloadItemInfo {
  id: string;
  filename: string;
  totalBytes: number;
  receivedBytes: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  savePath: string;
  startTime: number;
  sourceUrl?: string;
  sourceHostname?: string;
}

export interface PermissionPrompt {
  requestId: string;
  origin: string;
  permission: string;
  requestingUrl: string;
}

export interface HistoryItem {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
}

export interface SearchHistoryItem {
  id: string;
  query: string;
  engineId: string;
  searchedAt: number;
}

export interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  createdAt: number;
}

export interface SearchShortcut {
  keyword: string;
  name: string;
  searchUrl: string;
}

export interface FavoriteItem {
  id: string;
  title: string;
  url: string;
  favicon?: string;
}

export interface BrowserSettings {
  firstRunCompleted: boolean;
  theme: 'noir' | 'paper' | 'graphite' | 'midnight' | 'forest' | 'aurora' | 'sunset' | 'oled' | 'light' | 'cobalt' | 'clay' | 'mist';
  accentColor: string;
  searchEngine: 'google' | 'naver' | 'duckduckgo' | 'bing' | 'brave' | 'custom';
  customSearchUrl: string;
  searchShortcuts: SearchShortcut[];
  saveBrowsingHistory: boolean;
  saveSearchHistory: boolean;
  showBookmarkBar: boolean;
  startupBehavior: 'newtab' | 'restore' | 'specific';
  startupPages: string[];
  newTabConfig: {
    showFavorites: boolean;
    showRecentSites: boolean;
    showLogo: boolean;
    compactMode: boolean;
  };
  favorites: FavoriteItem[];
  downloadPath: string;
  askDownloadLocation: boolean;
  siteZoom: Record<string, number>;
  siteTranslation: Record<string, 'always' | 'never' | 'ask'>;
  adBlockEnabled: boolean;
  cookiePolicy: 'allow' | 'block-third-party';
  cookieExceptions: Record<string, 'allow' | 'block'>;
  preferredLanguages: string[];
  spellCheckEnabled: boolean;
}

export interface ClearDataOptions {
  history: boolean;
  searchHistory: boolean;
  downloads: boolean;
  cookies: boolean;
  cache: boolean;
  timeRange: 'hour' | 'day' | 'week' | 'all';
}

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'unavailable'
  | 'error';

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  version?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  message?: string;
}
