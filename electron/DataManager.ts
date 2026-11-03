import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { isInternalPageUrl, isNewTabUrl, normalizeSettingsUrl } from '../shared/internalPages';
import { normalizeHomeStyle, normalizeInterfaceStyle, normalizeTheme } from '../shared/appearance';
import { HistoryItem, SearchHistoryItem, BookmarkItem, ClosedTab, BrowserSettings, FavoriteItem, ClearDataOptions, Workspace, DownloadItemInfo } from './types';

const MAX_HISTORY_ENTRIES = 2000;
const MAX_SEARCH_HISTORY_ENTRIES = 1000;
const MAX_RECENTLY_CLOSED = 50;
const DUPLICATE_NAVIGATION_WINDOW_MS = 30_000;

interface BrowserStoreData {
  history: HistoryItem[];
  searchHistory: SearchHistoryItem[];
  bookmarks: BookmarkItem[];
  notes: string;
  closedTabs: ClosedTab[];
  session: {
    tabs: { id: string; url: string; title: string; pinned: boolean; workspaceId?: string }[];
    activeTabId: string | null;
  };
  workspaces: Workspace[];
  activeWorkspaceId: string;
  legacySessionWorkspaceId: string;
  permissions: Record<string, Record<string, 'allow' | 'deny'>>;
  downloads: DownloadItemInfo[];
  settings: BrowserSettings;
  lastExitWasClean: boolean;
}

const DEFAULT_SETTINGS: BrowserSettings = {
  interfaceStyle: 'studio',
  homeStyle: 'center',
  firstRunCompleted: false,
  theme: 'noir',
  searchEngine: 'google',
  customSearchUrl: 'https://www.google.com/search?q=%s',
  saveBrowsingHistory: true,
  saveSearchHistory: true,
  showBookmarkBar: false,
  startupBehavior: 'newtab',
  startupPages: [],
  favorites: [
    { id: 'fav-1', title: 'Google', url: 'https://www.google.com' },
    { id: 'fav-2', title: 'GitHub', url: 'https://github.com' },
    { id: 'fav-3', title: 'YouTube', url: 'https://www.youtube.com' },
    { id: 'fav-4', title: 'Wikipedia', url: 'https://www.wikipedia.org' },
    { id: 'fav-5', title: 'MDN Web Docs', url: 'https://developer.mozilla.org' },
    { id: 'fav-6', title: 'Reddit', url: 'https://www.reddit.com' },
  ],
  downloadPath: '',
  askDownloadLocation: false,
  siteZoom: {},
  cookiePolicy: 'allow',
  cookieExceptions: {},
  preferredLanguages: ['ko-KR', 'en-US'],
  spellCheckEnabled: true,
};

const DEFAULT_STORE: BrowserStoreData = {
  history: [],
  searchHistory: [],
  bookmarks: [
    { id: 'b-1', title: 'Google', url: 'https://www.google.com', createdAt: Date.now() },
    { id: 'b-2', title: 'GitHub', url: 'https://github.com', createdAt: Date.now() },
    { id: 'b-3', title: 'YouTube', url: 'https://www.youtube.com', createdAt: Date.now() },
  ],
  notes: '',
  closedTabs: [],
  session: {
    tabs: [{ id: 'tab-1', url: 'null://newtab', title: '새 탭', pinned: false }],
    activeTabId: 'tab-1',
  },
  workspaces: [{ id: 'workspace-default', name: 'work', color: '#3b82f6' }],
  activeWorkspaceId: 'workspace-default',
  legacySessionWorkspaceId: 'workspace-default',
  permissions: {},
  downloads: [],
  settings: DEFAULT_SETTINGS,
  lastExitWasClean: true,
};

function isSafeSearchTemplate(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || !value.includes('%s')) return false;
  try {
    const parsed = new URL(value.replace(/%s/g, 'search'));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function canonicalTabUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const settingsRoute = normalizeSettingsUrl(trimmed);
  if (settingsRoute) return settingsRoute;
  if (isNewTabUrl(trimmed)) {
    return 'null://newtab';
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'file:') {
      return parsed.href;
    }
  } catch {}
  return null;
}

function canonicalWebUrl(value: unknown): string | null {
  const url = canonicalTabUrl(value);
  if (!url) return null;
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function canonicalOrigin(value: unknown): string | null {
  try {
    const parsed = new URL(typeof value === 'string' ? value.trim() : '');
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

function safeTitle(value: unknown, fallback: string, maxLength = 500): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : fallback.slice(0, maxLength);
}

export class DataManager {
  private filePath: string;
  private data: BrowserStoreData;
  private saveTimeout: NodeJS.Timeout | null = null;
  private saveRevision = 0;
  private previousRunWasClean = true;

  constructor() {
    const userDataPath = app.getPath('userData');
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    this.filePath = path.join(userDataPath, 'browser_store.json');
    this.data = this.loadData();
    this.previousRunWasClean = this.data.lastExitWasClean !== false;
    if (!this.data.settings.downloadPath) {
      try {
        this.data.settings.downloadPath = app.getPath('downloads');
      } catch {}
    }
  }

  private loadData(): BrowserStoreData {
    const defaults = JSON.parse(JSON.stringify(DEFAULT_STORE)) as BrowserStoreData;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return defaults;
        const workspaces = this.normalizeWorkspaces(parsed.workspaces);
        return {
          ...defaults,
          ...parsed,
          history: this.normalizeHistory(parsed.history),
          searchHistory: this.normalizeSearchHistory(parsed.searchHistory),
          bookmarks: this.normalizeBookmarks(parsed.bookmarks),
          closedTabs: this.normalizeClosedTabs(parsed.closedTabs),
          permissions: this.normalizePermissions(parsed.permissions),
          downloads: this.normalizeDownloads(parsed.downloads),
          session: this.normalizeSession(parsed.session),
          workspaces,
          // Assign the old shared cookie jar once. Never give it to another
          // workspace when its original owner is later deleted.
          legacySessionWorkspaceId: typeof parsed.legacySessionWorkspaceId === 'string' && parsed.legacySessionWorkspaceId.length > 0
            ? parsed.legacySessionWorkspaceId.slice(0, 100)
            : workspaces.find((workspace) => workspace.id === 'workspace-default')?.id || workspaces[0].id,
          activeWorkspaceId: typeof parsed.activeWorkspaceId === 'string' && workspaces.some((workspace) => workspace.id === parsed.activeWorkspaceId)
            ? parsed.activeWorkspaceId
            : workspaces[0]?.id || defaults.activeWorkspaceId,
          settings: this.normalizeSettings(parsed.settings),
        };
      }
    } catch {
      // Fallback on corrupt file
    }
    return defaults;
  }

  private normalizeSettings(raw: unknown): BrowserSettings {
    const incoming = raw && typeof raw === 'object' ? (raw as Partial<BrowserSettings>) : {};
    const searchEngines: BrowserSettings['searchEngine'][] = ['google', 'naver', 'duckduckgo', 'bing', 'brave', 'custom'];
    const startupBehaviors: BrowserSettings['startupBehavior'][] = ['newtab', 'restore', 'specific'];
    const siteZoom =
      incoming.siteZoom && typeof incoming.siteZoom === 'object'
        ? Object.fromEntries(
            Object.entries(incoming.siteZoom).filter(
              ([origin, zoom]) => Boolean(canonicalOrigin(origin)) && typeof zoom === 'number' && Number.isFinite(zoom)
            ).map(([origin, zoom]) => [canonicalOrigin(origin)!, Math.min(5, Math.max(0.25, zoom as number))])
          )
        : {};
    const cookieExceptions =
      incoming.cookieExceptions && typeof incoming.cookieExceptions === 'object'
        ? Object.fromEntries(
            Object.entries(incoming.cookieExceptions)
              .map(([origin, decision]) => [canonicalOrigin(origin), decision] as const)
              .filter((entry): entry is readonly [string, 'allow' | 'block'] => Boolean(entry[0]) && (entry[1] === 'allow' || entry[1] === 'block'))
          )
        : {};
    const preferredLanguages = Array.isArray(incoming.preferredLanguages)
      ? Array.from(new Set(incoming.preferredLanguages.filter((language): language is string => (
          typeof language === 'string' && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)
        )))).slice(0, 10)
      : [...DEFAULT_SETTINGS.preferredLanguages];

    const startupPages = Array.isArray(incoming.startupPages)
      ? Array.from(
          new Set(
            incoming.startupPages
              .map((page) => canonicalTabUrl(page))
              .filter((page): page is string => Boolean(page) && page !== 'null://newtab')
          )
        ).slice(0, 20)
      : [];

    const favoriteUrls = new Set<string>();
    const favorites = Array.isArray(incoming.favorites)
      ? incoming.favorites
          .map((item) => {
            if (!item || typeof item.id !== 'string') return null;
            const url = canonicalWebUrl(item.url);
            if (!url || favoriteUrls.has(url)) return null;
            favoriteUrls.add(url);
            const favicon = typeof item.favicon === 'string' && (/^https?:\/\//i.test(item.favicon) || /^data:image\//i.test(item.favicon))
              ? item.favicon.slice(0, 2000)
              : undefined;
            return {
              id: item.id.trim().slice(0, 200),
              title: safeTitle(item.title, url),
              url,
              ...(favicon ? { favicon } : {}),
            };
          })
          .filter((item): item is FavoriteItem => Boolean(item))
          .slice(0, 12)
      : [...DEFAULT_SETTINGS.favorites];

    // Only supported settings may survive profile loads, updates, and legacy imports.
    return {
      ...DEFAULT_SETTINGS,
      interfaceStyle: normalizeInterfaceStyle(incoming.interfaceStyle),
      homeStyle: normalizeHomeStyle(incoming.homeStyle),
      firstRunCompleted: typeof incoming.firstRunCompleted === 'boolean' ? incoming.firstRunCompleted : DEFAULT_SETTINGS.firstRunCompleted,
      theme: normalizeTheme(incoming.theme),
      searchEngine: searchEngines.includes(incoming.searchEngine as BrowserSettings['searchEngine'])
        ? incoming.searchEngine as BrowserSettings['searchEngine']
        : DEFAULT_SETTINGS.searchEngine,
      customSearchUrl: isSafeSearchTemplate(incoming.customSearchUrl)
        ? incoming.customSearchUrl
        : DEFAULT_SETTINGS.customSearchUrl,
      saveBrowsingHistory: typeof incoming.saveBrowsingHistory === 'boolean' ? incoming.saveBrowsingHistory : DEFAULT_SETTINGS.saveBrowsingHistory,
      saveSearchHistory: typeof incoming.saveSearchHistory === 'boolean' ? incoming.saveSearchHistory : DEFAULT_SETTINGS.saveSearchHistory,
      showBookmarkBar: typeof incoming.showBookmarkBar === 'boolean' ? incoming.showBookmarkBar : DEFAULT_SETTINGS.showBookmarkBar,
      startupPages,
      startupBehavior: startupBehaviors.includes(incoming.startupBehavior as BrowserSettings['startupBehavior'])
        ? incoming.startupBehavior as BrowserSettings['startupBehavior']
        : DEFAULT_SETTINGS.startupBehavior,
      favorites,
      downloadPath: this.normalizeDownloadPath(incoming.downloadPath),
      askDownloadLocation: typeof incoming.askDownloadLocation === 'boolean' ? incoming.askDownloadLocation : DEFAULT_SETTINGS.askDownloadLocation,
      siteZoom,
      cookiePolicy: incoming.cookiePolicy === 'block-third-party' ? 'block-third-party' : 'allow',
      cookieExceptions,
      preferredLanguages: preferredLanguages.length > 0 ? preferredLanguages : [...DEFAULT_SETTINGS.preferredLanguages],
      spellCheckEnabled: typeof incoming.spellCheckEnabled === 'boolean' ? incoming.spellCheckEnabled : DEFAULT_SETTINGS.spellCheckEnabled,
    };
  }

  private normalizeDownloadPath(value: unknown): string {
    let fallback = '';
    try {
      fallback = app.getPath('downloads');
    } catch {}
    if (typeof value !== 'string' || !path.isAbsolute(value)) return fallback;
    try {
      return fs.statSync(value).isDirectory() ? path.normalize(value) : fallback;
    } catch {
      return fallback;
    }
  }

  private normalizeHistory(raw: unknown): HistoryItem[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        const url = canonicalTabUrl(item?.url);
        if (!url || url === 'null://newtab') return null;
        const visitedAt = typeof item?.visitedAt === 'number' && Number.isFinite(item.visitedAt) ? item.visitedAt : Date.now();
        return {
          id: typeof item?.id === 'string' && item.id ? item.id.slice(0, 200) : randomUUID(),
          url,
          title: safeTitle(item?.title, url),
          visitedAt: Math.max(0, visitedAt),
        };
      })
      .filter((item): item is HistoryItem => Boolean(item))
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .slice(0, MAX_HISTORY_ENTRIES);
  }

  private normalizeSearchHistory(raw: unknown): SearchHistoryItem[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        if (!item || typeof item.query !== 'string' || !item.query.trim()) return null;
        const searchedAt = typeof item.searchedAt === 'number' && Number.isFinite(item.searchedAt) ? item.searchedAt : Date.now();
        return {
          id: typeof item.id === 'string' && item.id ? item.id.slice(0, 200) : randomUUID(),
          query: item.query.trim().slice(0, 500),
          engineId: typeof item.engineId === 'string' && item.engineId.trim() ? item.engineId.trim().slice(0, 100) : 'google',
          searchedAt: Math.max(0, searchedAt),
        };
      })
      .filter((item): item is SearchHistoryItem => Boolean(item))
      .sort((a, b) => b.searchedAt - a.searchedAt)
      .slice(0, MAX_SEARCH_HISTORY_ENTRIES);
  }

  private normalizeBookmarks(raw: unknown): BookmarkItem[] {
    if (!Array.isArray(raw)) return [];
    const urls = new Set<string>();
    return raw
      .map((item) => {
        const url = canonicalWebUrl(item?.url);
        if (!url || urls.has(url)) return null;
        urls.add(url);
        return {
          id: typeof item?.id === 'string' && item.id ? item.id.slice(0, 200) : `b-${randomUUID()}`,
          title: safeTitle(item?.title, url),
          url,
          createdAt: typeof item?.createdAt === 'number' && Number.isFinite(item.createdAt) ? Math.max(0, item.createdAt) : Date.now(),
        };
      })
      .filter((item): item is BookmarkItem => Boolean(item))
      .slice(0, 5000);
  }

  private normalizeClosedTabs(raw: unknown): ClosedTab[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        const url = canonicalTabUrl(item?.url);
        if (!url || url === 'null://newtab') return null;
        return {
          url,
          title: safeTitle(item?.title, url),
          closedAt: typeof item?.closedAt === 'number' && Number.isFinite(item.closedAt) ? Math.max(0, item.closedAt) : Date.now(),
        };
      })
      .filter((item): item is ClosedTab => Boolean(item))
      .sort((a, b) => b.closedAt - a.closedAt)
      .slice(0, MAX_RECENTLY_CLOSED);
  }

  private normalizePermissions(raw: unknown): Record<string, Record<string, 'allow' | 'deny'>> {
    if (!raw || typeof raw !== 'object') return {};
    const normalized: Record<string, Record<string, 'allow' | 'deny'>> = {};
    for (const [originValue, values] of Object.entries(raw)) {
      const origin = canonicalOrigin(originValue);
      if (!origin || !values || typeof values !== 'object') continue;
      const permissions: Record<string, 'allow' | 'deny'> = {};
      for (const [permission, decision] of Object.entries(values)) {
        if (permission.length <= 100 && (decision === 'allow' || decision === 'deny')) permissions[permission] = decision;
      }
      if (Object.keys(permissions).length > 0) normalized[origin] = permissions;
    }
    return normalized;
  }

  private normalizeDownloads(raw: unknown): DownloadItemInfo[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        if (!item || typeof item.id !== 'string' || !item.id.trim() || typeof item.filename !== 'string') return null;
        const state = item.state === 'completed' || item.state === 'cancelled' || item.state === 'interrupted'
          ? item.state
          : 'interrupted';
        return {
          id: item.id.trim().slice(0, 200),
          filename: path.basename(item.filename).slice(0, 500) || 'download',
          totalBytes: typeof item.totalBytes === 'number' && Number.isFinite(item.totalBytes) ? Math.max(0, item.totalBytes) : 0,
          receivedBytes: typeof item.receivedBytes === 'number' && Number.isFinite(item.receivedBytes) ? Math.max(0, item.receivedBytes) : 0,
          state,
          savePath: typeof item.savePath === 'string' && path.isAbsolute(item.savePath) ? path.normalize(item.savePath) : '',
          startTime: typeof item.startTime === 'number' && Number.isFinite(item.startTime) ? Math.max(0, item.startTime) : Date.now(),
          ...(typeof item.sourceUrl === 'string' && /^https?:\/\//i.test(item.sourceUrl) ? { sourceUrl: item.sourceUrl.slice(0, 2000) } : {}),
          ...(typeof item.sourceHostname === 'string' && item.sourceHostname.trim() ? { sourceHostname: item.sourceHostname.trim().slice(0, 255) } : {}),
        };
      })
      .filter((item): item is DownloadItemInfo => Boolean(item))
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, 500);
  }

  private normalizeWorkspaces(raw: unknown): Workspace[] {
    if (!Array.isArray(raw)) return structuredClone(DEFAULT_STORE.workspaces);
    const seen = new Set<string>();
    const colors = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#f43f5e'];
    const result = raw.map((item, index) => {
      if (!item || typeof item.id !== 'string' || !item.id.trim() || seen.has(item.id.trim())) return null;
      const id = item.id.trim().slice(0, 100);
      seen.add(id);
      const normalizedName = safeTitle(item.name, `워크스페이스 ${index + 1}`, 80);
      return {
        id,
        // Migrate the original built-in label once while preserving names
        // that the user has explicitly chosen later.
        name: id === 'workspace-default' && normalizedName === '개인' ? 'work' : normalizedName,
        color: typeof item.color === 'string' && /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : colors[index % colors.length],
        ...(typeof item.icon === 'string' && item.icon.length <= 20 ? { icon: item.icon } : {}),
      };
    }).filter((workspace): workspace is Workspace => Boolean(workspace)).slice(0, 20);
    return result.length > 0 ? result : structuredClone(DEFAULT_STORE.workspaces);
  }

  private normalizeSession(raw: unknown): BrowserStoreData['session'] {
    const candidate = raw && typeof raw === 'object' ? (raw as Partial<BrowserStoreData['session']>) : {};
    const seenIds = new Set<string>();
    const tabs = Array.isArray(candidate.tabs)
      ? candidate.tabs
          .filter(
            (tab) =>
              tab &&
              typeof tab.id === 'string' &&
              tab.id.trim().length > 0 &&
              !seenIds.has(tab.id.trim()) &&
              (seenIds.add(tab.id.trim()), true)
          )
          .map((tab) => {
            const url = canonicalTabUrl(tab.url) || 'null://newtab';
            return {
              id: tab.id.trim().slice(0, 200),
              url,
              title: safeTitle(tab.title, url === 'null://newtab' ? '새 탭' : url),
              pinned: tab.pinned === true,
              ...(typeof tab.workspaceId === 'string' && tab.workspaceId.trim() ? { workspaceId: tab.workspaceId.trim().slice(0, 100) } : {}),
            };
          })
      : [];

    return {
      tabs: tabs.length > 0 ? tabs : [{ ...DEFAULT_STORE.session.tabs[0] }],
      activeTabId: typeof candidate.activeTabId === 'string' && tabs.some((tab) => tab.id === candidate.activeTabId)
        ? candidate.activeTabId
        : tabs[0]?.id || DEFAULT_STORE.session.activeTabId,
    };
  }

  private scheduleSave() {
    this.saveRevision++;
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      void this.persistAsync();
    }, 500);
  }

  private async persistAsync() {
    const revision = this.saveRevision;
    const tempPath = `${this.filePath}.async-${revision}.tmp`;
    try {
      // Disk writes must not hold up input/navigation on the main thread.
      await fs.promises.writeFile(tempPath, JSON.stringify(this.data), { encoding: 'utf-8', mode: 0o600 });
      // This check and the atomic rename are synchronous together. A late
      // async write can never overwrite newer data or the shutdown flush.
      if (revision === this.saveRevision) fs.renameSync(tempPath, this.filePath);
      else await fs.promises.unlink(tempPath).catch(() => {});
    } catch {
      await fs.promises.unlink(tempPath).catch(() => {});
    }
  }

  public flushSync() {
    this.saveRevision++;
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    try {
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(tempPath, this.filePath);
      // Browser history, notes and site permissions are private profile data.
      // Keep the store readable/writable only by the current macOS user.
      try { fs.chmodSync(this.filePath, 0o600); } catch {}
    } catch {
      // Silent error handling to avoid breaking UI
    }
  }

  public didPreviousRunCrash(): boolean {
    return !this.previousRunWasClean;
  }

  public markRunStarted() {
    this.data.lastExitWasClean = false;
    this.flushSync();
  }

  public markCleanExit() {
    this.data.lastExitWasClean = true;
    this.flushSync();
  }

  // Settings API
  public getSettings(): BrowserSettings {
    return structuredClone(this.data.settings);
  }

  public updateSettings(updates: Partial<BrowserSettings>): BrowserSettings {
    const safeUpdates = updates && typeof updates === 'object' ? updates : {};
    this.data.settings = this.normalizeSettings({
      ...this.data.settings,
      ...safeUpdates,
    });
    this.scheduleSave();
    return this.getSettings();
  }

  public resetSettings(): BrowserSettings {
    let defaultDownloads = '';
    try {
      defaultDownloads = app.getPath('downloads');
    } catch {}
    this.data.settings = {
      ...DEFAULT_SETTINGS,
      firstRunCompleted: true,
      downloadPath: defaultDownloads,
    };
    this.scheduleSave();
    return this.getSettings();
  }

  // Favorites (New Tab) API
  public getFavorites(): FavoriteItem[] {
    return structuredClone(this.data.settings.favorites || DEFAULT_SETTINGS.favorites);
  }

  public addFavorite(item: Omit<FavoriteItem, 'id'>): FavoriteItem {
    const url = canonicalWebUrl(item?.url);
    if (!url) throw new Error('Only HTTP(S) favorites are supported');
    const fav: FavoriteItem = {
      id: `fav-${randomUUID()}`,
      title: safeTitle(item?.title, url),
      url,
      ...(typeof item?.favicon === 'string' && (/^https?:\/\//i.test(item.favicon) || /^data:image\//i.test(item.favicon))
        ? { favicon: item.favicon.slice(0, 2000) }
        : {}),
    };
    const current = this.data.settings.favorites || [];
    this.data.settings.favorites = [fav, ...current.filter((f) => f.url !== url)].slice(0, 12);
    this.scheduleSave();
    return structuredClone(fav);
  }

  public removeFavorite(id: string) {
    this.data.settings.favorites = (this.data.settings.favorites || []).filter((f) => f.id !== id);
    this.scheduleSave();
  }

  public updateFavorite(id: string, updates: Partial<FavoriteItem>) {
    if (!id || typeof id !== 'string') return;
    this.data.settings.favorites = (this.data.settings.favorites || []).map((f) => {
      if (f.id !== id) return f;
      const nextUrl = updates?.url === undefined ? f.url : canonicalWebUrl(updates.url);
      if (!nextUrl) return f;
      return {
        ...f,
        url: nextUrl,
        title: updates?.title === undefined ? f.title : safeTitle(updates.title, nextUrl),
        ...(updates?.favicon && (/^https?:\/\//i.test(updates.favicon) || /^data:image\//i.test(updates.favicon))
          ? { favicon: updates.favicon.slice(0, 2000) }
          : {}),
      };
    });
    this.scheduleSave();
  }

  // Site Zoom API
  public getSiteZoom(origin: string): number {
    const safeOrigin = canonicalOrigin(origin);
    const zoom = safeOrigin ? this.data.settings.siteZoom?.[safeOrigin] : undefined;
    return typeof zoom === 'number' && Number.isFinite(zoom) ? Math.min(5, Math.max(0.25, zoom)) : 1.0;
  }

  public setSiteZoom(origin: string, zoom: number) {
    const safeOrigin = canonicalOrigin(origin);
    if (!safeOrigin) return;
    if (!this.data.settings.siteZoom) this.data.settings.siteZoom = {};
    const safeZoom = Number.isFinite(zoom) ? Math.min(5, Math.max(0.25, zoom)) : 1.0;
    if (safeZoom === 1.0) {
      delete this.data.settings.siteZoom[safeOrigin];
    } else {
      this.data.settings.siteZoom[safeOrigin] = safeZoom;
    }
    this.scheduleSave();
  }

  // Bookmarks Import & Export (Standard Netscape Bookmark HTML)
  public exportBookmarksHtml(): string {
    const bookmarks = this.data.bookmarks || [];
    let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. It will be read and overwritten. DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
`;
    for (const b of bookmarks) {
      const title = (b.title || b.url).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const url = b.url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      const time = Math.floor((b.createdAt || Date.now()) / 1000);
      html += `    <DT><A HREF="${url}" ADD_DATE="${time}">${title}</A>\n`;
    }
    html += `</DL><p>\n`;
    return html;
  }

  public importBookmarksHtml(html: string): number {
    if (typeof html !== 'string' || html.length > 5_000_000) return 0;
    const linkRegex = /<A\s+[^>]*HREF=["']([^"']+)["'][^>]*>([\s\S]*?)<\/A>/gi;
    let match: RegExpExecArray | null;
    let addedCount = 0;
    const existingUrls = new Set((this.data.bookmarks || []).map((b) => b.url));

    while ((match = linkRegex.exec(html)) !== null) {
      const url = canonicalWebUrl(decodeHtmlEntities(match[1].trim()));
      const rawTitle = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, '').trim());
      const title = rawTitle || url || '';

      if (url) {
        if (!existingUrls.has(url)) {
          this.data.bookmarks.push({
            id: `b-${randomUUID()}`,
            title,
            url,
            createdAt: Date.now(),
          });
          existingUrls.add(url);
          addedCount++;
        }
      }
    }
    if (addedCount > 0) {
      this.scheduleSave();
    }
    return addedCount;
  }

  // Settings JSON Export & Import
  public exportSettingsJson(): string {
    const exportable = {
      version: '1.0.0',
      exportedAt: Date.now(),
      settings: this.data.settings,
    };
    return JSON.stringify(exportable, null, 2);
  }

  public importSettingsJson(jsonStr: string): boolean {
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed && parsed.settings) {
        this.data.settings = this.normalizeSettings(parsed.settings);
        this.scheduleSave();
        return true;
      }
    } catch {}
    return false;
  }

  // Clear Browsing Data
  public clearBrowsingData(options: ClearDataOptions): void {
    const safeOptions = options || ({ history: false, searchHistory: false, downloads: false, cookies: false, cache: false, timeRange: 'all' } as ClearDataOptions);
    const now = Date.now();
    let cutoff = 0;
    if (safeOptions.timeRange === 'hour') cutoff = now - 3600 * 1000;
    else if (safeOptions.timeRange === 'day') cutoff = now - 24 * 3600 * 1000;
    else if (safeOptions.timeRange === 'week') cutoff = now - 7 * 24 * 3600 * 1000;

    if (safeOptions.history) {
      if (cutoff === 0) {
        this.data.history = [];
      } else {
        this.data.history = this.data.history.filter((h) => h.visitedAt < cutoff);
      }
    }

    if (safeOptions.searchHistory) {
      if (cutoff === 0) {
        this.data.searchHistory = [];
      } else {
        this.data.searchHistory = this.data.searchHistory.filter((item) => item.searchedAt < cutoff);
      }
    }

    if (safeOptions.downloads) {
      this.data.downloads = cutoff === 0
        ? []
        : this.data.downloads.filter((download) => download.startTime < cutoff);
    }

    this.scheduleSave();
  }

  // History API
  public getHistory(): HistoryItem[] {
    return structuredClone(this.data.history);
  }

  public addHistory(url: string, title: string) {
    if (!this.data.settings.saveBrowsingHistory) return;
    const safeUrl = canonicalTabUrl(url);
    if (!safeUrl || isInternalPageUrl(safeUrl)) return;
    const now = Date.now();
    const recent = this.data.history.find((history) => history.url === safeUrl && now - history.visitedAt < DUPLICATE_NAVIGATION_WINDOW_MS);
    if (recent) {
      recent.title = safeTitle(title, safeUrl);
      recent.visitedAt = now;
      this.data.history.sort((a, b) => b.visitedAt - a.visitedAt);
      this.scheduleSave();
      return;
    }
    const item: HistoryItem = {
      id: randomUUID(),
      url: safeUrl,
      title: safeTitle(title, safeUrl),
      visitedAt: now,
    };
    this.data.history = [item, ...this.data.history].slice(0, MAX_HISTORY_ENTRIES);
    this.scheduleSave();
  }

  public clearHistory() {
    this.data.history = [];
    this.scheduleSave();
  }

  public removeHistory(id: string) {
    if (typeof id !== 'string' || !id) return;
    this.data.history = this.data.history.filter((item) => item.id !== id);
    this.scheduleSave();
  }

  // Search history is stored separately from page visits and follows the
  // user's explicit setting. Query text is bounded and never sent anywhere.
  public getSearchHistory(): SearchHistoryItem[] {
    return structuredClone(this.data.searchHistory || []);
  }

  public addSearchHistory(query: string, engineId: string) {
    if (!this.data.settings.saveSearchHistory || typeof query !== 'string' || !query.trim()) return;
    const safeQuery = query.trim().slice(0, 500);
    const safeEngineId = typeof engineId === 'string' && engineId.trim() ? engineId.trim().slice(0, 100) : 'google';
    const now = Date.now();
    const recent = this.data.searchHistory.find((item) => item.query === safeQuery && item.engineId === safeEngineId && now - item.searchedAt < DUPLICATE_NAVIGATION_WINDOW_MS);
    if (recent) {
      recent.searchedAt = now;
      this.data.searchHistory.sort((a, b) => b.searchedAt - a.searchedAt);
    } else {
      this.data.searchHistory = [{ id: randomUUID(), query: safeQuery, engineId: safeEngineId, searchedAt: now }, ...this.data.searchHistory].slice(0, MAX_SEARCH_HISTORY_ENTRIES);
    }
    this.scheduleSave();
  }

  public removeSearchHistory(id: string) {
    if (typeof id !== 'string' || !id) return;
    this.data.searchHistory = this.data.searchHistory.filter((item) => item.id !== id);
    this.scheduleSave();
  }

  public clearSearchHistory() {
    this.data.searchHistory = [];
    this.scheduleSave();
  }

  // Download history is persisted for the normal profile. Active downloads
  // are normalized to "interrupted" on the next launch.
  public getDownloads(): DownloadItemInfo[] {
    return structuredClone(this.data.downloads || []);
  }

  public upsertDownload(info: DownloadItemInfo) {
    const normalized = this.normalizeDownloads([info])[0];
    if (!normalized) return;
    this.data.downloads = [normalized, ...this.data.downloads.filter((item) => item.id !== normalized.id)]
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, 500);
    this.scheduleSave();
  }

  public clearDownloadHistory() {
    this.data.downloads = [];
    this.scheduleSave();
  }

  public removeDownloadHistory(id: string) {
    if (typeof id !== 'string' || !id) return;
    this.data.downloads = this.data.downloads.filter((item) => item.id !== id);
    this.scheduleSave();
  }

  // Bookmarks API
  public getBookmarks(): BookmarkItem[] {
    return structuredClone(this.data.bookmarks);
  }

  public reorderBookmarks(orderedIds: string[]): BookmarkItem[] {
    if (!Array.isArray(orderedIds)) return this.getBookmarks();
    const rank = new Map(orderedIds.filter((id): id is string => typeof id === 'string').map((id, index) => [id, index]));
    this.data.bookmarks = this.data.bookmarks
      .map((bookmark, index) => ({ bookmark, index }))
      .sort((a, b) => (rank.get(a.bookmark.id) ?? orderedIds.length + a.index) - (rank.get(b.bookmark.id) ?? orderedIds.length + b.index))
      .map(({ bookmark }) => bookmark);
    this.scheduleSave();
    return this.getBookmarks();
  }

  public addBookmark(title: string, url: string): BookmarkItem {
    const safeUrl = canonicalWebUrl(url);
    if (!safeUrl) throw new Error('Only HTTP(S) bookmarks are supported');
    const bookmark: BookmarkItem = {
      id: `b-${randomUUID()}`,
      title: safeTitle(title, safeUrl),
      url: safeUrl,
      createdAt: Date.now(),
    };
    this.data.bookmarks = [bookmark, ...this.data.bookmarks.filter((b) => b.url !== safeUrl)];
    this.scheduleSave();
    return bookmark;
  }

  public removeBookmark(id: string) {
    this.data.bookmarks = this.data.bookmarks.filter((b) => b.id !== id);
    this.scheduleSave();
  }

  public updateBookmark(id: string, updates: Partial<BookmarkItem>): BookmarkItem | null {
    const bookmark = this.data.bookmarks.find((item) => item.id === id);
    if (!bookmark) return null;
    const nextUrl = updates.url === undefined ? bookmark.url : canonicalWebUrl(updates.url);
    if (!nextUrl) return null;
    bookmark.url = nextUrl;
    bookmark.title = safeTitle(updates.title === undefined ? bookmark.title : updates.title, nextUrl);
    this.scheduleSave();
    return structuredClone(bookmark);
  }

  // Notes API
  public getNotes(): string {
    return this.data.notes || '';
  }

  public setNotes(content: string) {
    this.data.notes = typeof content === 'string' ? content.slice(0, 200_000) : '';
    this.scheduleSave();
  }

  // Closed Tabs Stack
  public getClosedTabs(): ClosedTab[] {
    return structuredClone(this.data.closedTabs || []);
  }

  public pushClosedTab(tab: ClosedTab) {
    const url = canonicalTabUrl(tab?.url);
    if (!url || url === 'null://newtab') return;
    this.data.closedTabs = [{ url, title: safeTitle(tab.title, url), closedAt: Date.now() }, ...(this.data.closedTabs || [])].slice(0, MAX_RECENTLY_CLOSED);
    this.scheduleSave();
  }

  public popClosedTab(): ClosedTab | null {
    if (!this.data.closedTabs || this.data.closedTabs.length === 0) return null;
    const [popped, ...rest] = this.data.closedTabs;
    this.data.closedTabs = rest;
    this.scheduleSave();
    return popped ? structuredClone(popped) : null;
  }

  // Session API
  public getSession() {
    const storedSession = this.normalizeSession(this.data.session);
    this.data.session = storedSession;
    return structuredClone(storedSession);
  }

  public saveSession(tabs: { id: string; url: string; title: string; pinned: boolean; workspaceId?: string }[], activeTabId: string | null) {
    this.data.session = this.normalizeSession({ tabs, activeTabId });
    this.scheduleSave();
  }

  public getWorkspaces(): { workspaces: Workspace[]; activeWorkspaceId: string } {
    const workspaces = this.normalizeWorkspaces(this.data.workspaces);
    const activeWorkspaceId = workspaces.some((workspace) => workspace.id === this.data.activeWorkspaceId)
      ? this.data.activeWorkspaceId
      : workspaces[0].id;
    this.data.workspaces = workspaces;
    this.data.activeWorkspaceId = activeWorkspaceId;
    return { workspaces: structuredClone(workspaces), activeWorkspaceId };
  }

  public getLegacySessionWorkspaceId(): string { return this.data.legacySessionWorkspaceId; }

  public saveWorkspaces(workspaces: Workspace[], activeWorkspaceId: string): { workspaces: Workspace[]; activeWorkspaceId: string } {
    const normalized = this.normalizeWorkspaces(workspaces);
    this.data.workspaces = normalized;
    this.data.activeWorkspaceId = normalized.some((workspace) => workspace.id === activeWorkspaceId)
      ? activeWorkspaceId
      : normalized[0].id;
    this.scheduleSave();
    return this.getWorkspaces();
  }

  // Permissions API
  public getPermission(origin: string, permission: string): 'allow' | 'deny' | undefined {
    const safeOrigin = canonicalOrigin(origin);
    return safeOrigin ? this.data.permissions[safeOrigin]?.[permission] : undefined;
  }

  public getPermissions(origin: string): Record<string, 'allow' | 'deny'> {
    const safeOrigin = canonicalOrigin(origin);
    return safeOrigin ? structuredClone(this.data.permissions[safeOrigin] || {}) : {};
  }

  public getAllPermissions(): Record<string, Record<string, 'allow' | 'deny'>> {
    return structuredClone(this.data.permissions);
  }

  public clearPermissions(origin: string) {
    const safeOrigin = canonicalOrigin(origin);
    if (!safeOrigin || !this.data.permissions[safeOrigin]) return;
    delete this.data.permissions[safeOrigin];
    this.scheduleSave();
  }

  public setPermission(origin: string, permission: string, decision: 'allow' | 'deny') {
    const safeOrigin = canonicalOrigin(origin);
    if (!safeOrigin || !permission || permission.length > 100 || (decision !== 'allow' && decision !== 'deny')) return;
    if (!this.data.permissions[safeOrigin]) {
      this.data.permissions[safeOrigin] = {};
    }
    this.data.permissions[safeOrigin][permission] = decision;
    this.scheduleSave();
  }

  public clearPermission(origin: string, permission: string) {
    const safeOrigin = canonicalOrigin(origin);
    if (!safeOrigin || !permission) return;
    const permissions = this.data.permissions[safeOrigin];
    if (!permissions || !(permission in permissions)) return;
    delete permissions[permission];
    if (Object.keys(permissions).length === 0) delete this.data.permissions[safeOrigin];
    this.scheduleSave();
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => {
      const number = Number(code);
      return Number.isSafeInteger(number) && number <= 0x10ffff ? String.fromCodePoint(number) : _match;
    })
    .replace(/&#x([\da-f]+);/gi, (_match, code) => {
      const number = parseInt(code, 16);
      return Number.isSafeInteger(number) && number <= 0x10ffff ? String.fromCodePoint(number) : _match;
    });
}
