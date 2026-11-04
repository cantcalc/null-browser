import { WebContentsView, WebContents, BrowserWindow, session, Menu, MenuItem, MenuItemConstructorOptions } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { ElectronChromeExtensions } from 'electron-chrome-extensions';
import { internalPageTitle, isInternalPageUrl, normalizeSettingsUrl } from '../shared/internalPages';

export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TabEntry {
  view: WebContentsView;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  isMuted: boolean;
  isIncognito: boolean;
  workspaceId: string;
  ready?: Promise<void>;
  navigationSerial?: number;
  deferredUrl?: string;
  error?: { code: number; description: string; url: string } | null;
}

type TabLifecycle = 'active' | 'background' | 'crashed';

export class TabManager {
  public onAISelection?: (tabId: string, text: string, intent: string, sourceURL: string) => void;
  private mainWindow: BrowserWindow;
  private tabSession: Electron.Session;
  private tabs: Map<string, TabEntry> = new Map();
  private activeTabId: string | null = null;
  private splitSecondaryTabId: string | null = null;
  private splitRatio = 0.5;
  private bounds: ViewBounds = { x: 0, y: 76, width: 1200, height: 800 };
  private isOverlayActive = false;
  private htmlFullscreenTabId: string | null = null;
  private popupAttempts: Map<string, number[]> = new Map();
  private registeringExtensionTab = false;
  private appliedBounds = new WeakMap<WebContentsView, ViewBounds>();
  private appliedVisibility = new WeakMap<WebContentsView, boolean>();
  private gestureStates = new WeakMap<WebContents, string>();
  private lastTabStatus = new WeakMap<TabEntry, string>();

  constructor(mainWindow: BrowserWindow, tabSession: Electron.Session = session.defaultSession, private readonly extensions?: ElectronChromeExtensions,
    private readonly workspaceSession?: (workspaceId: string) => Electron.Session,
    private readonly prepareExtensions?: (ses: Electron.Session) => Promise<ElectronChromeExtensions | undefined>) {
    this.mainWindow = mainWindow;
    this.tabSession = tabSession;
  }

  public setBounds(bounds: ViewBounds) {
    const next = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    };
    if (Object.keys(next).every(key => next[key as keyof ViewBounds] === this.bounds[key as keyof ViewBounds])) return;
    this.bounds = next;
    this.applyViewLayout();
  }

  public setOverlay(isOverlay: boolean) {
    if (this.isOverlayActive === isOverlay) return;
    this.isOverlayActive = isOverlay;
    this.applyViewLayout();
  }

  private isVirtualUrl(url?: string): boolean {
    return isInternalPageUrl(url);
  }

  private isLoadableUrl(url: string, ses = this.getActiveSession()): boolean {
    if (this.isVirtualUrl(url)) return true;
    try {
      const parsed = new URL(url);
      const protocol = parsed.protocol;
      if (protocol === 'chrome-extension:') {
        return Boolean(ses.extensions.getExtension(parsed.hostname));
      }
      return protocol === 'http:' || protocol === 'https:' || protocol === 'file:';
    } catch {
      return false;
    }
  }

  private isExternalProtocolUrl(url: string): boolean {
    return /^(mailto|tel|vscode|zoommtg):/i.test(url);
  }

  public createTab(tabId: string, initialUrl: string = 'null://newtab', isIncognito: boolean = false, workspaceId = 'workspace-default', options?: { deferLoad?: boolean }) {
    if (!tabId || this.tabs.has(tabId)) {
      return;
    }

    const tabSession = this.workspaceSession?.(workspaceId) || this.tabSession;
    const safeInitialUrl = this.normalizeTabUrl(initialUrl, tabSession);

    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'guestPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
        session: tabSession,
      },
    });

    view.setBackgroundColor('#13151a');
    view.setVisible(false);
    this.appliedVisibility.set(view, false);

    try {
      this.mainWindow.contentView.addChildView(view);
    } catch (e) {
      console.error('Failed to addChildView:', e);
      if (!view.webContents.isDestroyed()) {
        view.webContents.close({ waitForBeforeUnload: false });
      }
      return;
    }

    const wc = view.webContents;
    wc.on('dom-ready', () => this.notifyGestureState(wc, true));

    const entry: TabEntry = {
      view,
      url: safeInitialUrl,
      title: this.isVirtualUrl(safeInitialUrl) ? internalPageTitle(safeInitialUrl) : '로딩 중...',
      canGoBack: false,
      canGoForward: false,
      isLoading: !this.isVirtualUrl(safeInitialUrl) && !options?.deferLoad,
      isMuted: false,
      isIncognito,
      workspaceId,
    };

    this.tabs.set(tabId, entry);
    const registerExtensions = (extensions?: ElectronChromeExtensions) => {
      if (!extensions || wc.isDestroyed() || !this.tabs.has(tabId)) return;
      // The bridge activates every newly observed tab. Registration is not a
      // user selection: preserve background tabs and avoid notifying React
      // before it has adopted an extension-created tab.
      this.registeringExtensionTab = true;
      try {
        extensions.addTab(wc, this.mainWindow);
        const active = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
        if (active?.view.webContents.session === wc.session) extensions.selectTab(active.view.webContents);
      } finally {
        this.registeringExtensionTab = false;
      }
    };
    if (this.prepareExtensions) {
      entry.ready = this.prepareExtensions(tabSession).then(registerExtensions).catch(error => {
        console.error('[extensions] Workspace initialization failed:', error);
      });
    } else registerExtensions(this.extensions);

    // Lifecycle events
    wc.on('did-start-loading', () => {
      if (this.isVirtualUrl(entry.url)) return;
      entry.deferredUrl = undefined;
      entry.isLoading = true;
      entry.error = null;
      this.notifyTabStatus(tabId);
    });

    wc.on('did-stop-loading', () => {
      if (this.isVirtualUrl(entry.url)) return;
      entry.isLoading = false;
      entry.canGoBack = this.canGoBack(wc);
      entry.canGoForward = this.canGoForward(wc);
      const currentUrl = wc.getURL();
      if (currentUrl && !this.isVirtualUrl(currentUrl)) {
        entry.url = currentUrl;
      }
      entry.title = wc.getTitle() || entry.title;
      this.notifyTabStatus(tabId);
    });

    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3 || this.isVirtualUrl(entry.url)) return;
      entry.isLoading = false;
      if (validatedURL && this.isLoadableUrl(validatedURL, wc.session)) {
        entry.url = this.normalizeTabUrl(validatedURL, wc.session);
      }
      entry.title = `페이지를 불러오지 못했습니다: ${errorDescription}`;
      entry.error = { code: errorCode, description: errorDescription || '알 수 없는 네트워크 오류', url: validatedURL || entry.url };
      this.sendToChrome('tab:status-updated', {
        id: tabId,
        url: entry.url,
        title: entry.title,
        canGoBack: entry.canGoBack,
        canGoForward: entry.canGoForward,
        isLoading: false,
        error: entry.error,
      });
    });

    wc.on('page-title-updated', (_e, title) => {
      if (this.isVirtualUrl(entry.url)) return;
      entry.title = this.limitText(title, 500) || entry.title;
      this.notifyTabStatus(tabId);
    });

    wc.on('page-favicon-updated', (_e, favicons) => {
      if (this.isVirtualUrl(entry.url)) return;
      if (favicons && favicons.length > 0) {
        this.sendToChrome('tab:status-updated', {
          id: tabId,
          favicon: favicons[0],
        });
      }
    });

    wc.on('did-navigate', (_e, url) => {
      if (this.isVirtualUrl(entry.url)) return;
      entry.error = null;
      entry.url = this.normalizeTabUrl(url, wc.session);
      entry.canGoBack = this.canGoBack(wc);
      entry.canGoForward = this.canGoForward(wc);
      this.notifyTabStatus(tabId);
    });

    wc.on('did-navigate-in-page', (_e, url) => {
      if (this.isVirtualUrl(entry.url)) return;
      entry.url = this.normalizeTabUrl(url, wc.session);
      entry.canGoBack = this.canGoBack(wc);
      entry.canGoForward = this.canGoForward(wc);
      this.notifyTabStatus(tabId);
    });

    wc.on('found-in-page', (_e, result) => {
      this.sendToChrome('tab:found-in-page', {
        id: tabId,
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches,
      });
    });

    wc.on('media-started-playing', () => {
      this.sendToChrome('tab:audio-changed', {
        id: tabId,
        audioPlaying: true,
      });
    });

    wc.on('media-paused', () => {
      this.sendToChrome('tab:audio-changed', {
        id: tabId,
        audioPlaying: false,
      });
    });

    // Handle window open / popups
    wc.setWindowOpenHandler(({ url, frameName, features, disposition }) => {
      const now = Date.now();
      const attempts = (this.popupAttempts.get(tabId) || []).filter((timestamp) => now - timestamp < 10_000);
      attempts.push(now);
      this.popupAttempts.set(tabId, attempts);
      if (attempts.length > 3) return { action: 'deny' };

      if (url && this.isLoadableWebUrl(url)) {
        const authLikePopup = disposition === 'new-window' && (
          (frameName && frameName !== '_blank') || /(?:^|,)\s*(?:width|height)=/i.test(features)
        );
        if (authLikePopup) {
          return {
            action: 'allow',
            outlivesOpener: false,
            overrideBrowserWindowOptions: {
              width: 520,
              height: 720,
              minWidth: 360,
              minHeight: 480,
              autoHideMenuBar: true,
              backgroundColor: '#13151a',
              webPreferences: {
                session: wc.session,
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                spellcheck: true,
              },
            },
          };
        }
        this.sendToChrome('tab:open-external', url);
      } else if (url && this.isExternalProtocolUrl(url)) {
        this.sendToChrome('tab:open-external', url);
      }
      return { action: 'deny' };
    });

    wc.on('enter-html-full-screen', () => {
      this.htmlFullscreenTabId = tabId;
      this.sendToChrome('tab:html-fullscreen', { id: tabId, fullscreen: true });
      this.applyViewLayout();
    });

    wc.on('leave-html-full-screen', () => {
      if (this.htmlFullscreenTabId === tabId) this.htmlFullscreenTabId = null;
      this.sendToChrome('tab:html-fullscreen', { id: tabId, fullscreen: false });
      this.applyViewLayout();
    });

    // Never allow a remote page to navigate the embedded view to an arbitrary
    // Electron or local protocol. User-initiated file:// navigation remains
    // supported, while javascript:, data:, chrome://, etc. are rejected.
    wc.on('will-navigate', (event, url) => {
      if (this.isExternalProtocolUrl(url)) {
        event.preventDefault();
        this.sendToChrome('tab:open-external', url);
        return;
      }
      if (!this.isLoadableUrl(url, wc.session)) event.preventDefault();
    });

    wc.on('render-process-gone', (_event, details) => {
      const current = this.tabs.get(tabId);
      if (!current || current !== entry || details.reason === 'clean-exit') return;
      current.isLoading = false;
      current.title = '페이지 렌더러가 종료되었습니다. 새로고침해 주세요.';
      current.error = { code: -1, description: '페이지 렌더러가 종료되었습니다.', url: current.url };
      this.sendToChrome('tab:status-updated', {
        id: tabId,
        url: current.url,
        title: current.title,
        isLoading: false,
        lifecycle: 'crashed' as TabLifecycle,
        error: current.error,
      });
    });

    // Global shortcut forwarding from guest view to browser window
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const isCmd = input.meta || input.control;

      if (isCmd && !input.shift && !input.alt && input.key.toLowerCase() === 't') {
        event.preventDefault();
        this.sendToChrome('menu:new-tab');
      } else if (isCmd && !input.shift && !input.alt && input.key.toLowerCase() === 'w') {
        event.preventDefault();
        this.sendToChrome('menu:close-tab');
      } else if (isCmd && input.shift && !input.alt && input.key.toLowerCase() === 't') {
        event.preventDefault();
        this.sendToChrome('menu:reopen-closed-tab');
      } else if (isCmd && input.shift && !input.alt && input.key.toLowerCase() === 'h') {
        event.preventDefault();
        this.sendToChrome('menu:open-library');
      } else if (isCmd && !input.shift && !input.alt && input.key === ',') {
        event.preventDefault();
        this.sendToChrome('menu:open-settings');
      } else if (isCmd && !input.shift && !input.alt && input.key.toLowerCase() === 'l') {
        event.preventDefault();
        this.sendToChrome('menu:focus-address-bar');
      } else if (isCmd && !input.shift && !input.alt && input.key.toLowerCase() === 'r') {
        event.preventDefault();
        this.sendToChrome('menu:reload');
      } else if (isCmd && input.shift && !input.alt && input.key.toLowerCase() === 'r') {
        event.preventDefault();
        this.sendToChrome('menu:reload-nocache');
      } else if (isCmd && !input.shift && !input.alt && input.key.toLowerCase() === 'f') {
        event.preventDefault();
        this.sendToChrome('menu:open-find');
      } else if (isCmd && !input.shift && !input.alt && /^[1-9]$/.test(input.key)) {
        event.preventDefault();
        this.sendToChrome('tab:switch-shortcut', Number(input.key));
      } else if (input.control && !input.meta && input.key === 'Tab') {
        event.preventDefault();
        this.sendToChrome('tab:switch-relative', input.shift ? -1 : 1);
      } else if (isCmd && !input.shift && !input.alt && input.key === '[') {
        event.preventDefault();
        this.goBack(tabId);
      } else if (isCmd && !input.shift && !input.alt && input.key === ']') {
        event.preventDefault();
        this.goForward(tabId);
      } else if (isCmd && !input.shift && !input.alt && (input.key === '=' || input.key === '+')) {
        event.preventDefault();
        this.sendToChrome('menu:zoom-in');
      } else if (isCmd && !input.shift && !input.alt && input.key === '-') {
        event.preventDefault();
        this.sendToChrome('menu:zoom-out');
      } else if (isCmd && !input.shift && !input.alt && input.key === '0') {
        event.preventDefault();
        this.sendToChrome('menu:reset-zoom');
      } else if (isCmd && !input.shift && !input.alt && input.key === '\\') {
        event.preventDefault();
        this.sendToChrome('menu:toggle-aside');
      } else if ((isCmd && input.alt && input.key.toLowerCase() === 'i') || input.key === 'F12') {
        event.preventDefault();
        this.toggleDevTools(tabId);
      }
    });

    // Context menu
    wc.on('context-menu', (_e, params) => {
      const items: Array<MenuItemConstructorOptions | MenuItem> = [];
      const selectionURL = wc.getURL();
      if (this.onAISelection && !isIncognito && !params.isEditable && params.selectionText?.trim() && this.isLoadableWebUrl(wc.getURL())) {
        for (const [label, intent] of [
          ['AI에게 질문하기', '선택한 내용에 대해 질문하고 싶어요.'],
          ['선택한 내용 설명', '선택한 내용을 설명해 줘.'],
          ['선택한 내용 요약', '선택한 내용을 요약해 줘.'],
          ['선택한 내용 번역', '선택한 내용을 한국어로 번역해 줘.'],
        ]) items.push({ label, click: () => this.onAISelection?.(tabId, params.selectionText, intent, selectionURL) });
        items.push({ type: 'separator' });
      }
      const extensionItems = this.extensionsFor(wc)?.getContextMenuItems(wc, params) || [];
      if (extensionItems.length > 0) items.push(...extensionItems, { type: 'separator' });
      const linkUrl = typeof params.linkURL === 'string' ? params.linkURL.trim() : '';
      if (this.isLoadableWebUrl(linkUrl)) {
        items.push(
          {
            label: '새 탭에서 링크 열기',
            click: () => this.sendToChrome('tab:open-link-in-new-tab', linkUrl),
          },
          {
            label: '새 창에서 링크 열기',
            click: () => this.sendToChrome('tab:open-link-in-new-window', linkUrl),
          },
          {
            label: '분할 뷰에서 링크 열기',
            click: () => this.sendToChrome('tab:open-link-in-split', linkUrl),
          },
          {
            label: '시크릿 창에서 링크 열기',
            click: () => this.sendToChrome('tab:open-link-in-private-window', linkUrl),
          },
          { type: 'separator' },
        );
      }
      items.push(
        {
          label: '뒤로 가기',
          enabled: this.canGoBack(wc),
          click: () => this.goBack(tabId),
        },
        {
          label: '앞으로 가기',
          enabled: this.canGoForward(wc),
          click: () => this.goForward(tabId),
        },
        {
          label: '새로고침',
          click: () => wc.reload(),
        },
        { type: 'separator' },
        { label: '복사', role: 'copy' },
        { label: '붙여넣기', role: 'paste' },
        { label: '모두 선택', role: 'selectAll' },
        { type: 'separator' },
        {
          label: '검사 (Inspect Element)',
          click: () => {
            wc.inspectElement(params.x, params.y);
            if (!wc.isDevToolsOpened()) {
              wc.openDevTools({ mode: 'detach' });
            }
          },
        }
      );

      const menu = Menu.buildFromTemplate(items);
      menu.popup();
    });

    // Load initial URL if not virtual
    if (!this.isVirtualUrl(safeInitialUrl)) {
      if (options?.deferLoad) entry.deferredUrl = safeInitialUrl;
      else this.loadPage(entry, safeInitialUrl);
    }
  }

  public switchTab(tabId: string) {
    const current = this.tabs.get(tabId);
    if (!current) return;

    this.activeTabId = tabId;
    this.loadDeferredPage(current);
    this.extensionsFor(current.view.webContents)?.selectTab(current.view.webContents);
    this.applyViewLayout();
    if (!this.isOverlayActive && !this.isVirtualUrl(current.url) && !current.view.webContents.isDestroyed()) {
      try { current.view.webContents.focus(); } catch {}
    }
  }

  public closeTab(tabId: string) {
    const entry = this.tabs.get(tabId);
    if (!entry) return;

    this.tabs.delete(tabId);
    this.extensionsFor(entry.view.webContents)?.removeTab(entry.view.webContents);
    this.popupAttempts.delete(tabId);
    if (this.htmlFullscreenTabId === tabId) this.htmlFullscreenTabId = null;
    if (this.activeTabId === tabId) this.activeTabId = null;
    if (this.splitSecondaryTabId === tabId) this.splitSecondaryTabId = null;

    try {
      entry.view.setVisible(false);
      this.mainWindow.contentView.removeChildView(entry.view);
      entry.view.webContents.close({ waitForBeforeUnload: false });
    } catch (e) {
      console.error('Error destroying WebContentsView for tab:', tabId, e);
    }
    this.applyViewLayout();
  }

  public setSplitView(enabled: boolean, secondaryTabId?: string | null, ratio?: number) {
    if (!enabled) {
      this.splitSecondaryTabId = null;
      this.applyViewLayout();
      return;
    }
    const primary = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    const secondary = secondaryTabId ? this.tabs.get(secondaryTabId) : undefined;
    if (!primary || !secondary || secondaryTabId === this.activeTabId || this.isVirtualUrl(primary.url) || this.isVirtualUrl(secondary.url)) return;
    if (typeof ratio === 'number' && Number.isFinite(ratio)) {
      this.splitRatio = Math.min(0.8, Math.max(0.2, ratio));
    }
    this.splitSecondaryTabId = secondaryTabId!;
    this.loadDeferredPage(secondary);
    this.applyViewLayout();
  }

  public setSplitRatio(ratio: number) {
    if (!Number.isFinite(ratio)) return;
    this.splitRatio = Math.min(0.8, Math.max(0.2, ratio));
    this.applyViewLayout();
  }

  /** Returns true when this manager owns a WebContentsView's WebContents. */
  public ownsWebContents(contents: Electron.WebContents): boolean {
    for (const entry of this.tabs.values()) {
      if (entry.view.webContents === contents) return true;
    }
    return false;
  }

  public getTabId(contents: Electron.WebContents): string | undefined {
    for (const [id, entry] of this.tabs) if (entry.view.webContents === contents) return id;
    return undefined;
  }

  /** Only a visible, owned page may request history navigation. */
  public getGuestGestureState(contents: WebContents) {
    const id = this.getTabId(contents);
    const entry = id ? this.tabs.get(id) : undefined;
    if (!entry || contents.isDestroyed() || !entry.view.getVisible() || this.isVirtualUrl(entry.url)) return null;
    return { id: id!, canGoBack: this.canGoBack(contents), canGoForward: this.canGoForward(contents) };
  }

  public getTabWebContents(tabId: string): Electron.WebContents | undefined {
    return this.tabs.get(tabId)?.view.webContents;
  }

  /** Explicit AI access wakes only a user-selected/task tab, never all tabs. */
  public async prepareTabForAI(tabId: string, signal?: AbortSignal): Promise<Electron.WebContents> {
    signal?.throwIfAborted();
    const entry = this.tabs.get(tabId);
    if (!entry || entry.isIncognito || !entry.view.webContents.session.isPersistent()) throw Error('분석할 일반 탭이 없습니다.');
    await entry.ready;
    signal?.throwIfAborted();
    if (entry.view.webContents.isDestroyed()) throw Error('탭이 닫혔습니다.');
    this.loadDeferredPage(entry);
    if (!entry.view.getVisible()) {
      const bounds = { x: 0, y: 0, width: Math.max(320, this.bounds.width), height: Math.max(240, this.bounds.height) };
      entry.view.setBounds(bounds); this.appliedBounds.set(entry.view, bounds);
    }
    return entry.view.webContents;
  }

  /** AI navigation must update the same tab metadata/layout as the address bar. */
  public async navigateTabForAI(tabId: string, url: string, signal: AbortSignal): Promise<void> {
    const wc = await this.prepareTabForAI(tabId, signal);
    if (!/^https?:/.test(url)) throw Error('일반 웹주소로만 이동할 수 있습니다.');
    await new Promise<void>((resolve, reject) => {
      let committed = false;
      const cleanup = () => {
        clearTimeout(timer);
        wc.removeListener('did-navigate', commit);
        wc.removeListener('did-stop-loading', stopped);
        wc.removeListener('did-finish-load', stopped);
        wc.removeListener('did-fail-load', failed);
        wc.removeListener('destroyed', cancelled);
        signal.removeEventListener('abort', cancelled);
      };
      const commit = () => { committed = true; };
      const stopped = () => {
        const entry = this.tabs.get(tabId);
        if (!committed || wc.isDestroyed() || wc.isLoadingMainFrame()) return;
        if (!entry || entry.error || !/^https?:/.test(wc.getURL()) || this.isVirtualUrl(entry.url)) { cleanup(); reject(Error('페이지 이동을 확인하지 못했습니다.')); return; }
        cleanup(); resolve();
      };
      const failed = (_event: Electron.Event, code: number, _description: string, _url: string, mainFrame: boolean) => {
        if (!mainFrame || code === -3) return;
        cleanup(); reject(Error('작업 페이지를 불러오지 못했습니다.'));
      };
      const cancelled = () => { cleanup(); if (!wc.isDestroyed()) wc.stop(); reject(Error('작업 페이지 이동을 중지했습니다.')); };
      const timer = setTimeout(() => { cleanup(); if (!wc.isDestroyed()) wc.stop(); reject(Error('페이지 이동 확인 시간이 초과되었습니다.')); }, 30_000);
      wc.on('did-navigate', commit); wc.on('did-stop-loading', stopped); wc.on('did-finish-load', stopped); wc.on('did-fail-load', failed); wc.once('destroyed', cancelled);
      signal.addEventListener('abort', cancelled, { once: true });
      if (signal.aborted) cancelled(); else this.navigateTab(tabId, url);
    });
  }

  public getActiveTabId(): string | null {
    return this.activeTabId;
  }

  public isRegisteringExtensionTab(): boolean {
    return this.registeringExtensionTab;
  }

  public getSession(): Electron.Session {
    return this.tabSession;
  }

  public getActiveSession(): Electron.Session {
    return (this.activeTabId && this.tabs.get(this.activeTabId)?.view.webContents.session) || this.tabSession;
  }

  public getActiveWorkspaceId(): string {
    return (this.activeTabId && this.tabs.get(this.activeTabId)?.workspaceId) || 'workspace-default';
  }

  public getWorkspaceId(contents: Electron.WebContents): string | undefined {
    const id = this.getTabId(contents);
    return id ? this.tabs.get(id)?.workspaceId : undefined;
  }

  private extensionsFor(contents: Electron.WebContents): ElectronChromeExtensions | undefined {
    // Static lookup avoids retaining a separate runtime on every tab.
    return this.prepareExtensions ? ElectronChromeExtensions.fromSession(contents.session) : this.extensions;
  }

  public getHttpOrigins(targetSession = this.getActiveSession()): string[] {
    const origins = new Set<string>();
    for (const entry of this.tabs.values()) {
      if (entry.view.webContents.session !== targetSession) continue;
      try {
        const parsed = new URL(entry.url);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') origins.add(parsed.origin);
      } catch {}
    }
    return Array.from(origins);
  }

  public navigateTab(tabId: string, url: string) {
    const entry = this.tabs.get(tabId);
    if (!entry) {
      this.createTab(tabId, url, !this.tabSession.isPersistent(), this.getActiveWorkspaceId());
      return;
    }

    const safeUrl = this.normalizeTabUrl(url, entry.view.webContents.session);
    if (!safeUrl) return;

    entry.url = safeUrl;
    entry.deferredUrl = undefined;
    entry.navigationSerial = (entry.navigationSerial || 0) + 1;
    entry.error = null;

    if (this.isVirtualUrl(safeUrl)) {
      // A replaced document must not keep playing media/running JavaScript
      // behind the internal New Tab/Settings UI. Don't allocate a renderer for
      // a tab that has never loaded anything in the first place.
      const wc = entry.view.webContents;
      if (wc.getURL() && wc.getURL() !== 'about:blank') void wc.loadURL('about:blank').catch(() => {});
      entry.isLoading = false;
      entry.title = internalPageTitle(safeUrl);
      entry.canGoBack = false;
      entry.canGoForward = false;
      this.notifyTabStatus(tabId);
    } else {
      entry.isLoading = true;
      this.notifyTabStatus(tabId);
      this.loadPage(entry, safeUrl);
    }
    // Recompute both panes. Setting the active view to the full viewport here
    // used to make it overlap the secondary pane during split navigation.
    this.applyViewLayout();
  }

  public goBack(tabId: string) {
    const entry = this.tabs.get(tabId);
    if (entry && !this.isVirtualUrl(entry.url) && this.canGoBack(entry.view.webContents)) {
      entry.view.webContents.navigationHistory.goBack();
    }
  }

  public goForward(tabId: string) {
    const entry = this.tabs.get(tabId);
    if (entry && !this.isVirtualUrl(entry.url) && this.canGoForward(entry.view.webContents)) {
      entry.view.webContents.navigationHistory.goForward();
    }
  }

  public reload(tabId: string, ignoreCache: boolean = false) {
    const entry = this.tabs.get(tabId);
    if (entry && !this.isVirtualUrl(entry.url) && !entry.view.webContents.isDestroyed()) {
      if (entry.deferredUrl) { this.loadDeferredPage(entry); return; }
      if (ignoreCache) {
        entry.view.webContents.reloadIgnoringCache();
      } else {
        entry.view.webContents.reload();
      }
    }
  }

  public print(tabId: string): boolean {
    const entry = this.tabs.get(tabId);
    if (!entry || entry.view.webContents.isDestroyed()) return false;
    entry.view.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
      if (!success && reason !== 'cancelled') console.warn(`Print failed: ${reason || 'unknown error'}`);
    });
    return true;
  }

  public async saveAsPdf(tabId: string, filePath: string): Promise<boolean> {
    const entry = this.tabs.get(tabId);
    if (!entry || entry.view.webContents.isDestroyed() || !filePath) return false;
    try {
      const pdf = await entry.view.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
      await fs.writeFile(filePath, pdf, { mode: 0o600 });
      return true;
    } catch (error) {
      console.error('Failed to save page as PDF:', error);
      return false;
    }
  }

  public async getPageSource(tabId: string): Promise<string | null> {
    const entry = this.tabs.get(tabId);
    if (!entry || entry.view.webContents.isDestroyed() || !/^https?:\/\//i.test(entry.url)) return null;
    try {
      const source = await entry.view.webContents.executeJavaScript('document.documentElement.outerHTML', true);
      return typeof source === 'string' ? source.slice(0, 2_000_000) : null;
    } catch {
      return null;
    }
  }

  public stop(tabId: string) {
    const entry = this.tabs.get(tabId);
    if (entry) {
      entry.view.webContents.stop();
    }
  }

  public setMuted(tabId: string, muted: boolean) {
    const entry = this.tabs.get(tabId);
    if (entry) {
      entry.isMuted = muted;
      try {
        entry.view.webContents.setAudioMuted(muted);
      } catch {}
    }
  }

  public setZoom(tabId: string, zoomFactor: number) {
    const entry = this.tabs.get(tabId);
    if (entry && !entry.view.webContents.isDestroyed()) {
      const safeZoom = Number.isFinite(zoomFactor) ? Math.min(5, Math.max(0.25, zoomFactor)) : 1;
      try {
        entry.view.webContents.setZoomFactor(safeZoom);
      } catch {}
    }
  }

  public findInPage(tabId: string, text: string, forward: boolean) {
    const entry = this.tabs.get(tabId);
    if (entry && !entry.view.webContents.isDestroyed()) {
      if (!text.trim()) {
        this.stopFindInPage(tabId);
        return;
      }
      entry.view.webContents.findInPage(text, { forward, findNext: true });
    }
  }

  public stopFindInPage(tabId: string) {
    const entry = this.tabs.get(tabId);
    if (entry) {
      entry.view.webContents.stopFindInPage('clearSelection');
    }
  }

  public toggleDevTools(tabId: string) {
    const entry = this.tabs.get(tabId);
    if (entry && !entry.view.webContents.isDestroyed()) {
      const wc = entry.view.webContents;
      try {
        if (wc.isDevToolsOpened()) {
          wc.closeDevTools();
        } else {
          wc.openDevTools({ mode: 'detach' });
        }
      } catch {}
    }
  }

  public destroyAll() {
    const entries = Array.from(this.tabs.values());
    this.tabs.clear();
    this.activeTabId = null;
    this.splitSecondaryTabId = null;
    for (const entry of entries) {
      try {
        this.extensionsFor(entry.view.webContents)?.removeTab(entry.view.webContents);
        entry.view.setVisible(false);
        this.mainWindow.contentView.removeChildView(entry.view);
        entry.view.webContents.close({ waitForBeforeUnload: false });
      } catch {}
    }
  }

  private notifyTabStatus(tabId: string) {
    const entry = this.tabs.get(tabId);
    if (!entry || this.mainWindow.isDestroyed() || entry.view.webContents.isDestroyed()) return;
    this.notifyGestureState(entry.view.webContents);

    const status = {
      id: tabId,
      url: entry.url,
      title: entry.title,
      canGoBack: entry.canGoBack,
      canGoForward: entry.canGoForward,
      isLoading: entry.isLoading,
      error: entry.error || null,
    };
    const signature = JSON.stringify(status);
    if (this.lastTabStatus.get(entry) === signature) return;
    this.lastTabStatus.set(entry, signature);
    this.sendToChrome('tab:status-updated', status);
  }

  private notifyGestureState(contents: WebContents, force = false) {
    if (contents.isDestroyed()) return;
    const state = { canGoBack: this.canGoBack(contents), canGoForward: this.canGoForward(contents) };
    const signature = `${state.canGoBack}:${state.canGoForward}`;
    if (!force && this.gestureStates.get(contents) === signature) return;
    this.gestureStates.set(contents, signature);
    try { contents.send('tab:gesture-state', state); } catch {}
  }

  private applyViewLayout() {
    const visibleIds = new Set<string>();
    if (this.htmlFullscreenTabId && this.tabs.has(this.htmlFullscreenTabId)) {
      visibleIds.add(this.htmlFullscreenTabId);
    } else {
      if (this.activeTabId) visibleIds.add(this.activeTabId);
      if (this.splitSecondaryTabId && this.tabs.has(this.splitSecondaryTabId)) visibleIds.add(this.splitSecondaryTabId);
    }

    const split = visibleIds.size === 2 && !this.isOverlayActive &&
      Array.from(visibleIds).every((id) => {
        const entry = this.tabs.get(id);
        return Boolean(entry && !this.isVirtualUrl(entry.url));
      });
    const gutter = 6;
    const primaryWidth = split ? Math.max(0, Math.floor((this.bounds.width - gutter) * this.splitRatio)) : this.bounds.width;
    for (const [id, entry] of this.tabs) {
      try {
        if (!visibleIds.has(id) || this.isOverlayActive || this.isVirtualUrl(entry.url)) {
          if (this.appliedVisibility.get(entry.view) !== false) {
            entry.view.setVisible(false);
            this.appliedVisibility.set(entry.view, false);
          }
          continue;
        }
        const isSecondary = split && id === this.splitSecondaryTabId;
        const nextBounds = {
          x: this.bounds.x + (isSecondary ? primaryWidth + gutter : 0),
          y: this.bounds.y,
          width: isSecondary ? this.bounds.width - primaryWidth - gutter : primaryWidth,
          height: this.bounds.height,
        };
        const previous = this.appliedBounds.get(entry.view);
        if (!previous || Object.keys(nextBounds).some(key => nextBounds[key as keyof ViewBounds] !== previous[key as keyof ViewBounds])) {
          entry.view.setBounds(nextBounds);
          this.appliedBounds.set(entry.view, nextBounds);
        }
        if (this.appliedVisibility.get(entry.view) !== true) {
          entry.view.setVisible(true);
          this.appliedVisibility.set(entry.view, true);
        }
      } catch {}
    }
  }

  private sendToChrome(channel: string, payload?: unknown) {
    if (this.mainWindow.isDestroyed() || this.mainWindow.webContents.isDestroyed()) return;
    try {
      this.mainWindow.webContents.send(channel, payload);
    } catch {}
  }

  private normalizeTabUrl(url: unknown, ses = this.getActiveSession()): string {
    if (typeof url !== 'string') return 'null://newtab';
    const trimmed = url.trim();
    const settingsRoute = normalizeSettingsUrl(trimmed);
    if (settingsRoute) return settingsRoute;
    if (this.isVirtualUrl(trimmed)) return 'null://newtab';
    if (!this.isLoadableUrl(trimmed, ses)) return 'null://newtab';
    try {
      return new URL(trimmed).href;
    } catch {
      return 'null://newtab';
    }
  }

  private loadPage(entry: TabEntry, url: string) {
    const serial = (entry.navigationSerial || 0) + 1;
    entry.navigationSerial = serial;
    const load = () => {
      if (!entry.view.webContents.isDestroyed() && entry.navigationSerial === serial && entry.url === url) {
        entry.view.webContents.loadURL(url).catch(() => {});
      }
    };
    if (entry.ready) void entry.ready.then(load); else load();
  }

  private loadDeferredPage(entry: TabEntry) {
    if (!entry.deferredUrl) return;
    const url = entry.deferredUrl;
    entry.deferredUrl = undefined;
    entry.isLoading = true;
    this.loadPage(entry, url);
    const id = this.getTabId(entry.view.webContents);
    if (id) this.notifyTabStatus(id);
  }

  private limitText(value: string, maxLength: number): string {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
  }

  private canGoBack(wc: WebContents): boolean {
    try {
      if (wc.navigationHistory && typeof wc.navigationHistory.canGoBack === 'function') {
        return wc.navigationHistory.canGoBack();
      }
      return wc.canGoBack();
    } catch {
      return false;
    }
  }

  private isLoadableWebUrl(url: string): boolean {
    try {
      const protocol = new URL(url).protocol;
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }

  private canGoForward(wc: WebContents): boolean {
    try {
      if (wc.navigationHistory && typeof wc.navigationHistory.canGoForward === 'function') {
        return wc.navigationHistory.canGoForward();
      }
      return wc.canGoForward();
    } catch {
      return false;
    }
  }

  public getTabCount(): number {
    return this.tabs.size;
  }
}
