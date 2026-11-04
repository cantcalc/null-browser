import { SiteInfoPanel } from './components/SiteInfoPanel';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { HorizontalTabBar } from './components/HorizontalTabBar';
import { AddressBar } from './components/AddressBar';
import { WebViewContainer, WebViewContainerRef } from './components/WebViewContainer';
import { AsidePanel } from './components/AsidePanel';
import { FindBar } from './components/FindBar';
import { NewTabPage } from './components/NewTabPage';
import { FirstRunModal } from './components/FirstRunModal';
import { SettingsPage } from './components/SettingsPage';
import { internalPageTitle, isInternalPageUrl, isNewTabUrl, isSettingsUrl, normalizeSettingsUrl, settingsSectionFromUrl, settingsUrl, type SettingsSection } from '../shared/internalPages';
import { WorkspaceBar } from './components/WorkspaceBar';
import { Tab, Workspace, BrowserSettings, Bookmark, HistoryEntry, SearchHistoryItem, DownloadItem, ClearDataOptions, PermissionPrompt as PermissionPromptData } from './types/browser';
import { NavigationResult, parseNavigationInput } from './utils/navigationParser';
import { PermissionPrompt } from './components/PermissionPrompt';
import { BrowserErrorView } from './components/BrowserErrorView';
import { LibraryModal } from './components/LibraryModal';
const AISidebar = React.lazy(() => import('./components/ai/AISidebar'));

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
  startupPages: ['null://newtab'],
  favorites: [
    { id: 'fav-1', title: 'GitHub', url: 'https://github.com' },
    { id: 'fav-2', title: 'Hacker News', url: 'https://news.ycombinator.com' },
    { id: 'fav-3', title: 'Google', url: 'https://www.google.com' },
    { id: 'fav-4', title: 'YouTube', url: 'https://www.youtube.com' },
  ],
  downloadPath: '',
  askDownloadLocation: false,
  siteZoom: {},
  cookiePolicy: 'allow',
  cookieExceptions: {},
  preferredLanguages: ['ko-KR', 'en-US'],
  spellCheckEnabled: true,
};

const NEW_TAB_URL = 'null://newtab';
const DEFAULT_WORKSPACE_ID = 'workspace-default';
const PRIVATE_WORKSPACE_ID = 'workspace-private';

function normalizeTabUrl(url?: string): string | null {
  if (isNewTabUrl(url)) return NEW_TAB_URL;
  const settingsRoute = normalizeSettingsUrl(url);
  if (settingsRoute) return settingsRoute;
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'file:' ||
      (parsed.protocol === 'chrome-extension:' && /^[a-p]{32}$/.test(parsed.hostname))) return parsed.href;
  } catch {}
  return null;
}

function getSiteOrigin(url?: string): string | null {
  if (!url || isNewTabUrl(url)) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

function isExternalProtocolUrl(url: string): boolean {
  return /^(mailto|tel|vscode|zoommtg):/i.test(url);
}

function isSplitableTab(tab?: Tab): boolean {
  return Boolean(tab && !isInternalPageUrl(tab.url));
}

function makeTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `tab-${crypto.randomUUID()}`;
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const rawRequestedInitialUrl = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('initialUrl') : null;
// An absent launch URL must remain absent. Normalizing undefined to New Tab
// made every launch look explicit and silently skipped session restoration.
const requestedInitialUrl = rawRequestedInitialUrl ? normalizeTabUrl(rawRequestedInitialUrl) : null;

export const App: React.FC = () => {
  const webviewContainerRef = useRef<WebViewContainerRef>(null);
  const isIncognito =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('incognito') === '1';

  // 1. Settings & Preferences
  const [settings, setSettings] = useState<BrowserSettings>(DEFAULT_SETTINGS);

  // All visual states use the selected monochrome theme, not a saved accent.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', settings.theme || 'noir');
    root.setAttribute('data-interface-style', settings.interfaceStyle || 'studio');
  }, [settings.theme, settings.interfaceStyle]);

  // 2. Tabs State
  const [tabs, setTabs] = useState<Tab[]>([
    {
      id: 'tab-1',
      url: requestedInitialUrl || NEW_TAB_URL,
      title: isNewTabUrl(requestedInitialUrl || NEW_TAB_URL) ? '새 탭' : '로딩 중...',
      isLoading: !isNewTabUrl(requestedInitialUrl || NEW_TAB_URL),
      canGoBack: false,
      canGoForward: false,
      isPinned: false,
      isMuted: false,
      audioPlaying: false,
      createdAt: Date.now(),
      lastAccessed: Date.now(),
      lifecycle: 'active',
      workspaceId: isIncognito ? PRIVATE_WORKSPACE_ID : DEFAULT_WORKSPACE_ID,
    },
  ]);

  const [activeTabId, setActiveTabId] = useState<string | null>('tab-1');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([
    { id: isIncognito ? PRIVATE_WORKSPACE_ID : DEFAULT_WORKSPACE_ID, name: isIncognito ? '시크릿' : 'work', color: isIncognito ? '#8b5cf6' : '#3b82f6' },
  ]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(isIncognito ? PRIVATE_WORKSPACE_ID : DEFAULT_WORKSPACE_ID);
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitSecondaryTabId, setSplitSecondaryTabId] = useState<string | null>(null);
  const [splitRatio, setSplitRatio] = useState(() => {
    if (typeof window === 'undefined') return 0.5;
    const stored = Number(window.localStorage.getItem('null.splitRatio') ?? window.localStorage.getItem('aero.splitRatio'));
    return Number.isFinite(stored) && stored >= 0.3 && stored <= 0.7 ? stored : 0.5;
  });
  const [isWorkspaceNameOpen, setIsWorkspaceNameOpen] = useState(false);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState('');
  const [workspaceNameEditingId, setWorkspaceNameEditingId] = useState<string | null>(null);
  const tabsRef = useRef<Tab[]>([]);
  const activeTabIdRef = useRef<string | null>('tab-1');
  const activeWorkspaceIdRef = useRef(activeWorkspaceId);
  const workspacesRef = useRef<Workspace[]>(workspaces);
  const lastSavedSessionRef = useRef<string | null>(null);

  // 3. Browser Store Data
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);

  // 5. Find in page state
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findMatchIndex, setFindMatchIndex] = useState(0);
  const [findMatchTotal, setFindMatchTotal] = useState(0);

  // 6. Zoom
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const zoomLevelRef = useRef(1.0);

  tabsRef.current = tabs;
  activeTabIdRef.current = activeTabId;
  activeWorkspaceIdRef.current = activeWorkspaceId;
  workspacesRef.current = workspaces;
  zoomLevelRef.current = zoomLevel;

  const workspaceTabs = tabs.filter((tab) => tab.workspaceId === activeWorkspaceId);

  useEffect(() => {
    window.localStorage?.setItem('null.splitRatio', String(splitRatio));
  }, [splitRatio]);

  const handleSplitRatioChange = useCallback((ratio: number) => {
    const safeRatio = Math.min(0.7, Math.max(0.3, ratio));
    setSplitRatio(safeRatio);
    window.electronAPI?.setSplitRatio(safeRatio);
  }, []);

  // Prevent the first render's placeholder tab from overwriting a persisted
  // session before asynchronous startup restoration has completed.
  const [sessionReady, setSessionReady] = useState(
    () => typeof window === 'undefined' || !window.electronAPI
  );
  const [settingsReady, setSettingsReady] = useState(
    () => typeof window === 'undefined' || !window.electronAPI
  );
  // Onboarding is a packaged-app first-run flow. Keep it out of the Vite
  // development/browser preview so normal UI work is not blocked by it.
  const shouldShowFirstRun =
    !isIncognito &&
    !import.meta.env.DEV &&
    Boolean(window.electronAPI) &&
    settingsReady &&
    !settings.firstRunCompleted;

  // 7. Utility panel and browser dialogs
  const [isAsideOpen, setIsAsideOpen] = useState(false);
  const [asideMode, setAsideMode] = useState<'notes' | 'downloads'>('notes');
  const [isAIOpen, setIsAIOpen] = useState(false);
  const [aiMounted, setAIMounted] = useState(false);
  const [aiSelection, setAISelection] = useState<{ token: string; prompt: string; revision: number } | null>(null);
  const [isSiteInfoOpen, setIsSiteInfoOpen] = useState(false);
  const [settingsSiteOrigin, setSettingsSiteOrigin] = useState<string | null>(null);
  const selectedSiteOrigin = getSiteOrigin(tabs.find(tab => tab.id === activeTabId)?.url);
  useEffect(() => { setIsSiteInfoOpen(false); }, [activeTabId, selectedSiteOrigin]);
  const [sitePermissions, setSitePermissions] = useState<Record<string, 'allow' | 'deny'>>({});
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [pageSource, setPageSource] = useState<string | null>(null);
  const [permissionRequests, setPermissionRequests] = useState<PermissionPromptData[]>([]);
  const [crashRecovery, setCrashRecovery] = useState<{
    tabs: { id: string; url: string; title: string; pinned: boolean; workspaceId?: string }[];
    activeTabId: string | null;
  } | null>(null);
  const [htmlFullscreenTabId, setHtmlFullscreenTabId] = useState<string | null>(null);

  const handlePermissionResolution = useCallback((decision: 'allow' | 'deny' | 'once') => {
    const request = permissionRequests[0];
    if (!request) return;
    window.electronAPI?.resolvePermissionRequest(request.requestId, decision);
    setPermissionRequests((current) => current.slice(1));
  }, [permissionRequests]);

  useEffect(() => {
    const origin = selectedSiteOrigin;
    if (!origin || !window.electronAPI) {
      setSitePermissions({});
      return;
    }
    let cancelled = false;
    window.electronAPI.getSitePermissions(origin).then((permissions) => {
      if (!cancelled) setSitePermissions(permissions || {});
    }).catch(() => {
      if (!cancelled) setSitePermissions({});
    });
    return () => { cancelled = true; };
  }, [activeTabId, selectedSiteOrigin]);

  const refreshActiveSitePermissions = useCallback(() => {
    const origin = getSiteOrigin(tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)?.url);
    if (!origin || !window.electronAPI) {
      setSitePermissions({});
      return;
    }
    window.electronAPI.getSitePermissions(origin)
      .then((permissions) => setSitePermissions(permissions || {}))
      .catch(() => setSitePermissions({}));
  }, []);

  const handleSitePermissionChange = useCallback(async (permission: string, decision: 'allow' | 'deny' | 'default') => {
    const origin = getSiteOrigin(tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)?.url);
    if (!origin || !window.electronAPI) return false;
    const previous = sitePermissions[permission];
    setSitePermissions((current) => {
      const next = { ...current };
      if (decision === 'default') delete next[permission];
      else next[permission] = decision;
      return next;
    });
    let saved = false;
    try {
      saved = await window.electronAPI.setSitePermission(origin, permission, decision);
    } catch {
      saved = false;
    }
    if (!saved) {
      setSitePermissions((current) => {
        const next = { ...current };
        if (previous) next[permission] = previous;
        else delete next[permission];
        return next;
      });
    }
    return saved;
  }, [sitePermissions]);

  // Select Tab
  const handleSelectTab = useCallback((tabId: string) => {
    const selectedTab = tabsRef.current.find((tab) => tab.id === tabId);
    if (!selectedTab || selectedTab.workspaceId !== activeWorkspaceIdRef.current) return;
    const currentActiveId = activeTabIdRef.current;
    const shouldSwapSplitPanes = Boolean(splitEnabled && tabId === splitSecondaryTabId && currentActiveId && currentActiveId !== tabId);
    setActiveTabId(tabId);
    const now = Date.now();
    setTabs((prev) => prev.map((tab) => ({
      ...tab,
      lifecycle: tab.id === tabId ? 'active' : tab.lifecycle === 'crashed' ? 'crashed' : 'background',
      lastAccessed: tab.id === tabId ? now : tab.lastAccessed,
    })));
    if (shouldSwapSplitPanes && currentActiveId) {
      setSplitSecondaryTabId(currentActiveId);
    }
    if (window.electronAPI) {
      window.electronAPI.switchTab(tabId);
      // The native manager validates that the secondary is different from
      // the current primary, so switch first and then swap the pane IDs.
      if (shouldSwapSplitPanes && currentActiveId) {
        window.electronAPI.setSplitView(true, currentActiveId, splitRatio);
      }
    }
  }, [splitEnabled, splitSecondaryTabId, splitRatio]);

  // Tab Operations
  const handleNewTab = useCallback(
    (initialUrl = NEW_TAB_URL, options?: { select?: boolean; workspaceId?: string; id?: string }): string | null => {
      if (isExternalProtocolUrl(initialUrl)) {
        window.electronAPI?.openExternal(initialUrl);
        return null;
      }
      const requestedUrl = normalizeTabUrl(initialUrl) || NEW_TAB_URL;
      const safeUrl = isIncognito && isSettingsUrl(requestedUrl) ? NEW_TAB_URL : requestedUrl;
      const workspaceId = options?.workspaceId || activeWorkspaceIdRef.current;
      if (!workspacesRef.current.some((workspace) => workspace.id === workspaceId)) return null;
      const shouldSelect = options?.select !== false;
      const newTab: Tab = {
        id: options?.id || makeTabId(),
        url: safeUrl,
        title: isInternalPageUrl(safeUrl) ? internalPageTitle(safeUrl) : '로딩 중...',
        isLoading: !isInternalPageUrl(safeUrl),
        canGoBack: false,
        canGoForward: false,
        isPinned: false,
        isMuted: false,
        audioPlaying: false,
        createdAt: Date.now(),
        lastAccessed: Date.now(),
        lifecycle: shouldSelect ? 'active' : 'background',
        workspaceId,
      };

      if (window.electronAPI) {
        window.electronAPI.createTab(newTab.id, safeUrl, isIncognito, workspaceId);
        if (shouldSelect) window.electronAPI.switchTab(newTab.id);
      }

      // A native extension may select or close its tab immediately after
      // create() resolves, before React has committed the adoption render.
      if (options?.id && !tabsRef.current.some((tab) => tab.id === newTab.id)) {
        tabsRef.current = [...tabsRef.current, newTab];
      }
      setTabs((prev) => prev.some((tab) => tab.id === newTab.id) ? prev : [...prev, newTab]);
      if (shouldSelect) {
        if (options?.id) activeTabIdRef.current = newTab.id;
        setActiveTabId(newTab.id);
      }
      return newTab.id;
    },
    [isIncognito]
  );

  const persistWorkspaceState = useCallback((nextWorkspaces: Workspace[], nextActiveId: string) => {
    setWorkspaces(nextWorkspaces);
    setActiveWorkspaceId(nextActiveId);
    workspacesRef.current = nextWorkspaces;
    activeWorkspaceIdRef.current = nextActiveId;
    void window.electronAPI?.saveWorkspaces(nextWorkspaces, nextActiveId);
  }, []);

  const handleSelectWorkspace = useCallback((workspaceId: string) => {
    const workspace = workspacesRef.current.find((item) => item.id === workspaceId);
    if (!workspace || workspaceId === activeWorkspaceIdRef.current) return;
    const nextTabs = tabsRef.current.filter((tab) => tab.workspaceId === workspaceId);
    activeWorkspaceIdRef.current = workspaceId;
    setActiveWorkspaceId(workspaceId);
    setSplitEnabled(false);
    setSplitSecondaryTabId(null);
    window.electronAPI?.setSplitView(false);
    const nextActiveId = nextTabs[0]?.id || handleNewTab(NEW_TAB_URL, { workspaceId, select: true });
    if (!nextActiveId) return;
    setActiveTabId(nextActiveId);
    setTabs((prev) => prev.map((tab) => ({
      ...tab,
      lifecycle: tab.id === nextActiveId ? 'active' : tab.lifecycle === 'crashed' ? 'crashed' : 'background',
    })));
    window.electronAPI?.switchTab(nextActiveId);
    void window.electronAPI?.saveWorkspaces(workspacesRef.current, workspaceId);
  }, [handleNewTab]);

  const handleCreateWorkspace = useCallback(() => {
    if (isIncognito) return;
    setWorkspaceNameEditingId(null);
    setWorkspaceNameDraft(`워크스페이스 ${workspacesRef.current.length + 1}`);
    setIsWorkspaceNameOpen(true);
  }, [isIncognito]);

  const handleRenameWorkspace = useCallback(() => {
    if (isIncognito) return;
    const activeWorkspace = workspacesRef.current.find((workspace) => workspace.id === activeWorkspaceIdRef.current);
    if (!activeWorkspace) return;
    setWorkspaceNameEditingId(activeWorkspace.id);
    setWorkspaceNameDraft(activeWorkspace.name);
    setIsWorkspaceNameOpen(true);
  }, [isIncognito]);

  const handleConfirmCreateWorkspace = useCallback(() => {
    const name = workspaceNameDraft.trim();
    if (!name) return;

    if (workspaceNameEditingId) {
      const nextWorkspaces = workspacesRef.current.map((workspace) => (
        workspace.id === workspaceNameEditingId ? { ...workspace, name: name.slice(0, 80) } : workspace
      ));
      persistWorkspaceState(nextWorkspaces, activeWorkspaceIdRef.current);
      setWorkspaceNameEditingId(null);
      setIsWorkspaceNameOpen(false);
      return;
    }

    const colors = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#f43f5e'];
    const workspace: Workspace = {
      id: `workspace-${makeTabId().slice(4)}`,
      name: name.slice(0, 80),
      color: colors[workspacesRef.current.length % colors.length],
    };
    const nextWorkspaces = [...workspacesRef.current, workspace];
    persistWorkspaceState(nextWorkspaces, workspace.id);
    const newTabId = handleNewTab(NEW_TAB_URL, { workspaceId: workspace.id, select: true });
    if (newTabId) {
      activeWorkspaceIdRef.current = workspace.id;
      setActiveWorkspaceId(workspace.id);
      setActiveTabId(newTabId);
    }
    setWorkspaceNameEditingId(null);
    setIsWorkspaceNameOpen(false);
  }, [handleNewTab, persistWorkspaceState, workspaceNameDraft, workspaceNameEditingId]);

  const handleDeleteWorkspace = useCallback(() => {
    const currentWorkspaces = workspacesRef.current;
    if (currentWorkspaces.length <= 1) return;
    const deletingId = activeWorkspaceIdRef.current;
    const deletingTabs = tabsRef.current.filter((tab) => tab.workspaceId === deletingId);
    deletingTabs.forEach((tab) => window.electronAPI?.closeTab(tab.id));
    const nextWorkspaces = currentWorkspaces.filter((workspace) => workspace.id !== deletingId);
    const nextWorkspace = nextWorkspaces[0];
    if (!nextWorkspace) return;
    const remainingTabs = tabsRef.current.filter((tab) => tab.workspaceId !== deletingId);
    const nextWorkspaceTabs = remainingTabs.filter((tab) => tab.workspaceId === nextWorkspace.id);
    setTabs(remainingTabs);
    persistWorkspaceState(nextWorkspaces, nextWorkspace.id);
    activeWorkspaceIdRef.current = nextWorkspace.id;
    setSplitEnabled(false);
    setSplitSecondaryTabId(null);
    window.electronAPI?.setSplitView(false);
    const nextActiveId = nextWorkspaceTabs[0]?.id || handleNewTab(NEW_TAB_URL, { workspaceId: nextWorkspace.id, select: true });
    if (nextActiveId) {
      setActiveTabId(nextActiveId);
      window.electronAPI?.switchTab(nextActiveId);
    }
  }, [handleNewTab, persistWorkspaceState]);

  const handleToggleSplit = useCallback(() => {
    if (splitEnabled) {
      setSplitEnabled(false);
      setSplitSecondaryTabId(null);
      window.electronAPI?.setSplitView(false);
      return;
    }
    const currentActiveId = activeTabIdRef.current;
    const candidates = tabsRef.current.filter((tab) => tab.workspaceId === activeWorkspaceIdRef.current && tab.id !== currentActiveId && isSplitableTab(tab));
    const secondaryId = candidates[0]?.id;
    if (!currentActiveId || !secondaryId) return;
    setSplitEnabled(true);
    setSplitSecondaryTabId(secondaryId);
    window.electronAPI?.setSplitView(true, secondaryId, splitRatio);
  }, [handleNewTab, splitEnabled, splitRatio]);

  const handleSelectSplitTab = useCallback((tabId: string) => {
    const currentActiveId = activeTabIdRef.current;
    if (!currentActiveId || tabId === currentActiveId) return;
    const tab = tabsRef.current.find((item) => item.id === tabId);
    if (!tab || tab.workspaceId !== activeWorkspaceIdRef.current || !isSplitableTab(tab)) return;
    setSplitSecondaryTabId(tabId);
    setSplitEnabled(true);
    window.electronAPI?.setSplitView(true, tabId, splitRatio);
  }, [splitRatio]);

  const handleCloseTab = useCallback(
    (tabId: string, e?: React.MouseEvent) => {
      e?.stopPropagation();

      const currentTabs = tabsRef.current;
      const tabIndex = currentTabs.findIndex((t) => t.id === tabId);
      if (tabIndex < 0) return;
      const tabToClose = currentTabs[tabIndex];
      if (!isIncognito && tabToClose && window.electronAPI && !isNewTabUrl(tabToClose.url)) {
        window.electronAPI.pushClosedTab({
          url: tabToClose.url,
          title: tabToClose.title,
          closedAt: Date.now(),
        });
      }

      if (window.electronAPI) {
        window.electronAPI.closeTab(tabId);
      }

      let nextTabs = currentTabs.filter((t) => t.id !== tabId);

      if (tabId === activeTabIdRef.current) {
        const sameWorkspaceTabs = nextTabs.filter((tab) => tab.workspaceId === tabToClose.workspaceId);
        if (sameWorkspaceTabs.length === 0) {
          const freshTab: Tab = {
            id: makeTabId(), url: NEW_TAB_URL, title: '새 탭', isLoading: false,
            canGoBack: false, canGoForward: false, isPinned: false, isMuted: false,
            audioPlaying: false, createdAt: Date.now(), lastAccessed: Date.now(), lifecycle: 'active',
            workspaceId: tabToClose.workspaceId || activeWorkspaceIdRef.current,
          };
          nextTabs = [...nextTabs, freshTab];
          if (window.electronAPI) window.electronAPI.createTab(freshTab.id, freshTab.url, isIncognito, freshTab.workspaceId);
        }
        const candidates = nextTabs.filter((tab) => tab.workspaceId === tabToClose.workspaceId);
        const candidateIndex = Math.min(tabIndex, candidates.length - 1);
        const nextActive = candidates[Math.max(0, candidateIndex)]?.id || nextTabs[0]?.id;
        if (!nextActive) return;
        setActiveTabId(nextActive);
        window.electronAPI?.switchTab(nextActive);
      }

      const nextActiveId = tabId === activeTabIdRef.current
        ? (nextTabs.find((tab) => tab.id === activeTabIdRef.current)?.id || nextTabs.find((tab) => tab.workspaceId === tabToClose.workspaceId)?.id)
        : activeTabIdRef.current;
      let nextSecondaryId = splitSecondaryTabId && nextTabs.some((tab) => tab.id === splitSecondaryTabId)
        ? splitSecondaryTabId
        : null;
      if (nextSecondaryId && nextSecondaryId === nextActiveId) {
        nextSecondaryId = null;
      }
      if (splitEnabled && !nextSecondaryId && nextActiveId) {
        nextSecondaryId = nextTabs.find((tab) => tab.workspaceId === activeWorkspaceIdRef.current && tab.id !== nextActiveId && isSplitableTab(tab))?.id || null;
      }
      const keepSplit = Boolean(splitEnabled && nextActiveId && nextSecondaryId);
      setSplitEnabled(keepSplit);
      setSplitSecondaryTabId(keepSplit ? nextSecondaryId : null);
      window.electronAPI?.setSplitView(keepSplit, keepSplit ? nextSecondaryId : null);
      setTabs(nextTabs.map((tab) => ({
        ...tab,
        lifecycle: tab.id === nextActiveId ? 'active' : tab.lifecycle === 'crashed' ? 'crashed' : 'background',
      })));
      if (tabId !== activeTabIdRef.current) {
        // Closing a background tab must not move focus to another workspace.
        window.electronAPI?.switchTab(activeTabIdRef.current || '');
      }
    },
    [isIncognito, splitEnabled, splitSecondaryTabId]
  );

  const handleReopenClosedTab = useCallback(async () => {
    if (isIncognito) return;
    if (window.electronAPI) {
      const closed = await window.electronAPI.popClosedTab();
      if (closed && closed.url) {
        handleNewTab(closed.url);
      }
    }
  }, [handleNewTab, isIncognito]);

  const handleUpdateTab = useCallback((tabId: string, updates: Partial<Tab>) => {
    const current = tabsRef.current.find((tab) => tab.id === tabId);
    if (!current) return;
    const safeUrl = updates.url === undefined ? current.url : normalizeTabUrl(updates.url);
    if (!safeUrl) return;
    const normalizedUpdates = { ...updates, url: safeUrl };
    const shouldRecordHistory = settings.saveBrowsingHistory && !updates.error && !isIncognito && window.electronAPI && !isInternalPageUrl(safeUrl) &&
      (safeUrl !== current.url || (Boolean(updates.title) && updates.title !== current.title));
    if (shouldRecordHistory) {
      const historyTitle = updates.title || current.title;
      window.electronAPI?.addHistory(safeUrl, historyTitle);
      const visitedAt = Date.now();
      setHistory((prev) => {
        const recent = prev.find((item) => item.url === safeUrl && visitedAt - item.visitedAt < 30_000);
        if (recent) {
          return prev.map((item) => item.id === recent.id ? { ...item, title: historyTitle, visitedAt } : item).sort((a, b) => b.visitedAt - a.visitedAt);
        }
        return [{ id: `local-${visitedAt}-${Math.random().toString(36).slice(2, 7)}`, url: safeUrl, title: historyTitle, visitedAt }, ...prev].slice(0, 2000);
      });
    }
    setTabs((prev) => {
      const tab = prev.find(item => item.id === tabId);
      if (!tab || Object.entries(normalizedUpdates).every(([key, value]) => tab[key as keyof Tab] === value)) return prev;
      return prev.map(item => item.id === tabId ? { ...item, ...normalizedUpdates, lastAccessed: Date.now() } : item);
    });
  }, [isIncognito, settings.saveBrowsingHistory]);

  const handleReorderTabs = useCallback((sourceId: string, targetId: string) => {
    setTabs((prev) => {
      const srcIdx = prev.findIndex((t) => t.id === sourceId);
      const dstIdx = prev.findIndex((t) => t.id === targetId);
      if (srcIdx === -1 || dstIdx === -1) return prev;
      if (prev[srcIdx].workspaceId !== activeWorkspaceIdRef.current || prev[dstIdx].workspaceId !== activeWorkspaceIdRef.current) return prev;
      const next = [...prev];
      const [moved] = next.splice(srcIdx, 1);
      next.splice(dstIdx, 0, moved);
      return next;
    });
  }, []);

  const handleReorderBookmarks = useCallback((sourceId: string, targetId: string) => {
    setBookmarks((current) => {
      const sourceIndex = current.findIndex((item) => item.id === sourceId);
      const targetIndex = current.findIndex((item) => item.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      void window.electronAPI?.reorderBookmarks(next.map((item) => item.id)).then(setBookmarks).catch(() => {});
      return next;
    });
  }, []);

  const handleTogglePinTab = useCallback((tabId: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, isPinned: !t.isPinned } : t))
    );
  }, []);

  const handleToggleMuteTab = useCallback((tabId: string) => {
    const tab = tabsRef.current.find((item) => item.id === tabId);
    if (!tab) return;
    const nextMuted = !tab.isMuted;
    setTabs((prev) => prev.map((item) => (item.id === tabId ? { ...item, isMuted: nextMuted } : item)));
    window.electronAPI?.setTabMuted(tabId, nextMuted);
  }, []);

  const handleDuplicateTab = useCallback((tabId: string) => {
    const tab = tabsRef.current.find((item) => item.id === tabId);
    if (tab && tab.workspaceId === activeWorkspaceIdRef.current) handleNewTab(tab.url, { workspaceId: tab.workspaceId });
  }, [handleNewTab]);

  const handleCloseOtherTabs = useCallback((tabId: string) => {
    const currentTabs = tabsRef.current;
    const selected = currentTabs.find((tab) => tab.id === tabId);
    if (!selected || selected.workspaceId !== activeWorkspaceIdRef.current) return;
    const toClose = currentTabs.filter((tab) => tab.workspaceId === selected.workspaceId && tab.id !== tabId && !tab.isPinned);
    if (!isIncognito) {
      toClose.filter((tab) => !isNewTabUrl(tab.url)).forEach((tab) => {
        window.electronAPI?.pushClosedTab({ url: tab.url, title: tab.title, closedAt: Date.now() });
      });
    }
    toClose.forEach((tab) => window.electronAPI?.closeTab(tab.id));
    setTabs((prev) => prev.filter((tab) => tab.workspaceId !== selected.workspaceId || tab.id === tabId || tab.isPinned));
    if (splitEnabled) {
      setSplitEnabled(false);
      setSplitSecondaryTabId(null);
      window.electronAPI?.setSplitView(false);
    }
    setActiveTabId(tabId);
    window.electronAPI?.switchTab(tabId);
  }, [isIncognito, splitEnabled]);

  const handleCloseTabsToRight = useCallback((tabId: string) => {
    const currentTabs = tabsRef.current;
    const selected = currentTabs.find((tab) => tab.id === tabId);
    if (!selected || selected.workspaceId !== activeWorkspaceIdRef.current) return;
    const workspaceTabs = currentTabs.filter((tab) => tab.workspaceId === selected.workspaceId);
    const idx = workspaceTabs.findIndex((tab) => tab.id === tabId);
    if (idx < 0) return;
    const toClose = workspaceTabs.filter((tab, index) => index > idx && !tab.isPinned);
    if (!isIncognito) {
      toClose.filter((tab) => !isNewTabUrl(tab.url)).forEach((tab) => {
        window.electronAPI?.pushClosedTab({ url: tab.url, title: tab.title, closedAt: Date.now() });
      });
    }
    toClose.forEach((tab) => window.electronAPI?.closeTab(tab.id));
    const toCloseIds = new Set(toClose.map((tab) => tab.id));
    setTabs((prev) => prev.filter((tab) => !toCloseIds.has(tab.id)));
    if (splitEnabled && toCloseIds.has(splitSecondaryTabId || '')) {
      setSplitEnabled(false);
      setSplitSecondaryTabId(null);
      window.electronAPI?.setSplitView(false);
    }
    setActiveTabId(tabId);
    window.electronAPI?.switchTab(tabId);
  }, [isIncognito, splitEnabled, splitSecondaryTabId]);

  const handleReloadTab = useCallback((tabId: string) => {
    window.electronAPI?.reloadTab(tabId, false);
  }, []);

  // Settings updater
  const handleUpdateSettings = useCallback(async (updates: Partial<BrowserSettings>) => {
    if (window.electronAPI) {
      try {
        const persisted = await window.electronAPI.updateSettings(updates);
        setSettings(persisted);
      } catch (error) {
        console.error('Failed to persist settings:', error);
        return false;
      }
    } else {
      setSettings((prev) => ({ ...prev, ...updates }));
    }
    return true;
  }, []);

  const handleCloseSettings = useCallback(() => {
    const id = activeTabIdRef.current;
    if (id && isSettingsUrl(tabsRef.current.find((tab) => tab.id === id)?.url)) handleCloseTab(id);
  }, [handleCloseTab]);

  const handleOpenSettings = useCallback((section: SettingsSection = 'general') => {
    if (isIncognito) return;
    setIsSiteInfoOpen(false);
    setIsAsideOpen(false);
    setSplitEnabled(false);
    setSplitSecondaryTabId(null);
    window.electronAPI?.setSplitView(false);
    const url = settingsUrl(section);
    const existing = tabsRef.current.find((tab) => tab.workspaceId === activeWorkspaceIdRef.current && isSettingsUrl(tab.url));
    if (!existing) {
      handleNewTab(url);
      return;
    }
    setTabs((prev) => prev.map((tab) => tab.id === existing.id ? { ...tab, url, title: '설정', isLoading: false, error: undefined } : tab));
    setActiveTabId(existing.id);
    activeTabIdRef.current = existing.id;
    window.electronAPI?.navigateTab(existing.id, url);
    window.electronAPI?.switchTab(existing.id);
  }, [handleNewTab, isIncognito]);

  const handleToggleBookmark = useCallback(async () => {
    const tab = tabsRef.current.find((item) => item.id === activeTabIdRef.current);
    if (!tab || !/^https?:\/\//i.test(tab.url) || !window.electronAPI) return;
    const existing = bookmarks.find((bookmark) => bookmark.url === tab.url);
    try {
      if (existing) {
        window.electronAPI.removeBookmark(existing.id);
        setBookmarks((prev) => prev.filter((bookmark) => bookmark.id !== existing.id));
      } else {
        const bookmark = await window.electronAPI.addBookmark(tab.title, tab.url);
        setBookmarks((prev) => [bookmark, ...prev.filter((item) => item.url !== bookmark.url)]);
      }
    } catch (error) {
      console.error('Failed to update bookmark:', error);
    }
  }, [bookmarks]);

  const handleUpdateBookmark = useCallback(async (id: string, updates: { title: string; url: string }) => {
    try {
      const updated = await window.electronAPI?.updateBookmark(id, updates);
      if (updated) setBookmarks((prev) => prev.map((item) => item.id === id ? updated : item));
    } catch (error) {
      console.error('Failed to edit bookmark:', error);
    }
  }, []);

  const handleCopyText = useCallback((value: string) => {
    void navigator.clipboard.writeText(value).catch(() => {});
  }, []);

  // Initial Data Load & Restore
  useEffect(() => {
    if (!window.electronAPI) {
      setSessionReady(true);
      setSettingsReady(true);
      return;
    }

    const api = window.electronAPI;
    let cancelled = false;

    // 1. Settings and startup state are loaded together so a persisted
    // startup preference cannot race the session restore decision.
    const settingsPromise = api.getSettings().catch((error) => {
      console.error('Failed to load settings:', error);
      return DEFAULT_SETTINGS;
    });
    const workspacesPromise = api.getWorkspaces().catch((error) => {
      console.error('Failed to load workspaces:', error);
      return {
        workspaces: [{ id: isIncognito ? PRIVATE_WORKSPACE_ID : DEFAULT_WORKSPACE_ID, name: isIncognito ? '시크릿' : 'work', color: isIncognito ? '#8b5cf6' : '#3b82f6' }],
        activeWorkspaceId: isIncognito ? PRIVATE_WORKSPACE_ID : DEFAULT_WORKSPACE_ID,
      };
    });

    // 4. Session Restore (or Startup pages). Private windows always start
    // clean unless an explicit URL was supplied by the caller.
    const createTabState = (url: string, id = makeTabId(), pinned = false, workspaceId = activeWorkspaceIdRef.current): Tab => {
      const safeUrl = normalizeTabUrl(url) || NEW_TAB_URL;
      return {
        id,
        url: safeUrl,
        title: isInternalPageUrl(safeUrl) ? internalPageTitle(safeUrl) : '로딩 중...',
        isLoading: !isInternalPageUrl(safeUrl),
        canGoBack: false,
        canGoForward: false,
        isPinned: pinned,
        isMuted: false,
        audioPlaying: false,
        createdAt: Date.now(),
        lastAccessed: Date.now(),
        lifecycle: 'background',
        workspaceId,
      };
    };

    const start = async () => {
      const loadedSettings = await settingsPromise;
      if (!cancelled) {
        setSettings(loadedSettings);
        setSettingsReady(true);
      }
      const loadedWorkspaceState = await workspacesPromise;
      const availableWorkspaces = loadedWorkspaceState.workspaces?.length
        ? loadedWorkspaceState.workspaces
        : [{ id: isIncognito ? PRIVATE_WORKSPACE_ID : DEFAULT_WORKSPACE_ID, name: isIncognito ? '시크릿' : 'work', color: isIncognito ? '#8b5cf6' : '#3b82f6' }];
      const requestedWorkspace = new URLSearchParams(window.location.search).get('workspaceId') || loadedWorkspaceState.activeWorkspaceId;
      const loadedActiveWorkspaceId = availableWorkspaces.some((workspace) => workspace.id === requestedWorkspace)
        ? requestedWorkspace
        : availableWorkspaces[0].id;
      if (!cancelled) {
        setWorkspaces(availableWorkspaces);
        setActiveWorkspaceId(loadedActiveWorkspaceId);
      }
      const shouldUseRequestedUrl = Boolean(requestedInitialUrl);
      const sessionState = !isIncognito && !shouldUseRequestedUrl ? await api.getSession() : null;
      const crashedSession = !isIncognito && !shouldUseRequestedUrl ? await api.getCrashRecovery() : null;
      if (cancelled) return;
      if (crashedSession?.tabs?.length) setCrashRecovery(crashedSession);

      let initialTabs: Tab[];
      if (shouldUseRequestedUrl) {
        initialTabs = [createTabState(requestedInitialUrl!, 'tab-1', false, loadedActiveWorkspaceId)];
      } else if (isIncognito) {
        initialTabs = [createTabState(NEW_TAB_URL, 'tab-1', false, loadedActiveWorkspaceId)];
      } else if (!crashedSession && loadedSettings.startupBehavior === 'restore' && sessionState?.tabs?.length) {
        const seenIds = new Set<string>();
        initialTabs = sessionState.tabs
          .filter((tab) => tab.id && !seenIds.has(tab.id) && (seenIds.add(tab.id), true))
          .map((tab) => ({ ...createTabState(
            tab.url || NEW_TAB_URL,
            tab.id,
            tab.pinned,
            availableWorkspaces.some((workspace) => workspace.id === tab.workspaceId) ? tab.workspaceId : loadedActiveWorkspaceId,
          ), title: tab.title || (isInternalPageUrl(tab.url) ? internalPageTitle(tab.url) : '로딩 중...') }));
      } else if (loadedSettings.startupBehavior === 'specific' && loadedSettings.startupPages?.length) {
        initialTabs = loadedSettings.startupPages.map((url) => createTabState(url, makeTabId(), false, loadedActiveWorkspaceId));
      } else {
        initialTabs = [createTabState(NEW_TAB_URL, 'tab-1', false, loadedActiveWorkspaceId)];
      }

      const workspaceInitialTabs = initialTabs.filter((tab) => tab.workspaceId === loadedActiveWorkspaceId);
      if (workspaceInitialTabs.length === 0) {
        initialTabs = [...initialTabs, createTabState(NEW_TAB_URL, makeTabId(), false, loadedActiveWorkspaceId)];
      }
      const restoredActiveId = sessionState?.activeTabId && initialTabs.some((tab) => tab.id === sessionState.activeTabId && tab.workspaceId === loadedActiveWorkspaceId)
        ? sessionState.activeTabId
        : initialTabs.find((tab) => tab.workspaceId === loadedActiveWorkspaceId)?.id || initialTabs[0].id;
      initialTabs = initialTabs.map((tab) => ({
        ...tab,
        isLoading: tab.id === restoredActiveId && !isInternalPageUrl(tab.url),
        lifecycle: tab.id === restoredActiveId ? 'active' : 'background',
      }));

      // Restore metadata immediately, but don't start every invisible document
      // (and its renderer/network work) during startup. New user-opened tabs
      // still load in the background normally; already-open pages stay alive.
      initialTabs.forEach((tab) => api.createTab(tab.id, tab.url, isIncognito, tab.workspaceId, tab.id !== restoredActiveId));
      setTabs(initialTabs);
      setActiveTabId(restoredActiveId);
      api.switchTab(restoredActiveId);
      setSessionReady(true);
    };
    start().catch((error) => {
      console.error('Failed to initialize tabs:', error);
      if (!cancelled) {
        setSettingsReady(true);
        setSessionReady(true);
      }
    });

    if (!isIncognito) {
      api.getBookmarks().then((items) => { if (!cancelled) setBookmarks(items || []); })
        .catch((error) => console.error('Failed to load bookmarks:', error));
      api.getHistory().then((items) => { if (!cancelled) setHistory(items || []); })
        .catch((error) => console.error('Failed to load history:', error));
      api.getSearchHistory().then((items) => { if (!cancelled) setSearchHistory(items || []); })
        .catch((error) => console.error('Failed to load search history:', error));
    }
    // Private windows can reload their own in-memory downloads too. The main
    // process restricts this response to the caller's temporary session.
    api.getDownloads().then((items) => { if (!cancelled) setDownloads(previous => {
      const liveIds = new Set(previous.map(item => item.id));
      return [...previous, ...(items || []).filter(item => !liveIds.has(item.id))].sort((a, b) => b.startTime - a.startTime);
    }); }).catch((error) => console.error('Failed to load downloads:', error));

    // Listen for download updates
    const unsubDownload = api.onDownloadUpdated((info) => {
        setDownloads((prev) => {
          const existing = prev.find((d) => d.id === info.id);
          if (existing) {
            return prev.map((d) => (d.id === info.id ? info : d));
          }
          return [info, ...prev];
        });
    });
    const unsubDownloadsCleared = api.onDownloadsCleared((cutoff = 0) => {
        setDownloads((prev) => prev.filter((download) => download.state === 'progressing' || (cutoff > 0 && download.startTime < cutoff)));
    });

    // Listen for external URL opens (popups / target=_blank)
    const unsubExternal = api.onOpenExternal((url) => {
        // External links and site popups should focus the newly opened tab.
        // Only the explicit context-menu action below opens in the background.
        handleNewTab(url);
    });

    const unsubOpenLinkInNewTab = api.onOpenLinkInNewTab((url) => {
      handleNewTab(url, { select: false });
    });
    const unsubOpenLinkInNewWindow = api.onOpenLinkInNewWindow((url) => {
      api.newWindow(url);
    });
    const unsubOpenLinkInSplitView = api.onOpenLinkInSplitView((url) => {
      const newTabId = handleNewTab(url, { select: false });
      const currentActiveId = activeTabIdRef.current;
      if (!newTabId || !currentActiveId || newTabId === currentActiveId) return;
      setSplitSecondaryTabId(newTabId);
      setSplitEnabled(true);
      api.setSplitView(true, newTabId, splitRatio);
    });
    const unsubOpenLinkInPrivateWindow = api.onOpenLinkInPrivateWindow((url) => {
      api.newPrivateWindow(url);
    });

    // Listen for WebContentsView status updates
    const unsubStatus = api.onTabStatusUpdated((data) => {
        handleUpdateTab(data.id, data);
    });

    const unsubPermission = api.onPermissionRequest((request) => {
      setPermissionRequests((current) => current.some((item) => item.requestId === request.requestId) ? current : [...current, request]);
    });

    const unsubFind = api.onTabFoundInPage((data) => {
        setFindMatchIndex(data.activeMatchOrdinal);
        setFindMatchTotal(data.matches);
    });

    const unsubAudio = api.onTabAudioChanged((data) => {
        setTabs((prev) =>
          prev.map((t) => (t.id === data.id ? { ...t, audioPlaying: data.audioPlaying } : t))
        );
    });

    const unsubFullscreen = api.onTabHtmlFullscreen((data) => {
      setHtmlFullscreenTabId(data.fullscreen ? data.id : null);
      if (data.fullscreen) {
        setIsAsideOpen(false);
        setIsFindOpen(false);
        setIsSiteInfoOpen(false);
      }
    });

    const unsubGesture = api.onTabGesture((data) => {
        if (data.action === 'back') {
          api.goBackTab(data.tabId);
        } else if (data.action === 'forward') {
          api.goForwardTab(data.tabId);
        }
        else if (data.action === 'reload') handleReload();
    });

    // Listen for native macOS Menu commands
    const unsubMenu = api.onMenuAction((action) => {
        switch (action) {
          case 'menu:new-tab':
            handleNewTab();
            break;
          case 'menu:open-file':
            void handleOpenFile();
            break;
          case 'menu:print':
            handlePrintPage();
            break;
          case 'menu:save-pdf':
            handleSavePageAsPdf();
            break;
          case 'menu:toggle-bookmark':
            void handleToggleBookmark();
            break;
          case 'menu:toggle-bookmark-bar':
            void handleUpdateSettings({ showBookmarkBar: !settings.showBookmarkBar });
            break;
          case 'menu:close-tab':
            if (activeTabIdRef.current) handleCloseTab(activeTabIdRef.current);
            break;
          case 'menu:reopen-closed-tab':
            handleReopenClosedTab();
            break;
          case 'menu:open-library':
            setIsLibraryOpen(true);
            break;
          case 'menu:open-settings':
            handleOpenSettings();
            break;
          case 'menu:open-about':
            handleOpenSettings('about');
            break;
          case 'menu:toggle-aside':
            setIsSiteInfoOpen(false);
            setIsAsideOpen((p) => !p);
            break;
          case 'menu:reload':
            handleReload();
            break;
          case 'menu:reload-nocache':
            handleReloadWithoutCache();
            break;
          case 'menu:open-find':
            handleOpenFind();
            break;
          case 'menu:reset-zoom':
            handleResetZoom();
            break;
          case 'menu:zoom-in':
            handleChangeZoom(0.1);
            break;
          case 'menu:zoom-out':
            handleChangeZoom(-0.1);
            break;
          case 'menu:toggle-devtools':
            handleToggleDevTools();
            break;
          case 'menu:focus-address-bar':
            document.querySelector<HTMLInputElement>('input[placeholder*="검색"]')?.focus();
            document.querySelector<HTMLInputElement>('input[placeholder*="검색"]')?.select();
            break;
        }
    });

    return () => {
      cancelled = true;
      unsubDownload();
      unsubDownloadsCleared();
      unsubExternal();
      unsubOpenLinkInNewTab();
      unsubOpenLinkInNewWindow();
      unsubOpenLinkInSplitView();
      unsubOpenLinkInPrivateWindow();
      unsubStatus();
      unsubPermission();
      unsubFind();
      unsubAudio();
      unsubFullscreen();
      unsubGesture();
      unsubMenu();
    };
  }, [isIncognito, handleNewTab, handleOpenSettings, splitRatio]);

  // Keep native extension events current without rerunning startup restore
  // whenever split/workspace-dependent callbacks change.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api || isIncognito) return;
    const created = api.onExtensionTabCreated((data) => {
      if (data.active && data.workspaceId && data.workspaceId !== activeWorkspaceIdRef.current) handleSelectWorkspace(data.workspaceId);
      handleNewTab(data.url, { select: data.active, id: data.id, workspaceId: data.workspaceId });
    });
    const aiCreated = api.onAITabCreated((data) => {
      if (data.active && data.workspaceId !== activeWorkspaceIdRef.current) handleSelectWorkspace(data.workspaceId);
      handleNewTab(data.url, { select: data.active, id: data.id, workspaceId: data.workspaceId });
    });
    const aiSelectedText = api.onAISelection((data) => {
      if (data.workspaceId !== activeWorkspaceIdRef.current) return;
      setAIMounted(true); setIsAIOpen(true); setIsAsideOpen(false); setIsSiteInfoOpen(false);
      setAISelection({ token: data.token, prompt: data.prompt, revision: Date.now() });
    });
    const selected = api.onExtensionTabSelected((id) => {
      const tab = tabsRef.current.find((item) => item.id === id);
      if (!tab) return;
      if (tab.workspaceId && tab.workspaceId !== activeWorkspaceIdRef.current) handleSelectWorkspace(tab.workspaceId);
      handleSelectTab(id);
    });
    const closed = api.onExtensionTabClosed((id) => handleCloseTab(id));
    return () => { created(); selected(); closed(); aiCreated(); aiSelectedText(); };
  }, [isIncognito, handleNewTab, handleSelectWorkspace, handleSelectTab, handleCloseTab]);

  // Save session on tab changes (disabled in incognito)
  useEffect(() => {
    if (sessionReady && !isIncognito && !crashRecovery && window.electronAPI && tabs.length > 0) {
      const sessionTabs = tabs.map((t) => ({
        id: t.id,
        url: t.url,
        title: t.title,
        pinned: t.isPinned,
        workspaceId: t.workspaceId,
      }));
      const signature = JSON.stringify({ tabs: sessionTabs, activeTabId });
      if (signature === lastSavedSessionRef.current) return;
      lastSavedSessionRef.current = signature;
      window.electronAPI.saveSession(sessionTabs, activeTabId);
    }
  }, [tabs, activeTabId, isIncognito, sessionReady, crashRecovery]);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isNewTabPage = isNewTabUrl(activeTab?.url) || (isIncognito && isSettingsUrl(activeTab?.url));
  const isSettingsPage = !isIncognito && isSettingsUrl(activeTab?.url);
  const isHtmlFullscreen = Boolean(htmlFullscreenTabId);

  useEffect(() => {
    if (!isSettingsPage || !splitEnabled) return;
    setSplitEnabled(false);
    setSplitSecondaryTabId(null);
    window.electronAPI?.setSplitView(false);
  }, [isSettingsPage, splitEnabled]);

  const handleRestoreCrashSession = useCallback(async () => {
    if (!crashRecovery || !window.electronAPI) return;
    const seen = new Set<string>();
    const restoredTabs = crashRecovery.tabs.filter((item) => item.id && !seen.has(item.id) && (seen.add(item.id), true)).map((item): Tab => {
      const safeUrl = normalizeTabUrl(item.url) || NEW_TAB_URL;
      const requestedWorkspaceId = item.workspaceId;
      const workspaceId = requestedWorkspaceId && workspacesRef.current.some((workspace) => workspace.id === requestedWorkspaceId)
        ? requestedWorkspaceId
        : activeWorkspaceIdRef.current;
      return {
        id: item.id,
        url: safeUrl,
        title: item.title || (isNewTabUrl(safeUrl) ? '새 탭' : '로딩 중...'),
        isLoading: !isInternalPageUrl(safeUrl),
        canGoBack: false,
        canGoForward: false,
        isPinned: item.pinned,
        isMuted: false,
        audioPlaying: false,
        createdAt: Date.now(),
        lastAccessed: Date.now(),
        lifecycle: 'background',
        workspaceId,
      };
    });
    if (restoredTabs.length === 0) {
      await window.electronAPI.resolveCrashRecovery();
      setCrashRecovery(null);
      return;
    }
    tabsRef.current.forEach((tab) => window.electronAPI?.closeTab(tab.id));
    const requestedActive = crashRecovery.activeTabId && restoredTabs.some((tab) => tab.id === crashRecovery.activeTabId)
      ? crashRecovery.activeTabId
      : restoredTabs[0].id;
    const selected = restoredTabs.find((tab) => tab.id === requestedActive) || restoredTabs[0];
    const selectedWorkspaceId = selected.workspaceId || activeWorkspaceIdRef.current;
    activeWorkspaceIdRef.current = selectedWorkspaceId;
    setActiveWorkspaceId(selectedWorkspaceId);
    const nextTabs = restoredTabs.map((tab) => ({ ...tab, isLoading: tab.id === selected.id && !isInternalPageUrl(tab.url), lifecycle: tab.id === selected.id ? 'active' as const : 'background' as const }));
    nextTabs.forEach((tab) => window.electronAPI?.createTab(tab.id, tab.url, false, tab.workspaceId, tab.id !== selected.id));
    window.electronAPI.switchTab(selected.id);
    setSplitEnabled(false);
    setSplitSecondaryTabId(null);
    window.electronAPI.setSplitView(false);
    setTabs(nextTabs);
    setActiveTabId(selected.id);
    await window.electronAPI.resolveCrashRecovery();
    setCrashRecovery(null);
  }, [crashRecovery]);

  const handleStartFreshAfterCrash = useCallback(async () => {
    await window.electronAPI?.resolveCrashRecovery();
    setCrashRecovery(null);
  }, []);

  // Zoom is stored per web origin. Load it whenever the selected tab or its
  // origin changes, and apply it to the native WebContentsView for that tab.
  useEffect(() => {
    let cancelled = false;
    const origin = getSiteOrigin(activeTab?.url);

    if (!origin || !window.electronAPI) {
      setZoomLevel(1.0);
      if (activeTabId) webviewContainerRef.current?.setZoom(1.0);
      return () => {
        cancelled = true;
      };
    }

    window.electronAPI.getSiteZoom(origin).then((savedZoom) => {
      if (cancelled) return;
      const safeZoom = Number.isFinite(savedZoom) ? Math.min(5, Math.max(0.25, savedZoom)) : 1.0;
      setZoomLevel(safeZoom);
      if (activeTabId) webviewContainerRef.current?.setZoom(safeZoom);
    });

    return () => {
      cancelled = true;
    };
  }, [activeTabId, activeTab?.url]);

  // Navigation handlers
  const handleNavigate = useCallback(
    (url: string) => {
      if (isExternalProtocolUrl(url)) {
        window.electronAPI?.openExternal(url);
        return;
      }
      const requestedUrl = normalizeTabUrl(url);
      if (!requestedUrl) return;
      const safeUrl = isIncognito && isSettingsUrl(requestedUrl) ? NEW_TAB_URL : requestedUrl;
      if (activeTabId) {
        handleUpdateTab(activeTabId, {
          url: safeUrl,
          title: isInternalPageUrl(safeUrl) ? internalPageTitle(safeUrl) : '로딩 중...',
          isLoading: !isInternalPageUrl(safeUrl),
        });
        window.electronAPI?.navigateTab(activeTabId, safeUrl);
      } else {
        handleNewTab(safeUrl);
      }
    },
    [activeTabId, handleUpdateTab, handleNewTab, isIncognito]
  );

  const handleSearchExecuted = useCallback((result: NavigationResult) => {
    if (isIncognito || !settings.saveSearchHistory || !result.searchQuery?.trim()) return;
    const query = result.searchQuery.trim().slice(0, 500);
    const engineId = (result.searchEngine || settings.searchEngine).slice(0, 100);
    const searchedAt = Date.now();
    window.electronAPI?.addSearchHistory(query, engineId);
    setSearchHistory((prev) => {
      const recent = prev.find((item) => item.query === query && item.engineId === engineId && searchedAt - item.searchedAt < 30_000);
      if (recent) {
        return prev.map((item) => item.id === recent.id ? { ...item, searchedAt } : item).sort((a, b) => b.searchedAt - a.searchedAt);
      }
      return [{ id: `local-search-${searchedAt}-${Math.random().toString(36).slice(2, 7)}`, query, engineId, searchedAt }, ...prev].slice(0, 1000);
    });
  }, [isIncognito, settings.saveSearchHistory, settings.searchEngine]);

  const handleOpenFile = useCallback(async () => {
    const fileUrl = await window.electronAPI?.openFile();
    if (fileUrl) handleNavigate(fileUrl);
  }, [handleNavigate]);

  const handlePrintPage = useCallback(() => {
    if (activeTabId) window.electronAPI?.printPage(activeTabId);
  }, [activeTabId]);

  const handleSavePageAsPdf = useCallback(() => {
    if (activeTabId) void window.electronAPI?.savePageAsPdf(activeTabId);
  }, [activeTabId]);

  const handleSearchAgain = useCallback((query: string) => {
    const target = parseNavigationInput(query, {
      searchEngine: settings.searchEngine,
      customSearchUrl: settings.customSearchUrl,
    });
    handleSearchExecuted(target);
    handleNavigate(target.url);
    setIsLibraryOpen(false);
  }, [handleNavigate, handleSearchExecuted, settings.searchEngine, settings.customSearchUrl]);

  // Sync modal overlay state with native WebContentsView
  useEffect(() => {
    const hasOverlay = !settingsReady || shouldShowFirstRun || isWorkspaceNameOpen || isLibraryOpen || pageSource !== null || Boolean(activeTab?.error) || permissionRequests.length > 0;
    window.electronAPI?.setTabOverlay(hasOverlay);
  }, [settingsReady, shouldShowFirstRun, isWorkspaceNameOpen, isLibraryOpen, pageSource, activeTab?.error, permissionRequests.length]);

  const handleGoBack = useCallback(() => {
    webviewContainerRef.current?.goBack();
  }, []);

  const handleGoForward = useCallback(() => {
    webviewContainerRef.current?.goForward();
  }, []);

  const handleReload = useCallback(() => {
    webviewContainerRef.current?.reload();
  }, []);

  const handleReloadWithoutCache = useCallback(() => {
    webviewContainerRef.current?.reloadWithoutCache();
  }, []);

  const handleGoHome = useCallback(() => {
    handleNavigate(NEW_TAB_URL);
  }, [handleNavigate]);

  const handleFoundInPage = useCallback((res: { activeMatchOrdinal: number; matches: number }) => {
    setFindMatchIndex(res.activeMatchOrdinal);
    setFindMatchTotal(res.matches);
  }, []);

  // Listen for OS navigation commands.
  useEffect(() => {
    if (!window.electronAPI) return;

    const unsubAppBack = window.electronAPI.onNavBackward(() => {
      handleGoBack();
    });

    const unsubAppForward = window.electronAPI.onNavForward(() => {
      handleGoForward();
    });

    return () => {
      unsubAppBack();
      unsubAppForward();
    };
  }, [handleGoBack, handleGoForward]);

  // Native WebContentsView consumes keyboard input before the React chrome
  // can see it. Relay tab-switch shortcuts back into the React tab model.
  useEffect(() => {
    if (!window.electronAPI) return;

    const unsubShortcut = window.electronAPI.onTabSwitchShortcut((shortcut) => {
      const index = shortcut === 9 ? workspaceTabs.length - 1 : shortcut - 1;
      if (index >= 0 && workspaceTabs[index]) handleSelectTab(workspaceTabs[index].id);
    });
    const unsubRelative = window.electronAPI.onTabSwitchRelative((delta) => {
      if (workspaceTabs.length < 2) return;
      const currentIndex = workspaceTabs.findIndex((tab) => tab.id === activeTabId);
      if (currentIndex < 0) return;
      const nextIndex = (currentIndex + delta + workspaceTabs.length) % workspaceTabs.length;
      handleSelectTab(workspaceTabs[nextIndex].id);
    });

    return () => {
      unsubShortcut();
      unsubRelative();
    };
  }, [workspaceTabs, activeTabId, handleSelectTab]);

  // Global mouse button 3 (Back) & button 4 (Forward) listener across window chrome
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        e.stopPropagation();
        handleGoBack();
      } else if (e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
        handleGoForward();
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [handleGoBack, handleGoForward]);

  // DevTools
  const handleToggleDevTools = useCallback(() => {
    webviewContainerRef.current?.toggleDevTools();
  }, []);

  // Find in Page
  const handleOpenFind = useCallback(() => {
    setIsFindOpen(true);
  }, []);

  const handleCloseFind = useCallback(() => {
    setIsFindOpen(false);
    webviewContainerRef.current?.stopFindInPage();
  }, []);

  const handleFind = useCallback((text: string, forward: boolean) => {
    if (!text.trim()) {
      setFindMatchIndex(0);
      setFindMatchTotal(0);
      webviewContainerRef.current?.stopFindInPage();
      return;
    }
    webviewContainerRef.current?.findInPage(text, forward);
  }, []);

  // Zoom
  const handleChangeZoom = useCallback((delta: number) => {
    const next = Math.min(5, Math.max(0.25, Math.round((zoomLevelRef.current + delta) * 10) / 10));
    setZoomLevel(next);
    webviewContainerRef.current?.setZoom(next);
    const origin = getSiteOrigin(tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)?.url);
    if (origin) void window.electronAPI?.setSiteZoom(origin, next);
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoomLevel(1.0);
    webviewContainerRef.current?.setZoom(1.0);
    const origin = getSiteOrigin(tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)?.url);
    if (origin) void window.electronAPI?.setSiteZoom(origin, 1.0);
  }, []);

  // Keyboard Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmd = e.metaKey || e.ctrlKey;

      // Settings: ⌘,
      if (isCmd && e.key === ',') {
        e.preventDefault();
        handleOpenSettings();
      }
      // DevTools: ⌥⌘I or F12
      else if ((isCmd && e.altKey && e.key.toLowerCase() === 'i') || e.key === 'F12') {
        e.preventDefault();
        handleToggleDevTools();
      }
      // Reopen closed tab: ⌘⇧T
      else if (isCmd && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        handleReopenClosedTab();
      }
      // Library: ⌘⇧H
      else if (isCmd && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setIsLibraryOpen((open) => !open);
      }
      // Bookmark bar: ⌘⇧B
      else if (isCmd && e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        void handleUpdateSettings({ showBookmarkBar: !settings.showBookmarkBar });
      }
      // New Tab: ⌘T
      else if (isCmd && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        handleNewTab();
      }
      // Open local file: ⌘O
      else if (isCmd && !e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void handleOpenFile();
      }
      // Print: ⌘P
      else if (isCmd && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        handlePrintPage();
      }
      // Close Tab: ⌘W
      else if (isCmd && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (activeTabId) handleCloseTab(activeTabId);
      }
      // Reload: ⌘R
      else if (isCmd && !e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        handleReload();
      }
      // Reload without cache: ⌘⇧R
      else if (isCmd && e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        handleReloadWithoutCache();
      }
      // Find in page: ⌘F
      else if (isCmd && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        handleOpenFind();
      }
      // Aside Drawer: ⌘\
      else if (isCmd && e.key === '\\') {
        e.preventDefault();
        setIsSiteInfoOpen(false);
        setIsAsideOpen((prev) => !prev);
      }
      // Back: ⌘[
      else if (isCmd && e.key === '[') {
        e.preventDefault();
        handleGoBack();
      }
      // Forward: ⌘]
      else if (isCmd && e.key === ']') {
        e.preventDefault();
        handleGoForward();
      }
      // Zoom In: ⌘+ or ⌘=
      else if (isCmd && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        handleChangeZoom(0.1);
      }
      // Zoom Out: ⌘-
      else if (isCmd && e.key === '-') {
        e.preventDefault();
        handleChangeZoom(-0.1);
      }
      // Reset Zoom: ⌘0
      else if (isCmd && e.key === '0') {
        e.preventDefault();
        handleResetZoom();
      }
      // Tab switching by number: ⌘1..8
      else if (isCmd && e.key >= '1' && e.key <= '8') {
        const tabIndex = parseInt(e.key, 10) - 1;
        if (workspaceTabs[tabIndex]) {
          e.preventDefault();
          handleSelectTab(workspaceTabs[tabIndex].id);
        }
      }
      // Last tab: ⌘9
      else if (isCmd && e.key === '9') {
        if (workspaceTabs.length > 0) {
          e.preventDefault();
          handleSelectTab(workspaceTabs[workspaceTabs.length - 1].id);
        }
      }
      // Ctrl+Tab / Ctrl+Shift+Tab
      else if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        if (workspaceTabs.length > 1) {
          const currentIdx = workspaceTabs.findIndex((t) => t.id === activeTabId);
          const nextIdx = e.shiftKey
            ? (currentIdx - 1 + workspaceTabs.length) % workspaceTabs.length
            : (currentIdx + 1) % workspaceTabs.length;
          handleSelectTab(workspaceTabs[nextIdx].id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    handleNewTab,
    handleOpenSettings,
    handleOpenFile,
    handlePrintPage,
    handleToggleBookmark,
    handleUpdateSettings,
    settings.showBookmarkBar,
    handleCloseTab,
    handleReopenClosedTab,
    handleToggleDevTools,
    handleOpenFind,
    handleChangeZoom,
    handleResetZoom,
    handleReload,
    handleReloadWithoutCache,
    handleGoBack,
    handleGoForward,
    handleSelectTab,
    workspaceTabs,
    activeTabId,
  ]);

  return (
    <div className={`null-app theme-transition flex flex-col h-screen w-screen overflow-hidden bg-[var(--chrome-bg)] font-sans text-[var(--text-primary)] antialiased select-none ${isIncognito ? 'null-private' : ''}`} data-private={isIncognito ? 'true' : 'false'} data-platform={window.electronAPI?.platform || 'web'}>
      <div
        className={`null-connected-chrome flex-none ${isHtmlFullscreen ? 'hidden' : ''}`}
      >
      {/* Normal windows show workspace controls. Private windows reserve
          native window-control space directly in the tab row instead. */}
      {!isIncognito && <WorkspaceBar
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        tabs={tabs}
        activeTabId={activeTabId}
        splitEnabled={splitEnabled}
        splitSecondaryTabId={splitSecondaryTabId}
        splitRatio={splitRatio}
        onSelectWorkspace={handleSelectWorkspace}
        onCreateWorkspace={handleCreateWorkspace}
        onRenameWorkspace={handleRenameWorkspace}
        onDeleteWorkspace={handleDeleteWorkspace}
        onToggleSplit={handleToggleSplit}
        onSelectSplitTab={handleSelectSplitTab}
        onSplitRatioChange={handleSplitRatioChange}
      />}

      {!isIncognito && isWorkspaceNameOpen && (
        <div className="null-overlay fixed inset-0 z-[60] flex items-start justify-center pt-20" onClick={() => { setWorkspaceNameEditingId(null); setIsWorkspaceNameOpen(false); }}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              handleConfirmCreateWorkspace();
            }}
            onClick={(event) => event.stopPropagation()}
            className="null-modal w-[min(22rem,calc(100vw-2rem))] p-4 text-[var(--text-primary)]"
          >
            <div className="mb-3 text-sm font-semibold">{workspaceNameEditingId ? '워크스페이스 이름 수정' : '새 워크스페이스'}</div>
            <input
              autoFocus
              value={workspaceNameDraft}
              onChange={(event) => setWorkspaceNameDraft(event.target.value.slice(0, 80))}
              onKeyDown={(event) => {
                if (event.key === 'Escape') { setWorkspaceNameEditingId(null); setIsWorkspaceNameOpen(false); }
              }}
              placeholder="이름 입력"
              className="null-field h-9 w-full px-3 text-sm outline-none"
              aria-label="워크스페이스 이름"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => { setWorkspaceNameEditingId(null); setIsWorkspaceNameOpen(false); }} className="null-quiet-button border-transparent px-3 py-1.5 text-xs">
                취소
              </button>
              <button type="submit" disabled={!workspaceNameDraft.trim()} className="null-primary-button px-3 py-1.5 text-xs font-medium">
                {workspaceNameEditingId ? '저장' : '만들기'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 2. Horizontal Tab Bar (macOS Aside Style with Drag & Drop) */}
      <HorizontalTabBar
        tabs={workspaceTabs}
        activeTabId={activeTabId}
        isAsideOpen={isAsideOpen}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onNewTab={handleNewTab}
        onTogglePinTab={handleTogglePinTab}
        onToggleMuteTab={handleToggleMuteTab}
        onDuplicateTab={handleDuplicateTab}
        onCloseOtherTabs={handleCloseOtherTabs}
        onCloseTabsToRight={handleCloseTabsToRight}
        onReloadTab={handleReloadTab}
        onToggleAside={() => { setIsSiteInfoOpen(false); setIsAsideOpen((prev) => !prev); }}
        onReorderTabs={handleReorderTabs}
      />

      {/* 3. Omnibox Toolbar with Site controls and zoom */}
      <AddressBar
        downloads={downloads}
        isDownloadsOpen={isAsideOpen && asideMode === 'downloads'}
        onOpenDownloads={() => { setAsideMode('downloads'); setIsAsideOpen(true); setIsAIOpen(false); setIsSiteInfoOpen(false); }}
        isAIOpen={isAIOpen}
        onToggleAI={() => { setAIMounted(true); setIsAIOpen(value => !value); setIsAsideOpen(false); setIsSiteInfoOpen(false); }}
        isIncognito={isIncognito}
        onNewPrivateWindow={() => window.electronAPI?.newPrivateWindow()}
        workspaceId={activeWorkspaceId}
        activeTab={activeTab}
        searchEngine={settings.searchEngine}
        customSearchUrl={settings.customSearchUrl}
        isBookmarked={Boolean(activeTab?.url && bookmarks.some((bookmark) => bookmark.url === activeTab.url))}
        isAsideOpen={isAsideOpen}
        isSiteInfoOpen={isSiteInfoOpen}
        onToggleSiteInfo={() => { setIsAIOpen(false); setIsAsideOpen(false); setIsSiteInfoOpen(open => !open); }}
        zoomLevel={zoomLevel}
        onNavigate={handleNavigate}
        onSearchExecuted={handleSearchExecuted}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        onReload={handleReload}
        onGoHome={handleGoHome}
        onToggleDevTools={handleToggleDevTools}
        onOpenSettings={() => handleOpenSettings()}
        onToggleAside={() => setIsAsideOpen((prev) => !prev)}
        onResetZoom={handleResetZoom}
        onToggleBookmark={handleToggleBookmark}
      />
      {settings.showBookmarkBar && (
        <div className="null-bookmark-bar flex min-w-0 items-center gap-1 overflow-x-auto no-scrollbar px-3 py-1 titlebar-no-drag" aria-label="북마크 바">
          {bookmarks.length === 0 ? (
            <span className="px-1 text-[10px] text-[var(--text-muted)]">북마크를 추가하면 여기에 표시됩니다.</span>
          ) : bookmarks.slice(0, 40).map((bookmark) => (
            <button
              key={bookmark.id}
              type="button"
              draggable
              title={bookmark.url}
              onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', bookmark.id); }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); const sourceId = event.dataTransfer.getData('text/plain'); if (sourceId) handleReorderBookmarks(sourceId, bookmark.id); }}
              onClick={() => handleNavigate(bookmark.url)}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  handleNewTab(bookmark.url);
                }
              }}
              className="null-bookmark-item inline-flex max-w-44 shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-[11px] text-[var(--text-secondary)]"
            >
              <span className="truncate">{bookmark.title || bookmark.url}</span>
            </button>
          ))}
        </div>
      )}
      </div>

      {/* Reserve space for Find; it is not a modal that hides the webpage. */}
      <FindBar
        isOpen={isFindOpen}
        onClose={handleCloseFind}
        onFind={handleFind}
        matchIndex={findMatchIndex}
        matchTotal={findMatchTotal}
      />

      {/* 4. Viewport & Aside Drawer Panel */}
      <div className="null-content-stage flex-1 flex min-h-0 relative overflow-hidden">
        {crashRecovery && !isHtmlFullscreen && (
          <div className="null-popover absolute left-4 right-4 top-3 z-40 flex flex-wrap items-center gap-3 px-4 py-3 text-xs">
            <div className="min-w-0 flex-1"><div className="font-medium text-[var(--text-primary)]">이전 실행이 예기치 않게 종료되었습니다.</div><div className="mt-0.5 text-[var(--text-muted)]">이전 일반 창의 탭을 복원할 수 있습니다.</div></div>
            <button type="button" onClick={() => void handleRestoreCrashSession()} className="null-primary-button px-3 py-1.5 text-xs">탭 복원</button>
            <button type="button" onClick={() => void handleStartFreshAfterCrash()} className="null-quiet-button px-3 py-1.5 text-xs">새로 시작</button>
          </div>
        )}

        {/* Viewport Content: NULL New Tab Page OR Webviews */}
        <div className="flex-1 min-w-0 relative overflow-hidden bg-[var(--chrome-bg)]">
      {/* Built-in settings page; native views are hidden for this internal URL. */}
      {!isIncognito && <SettingsPage
        workspaceId={activeWorkspaceId}
        isOpen={isSettingsPage && !isHtmlFullscreen}
        initialTab={settingsSectionFromUrl(activeTab?.url)}
        initialSiteOrigin={settingsSiteOrigin}
        onSectionChange={(section) => handleNavigate(settingsUrl(section))}
        settings={settings}
        onClose={handleCloseSettings}
        onUpdateSettings={handleUpdateSettings}
        onPermissionsChanged={refreshActiveSitePermissions}
        onDataCleared={(options: ClearDataOptions) => {
          if (options.history) {
            const cutoff = options.timeRange === 'hour'
              ? Date.now() - 3600 * 1000
              : options.timeRange === 'day'
                ? Date.now() - 24 * 3600 * 1000
                : options.timeRange === 'week'
                  ? Date.now() - 7 * 24 * 3600 * 1000
                : 0;
            setHistory((prev) => (cutoff === 0 ? [] : prev.filter((entry) => entry.visitedAt < cutoff)));
          }
          if (options.searchHistory) {
            const cutoff = options.timeRange === 'hour'
              ? Date.now() - 3600 * 1000
              : options.timeRange === 'day'
                ? Date.now() - 24 * 3600 * 1000
                : options.timeRange === 'week'
                  ? Date.now() - 7 * 24 * 3600 * 1000
                  : 0;
            setSearchHistory((prev) => (cutoff === 0 ? [] : prev.filter((entry) => entry.searchedAt < cutoff)));
          }
          if (options.downloads) {
            const cutoff = options.timeRange === 'hour'
              ? Date.now() - 3600 * 1000
              : options.timeRange === 'day'
                ? Date.now() - 24 * 3600 * 1000
                : options.timeRange === 'week'
                  ? Date.now() - 7 * 24 * 3600 * 1000
                  : 0;
            setDownloads((prev) => prev.filter((download) => download.state === 'progressing' || (cutoff > 0 && download.startTime < cutoff)));
          }
        }}
        onBookmarksChanged={() => {
          window.electronAPI?.getBookmarks().then(setBookmarks).catch((error) => console.error('Failed to refresh bookmarks:', error));
        }}
      />}


          {isNewTabPage && !isHtmlFullscreen && (
            <NewTabPage
              settings={settings}
              isIncognito={isIncognito}
              onNavigate={handleNavigate}
              onSearchExecuted={handleSearchExecuted}
            />
          )}

          <div className={`w-full h-full ${isNewTabPage && !isHtmlFullscreen ? 'hidden' : 'block'}`}>
            <WebViewContainer
              ref={webviewContainerRef}
              tabs={workspaceTabs}
              activeTabId={activeTabId}
              layoutKey={`${isSiteInfoOpen}:${isAsideOpen}:${isAIOpen}:${isFindOpen}:${settings.showBookmarkBar}:${isHtmlFullscreen}:${settings.interfaceStyle}`}
              onUpdateTab={handleUpdateTab}
              onNewTab={handleNewTab}
              onSelectTab={handleSelectTab}
              onFoundInPage={handleFoundInPage}
            />
          </div>
          {!isNewTabPage && !isHtmlFullscreen && activeTab?.error && (
            <BrowserErrorView
              error={activeTab.error}
              onRetry={handleReload}
              onGoBack={handleGoBack}
            />
          )}
        </div>

        {isSiteInfoOpen && !isHtmlFullscreen && getSiteOrigin(activeTab?.url) && activeTab && (
          <SiteInfoPanel key={getSiteOrigin(activeTab.url)} url={activeTab.url} permissions={sitePermissions}
            muted={activeTab.isMuted} zoom={zoomLevel} onClose={() => setIsSiteInfoOpen(false)}
            onOpenSettings={isIncognito ? undefined : () => { setSettingsSiteOrigin(getSiteOrigin(activeTab.url)); handleOpenSettings('sites'); }}
            onPermissionChange={handleSitePermissionChange}
            onResetPermissions={async () => {
              const origin = getSiteOrigin(activeTab.url);
              if (!origin || !window.electronAPI) return false;
              const ok = await window.electronAPI.resetSitePermissions(origin);
              if (ok) refreshActiveSitePermissions();
              return ok;
            }}
            onToggleMute={() => handleToggleMuteTab(activeTab.id)} onZoomIn={() => handleChangeZoom(0.1)}
            onZoomOut={() => handleChangeZoom(-0.1)} onResetZoom={handleResetZoom} />
        )}
        {/* Utility panel (Notes, Downloads) */}
        {!isIncognito && aiMounted && !isHtmlFullscreen && <React.Suspense fallback={null}><AISidebar key={activeWorkspaceId} workspaceId={activeWorkspaceId} tabs={workspaceTabs} activeTabId={activeTabId} open={isAIOpen} onClose={() => setIsAIOpen(false)} onSettings={() => { setIsAIOpen(false); handleOpenSettings('ai'); }} onShowTab={handleSelectTab} selection={aiSelection} /></React.Suspense>}
        <AsidePanel
          activeMode={asideMode}
          onModeChange={setAsideMode}
          isOpen={isAsideOpen}
          activeTab={activeTab}
          downloads={downloads}
          onClose={() => setIsAsideOpen(false)}
          isIncognito={isIncognito}
          onOpenDownload={(id) => window.electronAPI?.openDownload(id)}
          onShowDownloadInFinder={(id) => window.electronAPI?.showInFinder(id)}
          onCancelDownload={(id) => window.electronAPI?.cancelDownload(id)}
          onRemoveDownload={(id) => { window.electronAPI?.removeDownload(id); setDownloads(items => items.filter(item => item.id !== id)); }}
        />
      </div>

      {pageSource !== null && (
        <div className="null-overlay fixed inset-0 z-[75] flex items-start justify-center overflow-y-auto px-4 pb-6 pt-16" onClick={() => setPageSource(null)}>
          <section className="null-modal flex max-h-[calc(100dvh-5rem)] min-h-[20rem] w-full max-w-5xl flex-col overflow-hidden" role="dialog" aria-modal="true" aria-label="페이지 소스" onClick={(event) => event.stopPropagation()}>
            <header className="null-panel-header flex shrink-0 items-center gap-3 border-b px-4 py-3">
              <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">페이지 소스</h2><p className="mt-0.5 text-[11px] text-[var(--text-muted)]">현재 HTTP/HTTPS 문서의 DOM 소스입니다. 최대 2MB까지 표시합니다.</p></div>
              <button type="button" onClick={() => handleCopyText(pageSource)} className="null-quiet-button gap-1 px-2 py-1 text-[11px]"><span>복사</span></button>
              <button type="button" onClick={() => setPageSource(null)} className="null-icon-button !h-7 !w-7" aria-label="페이지 소스 닫기"><span aria-hidden="true">×</span></button>
            </header>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-[var(--chrome-bg)] p-4 text-[11px] leading-5 text-[var(--text-secondary)]">{pageSource}</pre>
          </section>
        </div>
      )}

      {/* 6. First Run Experience Modal */}
      <FirstRunModal
        isOpen={shouldShowFirstRun}
        settings={settings}
        onComplete={(updates) => {
          void handleUpdateSettings(updates);
        }}
      />

      <LibraryModal
        isOpen={isLibraryOpen}
        bookmarks={bookmarks}
        history={history}
        searchHistory={searchHistory}
        downloads={downloads}
        onClose={() => setIsLibraryOpen(false)}
        onNavigate={(url) => { setIsLibraryOpen(false); handleNavigate(url); }}
        onOpenNewTab={(url) => { setIsLibraryOpen(false); handleNewTab(url); }}
        onCopyText={handleCopyText}
        onUpdateBookmark={(id, updates) => { void handleUpdateBookmark(id, updates); }}
        onRemoveBookmark={(id) => {
          window.electronAPI?.removeBookmark(id);
          setBookmarks((items) => items.filter((item) => item.id !== id));
        }}
        onRemoveHistory={(id) => {
          window.electronAPI?.removeHistory(id);
          setHistory((items) => items.filter((item) => item.id !== id));
        }}
        onClearHistory={() => {
          window.electronAPI?.clearHistory();
          setHistory([]);
        }}
        onRemoveSearchHistory={(id) => {
          window.electronAPI?.removeSearchHistory(id);
          setSearchHistory((items) => items.filter((item) => item.id !== id));
        }}
        onClearSearchHistory={() => {
          window.electronAPI?.clearSearchHistory();
          setSearchHistory([]);
        }}
        onSearchAgain={handleSearchAgain}
        onOpenDownload={(id) => window.electronAPI?.openDownload(id)}
        onShowDownloadInFinder={(id) => window.electronAPI?.showInFinder(id)}
        onCancelDownload={(id) => window.electronAPI?.cancelDownload(id)}
        onRemoveDownload={(id) => {
          window.electronAPI?.removeDownload(id);
          setDownloads((items) => items.filter((item) => item.id !== id));
        }}
      />

      {permissionRequests[0] && (
        <PermissionPrompt request={permissionRequests[0]} onResolve={handlePermissionResolution} />
      )}
    </div>
  );
};

export default App;
