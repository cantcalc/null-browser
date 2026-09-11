import { contextBridge, ipcRenderer } from 'electron';
import { HistoryItem, SearchHistoryItem, BookmarkItem, ClosedTab, DownloadItemInfo, BrowserSettings, FavoriteItem, ClearDataOptions, Workspace, PermissionPrompt, UpdateStatus, InstalledExtension } from './types';

export interface ElectronAPI {
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  isMaximized: () => Promise<boolean>;

  // Settings & Preferences
  getSettings: () => Promise<BrowserSettings>;
  updateSettings: (updates: Partial<BrowserSettings>) => Promise<BrowserSettings>;
  resetSettings: () => Promise<BrowserSettings>;

  // Favorites (New Tab)
  getFavorites: () => Promise<FavoriteItem[]>;
  addFavorite: (fav: Omit<FavoriteItem, 'id'>) => Promise<FavoriteItem>;
  removeFavorite: (id: string) => Promise<void>;
  updateFavorite: (id: string, updates: Partial<FavoriteItem>) => Promise<void>;

  // Workspaces
  getWorkspaces: () => Promise<{ workspaces: Workspace[]; activeWorkspaceId: string }>;
  saveWorkspaces: (workspaces: Workspace[], activeWorkspaceId: string) => Promise<{ workspaces: Workspace[]; activeWorkspaceId: string }>;

  // Default Browser
  isDefaultBrowser: () => Promise<boolean>;
  makeDefaultBrowser: () => Promise<boolean>;

  // Backup & Import
  exportBookmarksHtml: () => Promise<string>;
  importBookmarksHtml: (html: string) => Promise<number>;
  exportSettingsJson: () => Promise<string>;
  importSettingsJson: (jsonStr: string) => Promise<boolean>;

  // Privacy & Site Controls
  clearBrowsingData: (options: ClearDataOptions) => Promise<void>;
  clearSiteData: (origin: string) => Promise<boolean>;
  getSiteZoom: (origin: string) => Promise<number>;
  setSiteZoom: (origin: string, zoom: number) => Promise<void>;
  getSitePermissions: (origin: string) => Promise<Record<string, 'allow' | 'deny'>>;
  getAllSitePermissions: () => Promise<Record<string, Record<string, 'allow' | 'deny'>>>;
  setSitePermission: (origin: string, permission: string, decision: 'allow' | 'deny' | 'default') => Promise<boolean>;
  resetSitePermissions: (origin: string) => Promise<boolean>;
  listSiteData: () => Promise<Array<{ origin: string; hostname: string; cookieCount: number }>>;

  // Window Management
  newWindow: (url?: string) => void;
  newPrivateWindow: (url?: string) => void;
  captureVisiblePage: () => Promise<string | null>;
  openFile: () => Promise<string | null>;
  printPage: (tabId: string) => void;
  savePageAsPdf: (tabId: string) => Promise<boolean>;
  getPageSource: (tabId: string) => Promise<string | null>;

  // Diagnostics
  getDiagnostics: () => Promise<{
    version: string;
    electronVersion: string;
    chromiumVersion: string;
    nodeVersion: string;
    platform: string;
    arch: string;
  }>;

  // Application updates
  checkForUpdates: () => Promise<UpdateStatus>;
  downloadUpdate: () => Promise<UpdateStatus>;
  installUpdate: () => void;
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;

  // Unpacked Chrome extensions (normal persistent session only)
  listExtensions: () => Promise<InstalledExtension[]>;
  installExtension: () => Promise<{ ok: boolean; extension?: InstalledExtension; error?: string }>;
  removeExtension: (id: string) => Promise<boolean>;

  // AdBlock
  getAdBlockStats: () => Promise<{ enabled: boolean; blockedCount: number }>;
  toggleAdBlock: (enabled?: boolean) => Promise<boolean>;
  onAdBlocked: (callback: (count: number) => void) => () => void;

  // History
  getHistory: () => Promise<HistoryItem[]>;
  addHistory: (url: string, title: string) => void;
  removeHistory: (id: string) => void;
  clearHistory: () => void;

  // Search History
  getSearchHistory: () => Promise<SearchHistoryItem[]>;
  addSearchHistory: (query: string, engineId: string) => void;
  removeSearchHistory: (id: string) => void;
  clearSearchHistory: () => void;

  // Bookmarks
  getBookmarks: () => Promise<BookmarkItem[]>;
  addBookmark: (title: string, url: string) => Promise<BookmarkItem>;
  updateBookmark: (id: string, updates: Partial<BookmarkItem>) => Promise<BookmarkItem | null>;
  removeBookmark: (id: string) => void;
  reorderBookmarks: (orderedIds: string[]) => Promise<BookmarkItem[]>;

  // Notes
  getNotes: () => Promise<string>;
  saveNotes: (content: string) => void;

  // Closed Tabs Stack
  getClosedTabs: () => Promise<ClosedTab[]>;
  pushClosedTab: (tab: ClosedTab) => void;
  popClosedTab: () => Promise<ClosedTab | null>;

  // Session
  getSession: () => Promise<{ tabs: { id: string; url: string; title: string; pinned: boolean; workspaceId?: string }[]; activeTabId: string | null } | null>;
  saveSession: (tabs: { id: string; url: string; title: string; pinned: boolean; workspaceId?: string }[], activeTabId: string | null) => void;
  getCrashRecovery: () => Promise<{ tabs: { id: string; url: string; title: string; pinned: boolean; workspaceId?: string }[]; activeTabId: string | null } | null>;
  resolveCrashRecovery: () => Promise<boolean>;

  // Downloads
  getDownloads: () => Promise<DownloadItemInfo[]>;
  chooseDownloadDirectory: () => Promise<string | null>;
  cancelDownload: (id: string) => void;
  openDownload: (id: string) => void;
  showInFinder: (id: string) => void;
  removeDownload: (id: string) => void;
  onDownloadUpdated: (callback: (info: DownloadItemInfo) => void) => () => void;
  onDownloadsCleared: (callback: (cutoff?: number) => void) => () => void;

  // Navigation & External
  onOpenExternal: (callback: (url: string) => void) => () => void;
  onOpenLinkInNewTab: (callback: (url: string) => void) => () => void;
  onOpenLinkInNewWindow: (callback: (url: string) => void) => () => void;
  onOpenLinkInSplitView: (callback: (url: string) => void) => () => void;
  onOpenLinkInPrivateWindow: (callback: (url: string) => void) => () => void;
  openExternal: (url: string) => void;

  // Translation
  translateText: (text: string, targetLang?: string) => Promise<string>;
  translateBatch: (texts: string[], targetLang?: string) => Promise<string[]>;
  onTranslateActive: (callback: () => void) => () => void;
  onSelectionTranslate: (callback: (text: string) => void) => () => void;
  onPermissionRequest: (callback: (request: PermissionPrompt) => void) => () => void;
  resolvePermissionRequest: (requestId: string, decision: 'allow' | 'deny' | 'once') => void;

  // Navigation
  onNavBackward: (callback: () => void) => () => void;
  onNavForward: (callback: () => void) => () => void;

  // Native Menu Actions
  onMenuAction: (callback: (action: string) => void) => () => void;

  // Native WebContentsView Tab API
  createTab: (tabId: string, initialUrl?: string, isIncognito?: boolean) => void;
  closeTab: (tabId: string) => void;
  switchTab: (tabId: string) => void;
  navigateTab: (tabId: string, url: string) => void;
  goBackTab: (tabId: string) => void;
  goForwardTab: (tabId: string) => void;
  reloadTab: (tabId: string, ignoreCache?: boolean) => void;
  stopTab: (tabId: string) => void;
  setTabMuted: (tabId: string, muted: boolean) => void;
  setTabZoom: (tabId: string, zoom: number) => void;
  findInTab: (tabId: string, text: string, forward: boolean) => void;
  stopFindInTab: (tabId: string) => void;
  toggleTabDevTools: (tabId: string) => void;
  translateTab: (tabId: string) => Promise<boolean>;
  setTabViewBounds: (bounds: { x: number; y: number; width: number; height: number }) => void;
  setTabOverlay: (isOverlay: boolean) => void;
  setSplitView: (enabled: boolean, secondaryTabId?: string | null, ratio?: number) => void;
  setSplitRatio: (ratio: number) => void;

  onTabStatusUpdated: (callback: (data: { id: string; url?: string; title?: string; canGoBack?: boolean; canGoForward?: boolean; isLoading?: boolean; favicon?: string; lifecycle?: 'active' | 'background' | 'crashed'; error?: { code: number; description: string; url: string } | null }) => void) => () => void;
  onTabFoundInPage: (callback: (data: { id: string; activeMatchOrdinal: number; matches: number }) => void) => () => void;
  onTabAudioChanged: (callback: (data: { id: string; audioPlaying: boolean }) => void) => () => void;
  onTabGesture: (callback: (data: { action: string }) => void) => () => void;
  onTabSwitchShortcut: (callback: (shortcut: number) => void) => () => void;
  onTabSwitchRelative: (callback: (delta: number) => void) => () => void;
  onTabHtmlFullscreen: (callback: (data: { id: string; fullscreen: boolean }) => void) => () => void;

  platform: string;
}

const electronAPI: ElectronAPI = {
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (updates) => ipcRenderer.invoke('settings:update', updates),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),

  getFavorites: () => ipcRenderer.invoke('favorites:get'),
  addFavorite: (fav) => ipcRenderer.invoke('favorites:add', fav),
  removeFavorite: (id) => ipcRenderer.invoke('favorites:remove', id),
  updateFavorite: (id, updates) => ipcRenderer.invoke('favorites:update', id, updates),

  getWorkspaces: () => ipcRenderer.invoke('workspaces:get'),
  saveWorkspaces: (workspaces, activeWorkspaceId) => ipcRenderer.invoke('workspaces:save', workspaces, activeWorkspaceId),

  isDefaultBrowser: () => ipcRenderer.invoke('app:isDefaultBrowser'),
  makeDefaultBrowser: () => ipcRenderer.invoke('app:makeDefaultBrowser'),

  exportBookmarksHtml: () => ipcRenderer.invoke('bookmarks:exportHtml'),
  importBookmarksHtml: (html) => ipcRenderer.invoke('bookmarks:importHtml', html),
  exportSettingsJson: () => ipcRenderer.invoke('settings:exportJson'),
  importSettingsJson: (jsonStr) => ipcRenderer.invoke('settings:importJson', jsonStr),

  clearBrowsingData: (options) => ipcRenderer.invoke('data:clearBrowsingData', options),
  clearSiteData: (origin) => ipcRenderer.invoke('site:clearData', origin),
  getSiteZoom: (origin) => ipcRenderer.invoke('site:getZoom', origin),
  setSiteZoom: (origin, zoom) => ipcRenderer.invoke('site:setZoom', origin, zoom),
  getSitePermissions: (origin) => ipcRenderer.invoke('site:getPermissions', origin),
  getAllSitePermissions: () => ipcRenderer.invoke('site:getAllPermissions'),
  setSitePermission: (origin, permission, decision) => ipcRenderer.invoke('site:setPermission', origin, permission, decision),
  resetSitePermissions: (origin) => ipcRenderer.invoke('site:resetPermissions', origin),
  listSiteData: () => ipcRenderer.invoke('site:listData'),

  newWindow: (url) => ipcRenderer.send('window:newWindow', url),
  newPrivateWindow: (url) => ipcRenderer.send('window:newPrivateWindow', url),
  captureVisiblePage: () => ipcRenderer.invoke('page:captureVisible'),
  openFile: () => ipcRenderer.invoke('file:open'),
  printPage: (tabId) => ipcRenderer.send('page:print', tabId),
  savePageAsPdf: (tabId) => ipcRenderer.invoke('page:savePdf', tabId),
  getPageSource: (tabId) => ipcRenderer.invoke('page:source', tabId),

  getDiagnostics: () => ipcRenderer.invoke('app:getDiagnostics'),
  checkForUpdates: () => ipcRenderer.invoke('app:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('app:update-download'),
  installUpdate: () => ipcRenderer.send('app:update-install'),
  onUpdateStatus: (callback) => {
    const sub = (_e: any, status: UpdateStatus) => callback(status);
    ipcRenderer.on('app:update-status', sub);
    return () => ipcRenderer.removeListener('app:update-status', sub);
  },

  listExtensions: () => ipcRenderer.invoke('extensions:list'),
  installExtension: () => ipcRenderer.invoke('extensions:install'),
  removeExtension: (id) => ipcRenderer.invoke('extensions:remove', id),

  getAdBlockStats: () => ipcRenderer.invoke('adblock:getStats'),
  toggleAdBlock: (enabled) => ipcRenderer.invoke('adblock:toggle', enabled),
  onAdBlocked: (callback) => {
    const sub = (_e: any, count: number) => callback(count);
    ipcRenderer.on('adblock:blocked', sub);
    return () => ipcRenderer.removeListener('adblock:blocked', sub);
  },

  getHistory: () => ipcRenderer.invoke('history:get'),
  addHistory: (url, title) => ipcRenderer.send('history:add', url, title),
  removeHistory: (id) => ipcRenderer.send('history:remove', id),
  clearHistory: () => ipcRenderer.send('history:clear'),

  getSearchHistory: () => ipcRenderer.invoke('search-history:get'),
  addSearchHistory: (query, engineId) => ipcRenderer.send('search-history:add', query, engineId),
  removeSearchHistory: (id) => ipcRenderer.send('search-history:remove', id),
  clearSearchHistory: () => ipcRenderer.send('search-history:clear'),

  getBookmarks: () => ipcRenderer.invoke('bookmarks:get'),
  addBookmark: (title, url) => ipcRenderer.invoke('bookmarks:add', title, url),
  updateBookmark: (id, updates) => ipcRenderer.invoke('bookmarks:update', id, updates),
  removeBookmark: (id) => ipcRenderer.send('bookmarks:remove', id),
  reorderBookmarks: (orderedIds) => ipcRenderer.invoke('bookmarks:reorder', orderedIds),

  getNotes: () => ipcRenderer.invoke('notes:get'),
  saveNotes: (content) => ipcRenderer.send('notes:save', content),

  getClosedTabs: () => ipcRenderer.invoke('tabs:getClosed'),
  pushClosedTab: (tab) => ipcRenderer.send('tabs:pushClosed', tab),
  popClosedTab: () => ipcRenderer.invoke('tabs:popClosed'),

  getSession: () => ipcRenderer.invoke('session:get'),
  saveSession: (tabs, activeTabId) => ipcRenderer.send('session:save', tabs, activeTabId),
  getCrashRecovery: () => ipcRenderer.invoke('session:getCrashRecovery'),
  resolveCrashRecovery: () => ipcRenderer.invoke('session:resolveCrashRecovery'),

  getDownloads: () => ipcRenderer.invoke('downloads:get'),
  chooseDownloadDirectory: () => ipcRenderer.invoke('downloads:choosePath'),
  cancelDownload: (id) => ipcRenderer.send('downloads:cancel', id),
  openDownload: (id) => ipcRenderer.send('downloads:open', id),
  showInFinder: (id) => ipcRenderer.send('downloads:showInFinder', id),
  removeDownload: (id) => ipcRenderer.send('downloads:remove', id),
  onDownloadUpdated: (callback) => {
    const sub = (_e: any, info: DownloadItemInfo) => callback(info);
    ipcRenderer.on('download:updated', sub);
    return () => ipcRenderer.removeListener('download:updated', sub);
  },
  onDownloadsCleared: (callback) => {
    const sub = (_e: any, cutoff?: number) => callback(cutoff);
    ipcRenderer.on('downloads:cleared', sub);
    return () => ipcRenderer.removeListener('downloads:cleared', sub);
  },

  onOpenExternal: (callback) => {
    const sub = (_e: any, url: string) => callback(url);
    ipcRenderer.on('tab:open-external', sub);
    return () => ipcRenderer.removeListener('tab:open-external', sub);
  },
  onOpenLinkInNewTab: (callback) => {
    const sub = (_e: any, url: string) => callback(url);
    ipcRenderer.on('tab:open-link-in-new-tab', sub);
    return () => ipcRenderer.removeListener('tab:open-link-in-new-tab', sub);
  },
  onOpenLinkInNewWindow: (callback) => {
    const sub = (_e: any, url: string) => callback(url);
    ipcRenderer.on('tab:open-link-in-new-window', sub);
    return () => ipcRenderer.removeListener('tab:open-link-in-new-window', sub);
  },
  onOpenLinkInSplitView: (callback) => {
    const sub = (_e: any, url: string) => callback(url);
    ipcRenderer.on('tab:open-link-in-split', sub);
    return () => ipcRenderer.removeListener('tab:open-link-in-split', sub);
  },
  onOpenLinkInPrivateWindow: (callback) => {
    const sub = (_e: any, url: string) => callback(url);
    ipcRenderer.on('tab:open-link-in-private-window', sub);
    return () => ipcRenderer.removeListener('tab:open-link-in-private-window', sub);
  },
  openExternal: (url) => ipcRenderer.send('shell:openExternal', url),

  translateText: (text, targetLang) => ipcRenderer.invoke('translate:text', text, targetLang),
  translateBatch: (texts, targetLang) => ipcRenderer.invoke('translate:batch', texts, targetLang),
  onTranslateActive: (callback) => {
    const sub = () => callback();
    ipcRenderer.on('tab:translate-active', sub);
    return () => ipcRenderer.removeListener('tab:translate-active', sub);
  },
  onSelectionTranslate: (callback) => {
    const sub = (_e: any, text: string) => callback(text);
    ipcRenderer.on('tab:selection-translate', sub);
    return () => ipcRenderer.removeListener('tab:selection-translate', sub);
  },
  onPermissionRequest: (callback) => {
    const sub = (_e: any, request: PermissionPrompt) => callback(request);
    ipcRenderer.on('permission:request', sub);
    return () => ipcRenderer.removeListener('permission:request', sub);
  },
  resolvePermissionRequest: (requestId, decision) => ipcRenderer.send('permission:resolve', requestId, decision),

  onNavBackward: (callback) => {
    const sub = () => callback();
    ipcRenderer.on('nav:app-backward', sub);
    return () => ipcRenderer.removeListener('nav:app-backward', sub);
  },
  onNavForward: (callback) => {
    const sub = () => callback();
    ipcRenderer.on('nav:app-forward', sub);
    return () => ipcRenderer.removeListener('nav:app-forward', sub);
  },

  onMenuAction: (callback) => {
    const events = [
      'menu:new-tab',
      'menu:close-tab',
      'menu:open-file',
      'menu:print',
      'menu:save-pdf',
      'menu:toggle-bookmark',
      'menu:toggle-bookmark-bar',
      'menu:reopen-closed-tab',
      'menu:open-library',
      'menu:open-command-palette',
      'menu:open-settings',
      'menu:open-about',
      'menu:reload',
      'menu:reload-nocache',
      'menu:open-find',
      'menu:reset-zoom',
      'menu:zoom-in',
      'menu:zoom-out',
      'menu:toggle-aside',
      'menu:toggle-devtools',
      'menu:focus-address-bar',
    ];
    const listeners = events.map((ev) => {
      const listener = () => callback(ev);
      ipcRenderer.on(ev, listener);
      return { ev, listener };
    });
    return () => {
      listeners.forEach(({ ev, listener }) => ipcRenderer.removeListener(ev, listener));
    };
  },

  // Native WebContentsView Tab API implementations
  createTab: (id, url, isIncognito) => ipcRenderer.send('tab:create', { id, url, isIncognito }),
  closeTab: (tabId) => ipcRenderer.send('tab:close', tabId),
  switchTab: (tabId) => ipcRenderer.send('tab:switch', tabId),
  navigateTab: (id, url) => ipcRenderer.send('tab:navigate', { id, url }),
  goBackTab: (tabId) => ipcRenderer.send('tab:goBack', tabId),
  goForwardTab: (tabId) => ipcRenderer.send('tab:goForward', tabId),
  reloadTab: (id, ignoreCache) => ipcRenderer.send('tab:reload', { id, ignoreCache }),
  stopTab: (tabId) => ipcRenderer.send('tab:stop', tabId),
  setTabMuted: (id, muted) => ipcRenderer.send('tab:setMuted', { id, muted }),
  setTabZoom: (id, zoom) => ipcRenderer.send('tab:setZoom', { id, zoom }),
  findInTab: (id, text, forward) => ipcRenderer.send('tab:find', { id, text, forward }),
  stopFindInTab: (tabId) => ipcRenderer.send('tab:stopFind', tabId),
  toggleTabDevTools: (tabId) => ipcRenderer.send('tab:toggleDevTools', tabId),
  translateTab: (tabId) => ipcRenderer.invoke('tab:translate', tabId),
  setTabViewBounds: (bounds) => ipcRenderer.send('tab:setBounds', bounds),
  setTabOverlay: (isOverlay) => ipcRenderer.send('tab:setOverlay', isOverlay),
  setSplitView: (enabled, secondaryTabId, ratio) => ipcRenderer.send('tab:setSplit', { enabled, secondaryTabId, ratio }),
  setSplitRatio: (ratio) => ipcRenderer.send('tab:setSplitRatio', ratio),

  onTabStatusUpdated: (callback) => {
    const sub = (_e: any, data: any) => callback(data);
    ipcRenderer.on('tab:status-updated', sub);
    return () => ipcRenderer.removeListener('tab:status-updated', sub);
  },
  onTabFoundInPage: (callback) => {
    const sub = (_e: any, data: any) => callback(data);
    ipcRenderer.on('tab:found-in-page', sub);
    return () => ipcRenderer.removeListener('tab:found-in-page', sub);
  },
  onTabAudioChanged: (callback) => {
    const sub = (_e: any, data: any) => callback(data);
    ipcRenderer.on('tab:audio-changed', sub);
    return () => ipcRenderer.removeListener('tab:audio-changed', sub);
  },
  onTabGesture: (callback) => {
    const sub = (_e: any, data: any) => callback(data);
    ipcRenderer.on('tab:gesture', sub);
    return () => ipcRenderer.removeListener('tab:gesture', sub);
  },
  onTabSwitchShortcut: (callback) => {
    const sub = (_e: any, shortcut: number) => callback(shortcut);
    ipcRenderer.on('tab:switch-shortcut', sub);
    return () => ipcRenderer.removeListener('tab:switch-shortcut', sub);
  },
  onTabSwitchRelative: (callback) => {
    const sub = (_e: any, delta: number) => callback(delta);
    ipcRenderer.on('tab:switch-relative', sub);
    return () => ipcRenderer.removeListener('tab:switch-relative', sub);
  },
  onTabHtmlFullscreen: (callback) => {
    const sub = (_e: any, data: { id: string; fullscreen: boolean }) => callback(data);
    ipcRenderer.on('tab:html-fullscreen', sub);
    return () => ipcRenderer.removeListener('tab:html-fullscreen', sub);
  },

  platform: process.platform,
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
