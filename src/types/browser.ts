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
  interfaceStyle: import('../../shared/appearance').InterfaceStyle;
  homeStyle: import('../../shared/appearance').HomeStyle;
  firstRunCompleted: boolean;
  theme: import('../../shared/appearance').BrowserTheme;
  searchEngine: SearchEngine;
  customSearchUrl: string;
  saveBrowsingHistory: boolean;
  saveSearchHistory: boolean;
  showBookmarkBar: boolean;
  startupBehavior: 'newtab' | 'restore' | 'specific';
  startupPages: string[];
  favorites: FavoriteItem[];
  downloadPath: string;
  askDownloadLocation: boolean;
  siteZoom: Record<string, number>;
  cookiePolicy: 'allow' | 'block-third-party';
  cookieExceptions: Record<string, 'allow' | 'block'>;
  preferredLanguages: string[];
  spellCheckEnabled: boolean;
}
