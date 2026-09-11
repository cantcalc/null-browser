export interface Tab {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isPinned: boolean;
  isMuted: boolean;
  audioPlaying?: boolean;
  createdAt: number;
  lastAccessed: number;
  lifecycle: 'active' | 'background' | 'crashed';
  workspaceId?: string;
  error?: PageError | null;
}

export interface ClosedTab {
  url: string;
  title: string;
  closedAt: number;
}

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  createdAt?: number;
  icon?: string;
}

export interface NoteItem {
  id: string;
  title: string;
  content: string;
  createdAt?: number;
  updatedAt?: number;
  url?: string;
}

export interface Workspace {
  id: string;
  name: string;
  color: string;
  icon?: string;
}

export interface HistoryEntry {
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

export interface DownloadItem {
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

export interface PageError {
  code: number;
  description: string;
  url: string;
}

export type SearchEngine = 'google' | 'naver' | 'duckduckgo' | 'bing' | 'brave' | 'custom';

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

export interface ClearDataOptions {
  history: boolean;
  searchHistory: boolean;
  downloads: boolean;
  cookies: boolean;
  cache: boolean;
  timeRange: 'hour' | 'day' | 'week' | 'all';
}

export interface BrowserSettings {
  firstRunCompleted: boolean;
  theme: 'noir' | 'paper' | 'graphite' | 'midnight' | 'forest' | 'aurora' | 'sunset' | 'oled' | 'light' | 'cobalt' | 'clay' | 'mist';
  accentColor: string;
  searchEngine: SearchEngine;
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
