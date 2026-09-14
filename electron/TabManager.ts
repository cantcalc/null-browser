import { WebContentsView, WebContents, BrowserWindow, session, Menu, MenuItemConstructorOptions } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { normalizeTranslationError, TRANSLATION_LIMITS, TranslationError } from './translation';

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
}

type TabLifecycle = 'active' | 'background' | 'crashed';

export class TabManager {
  private mainWindow: BrowserWindow;
  private tabSession: Electron.Session;
  private tabs: Map<string, TabEntry> = new Map();
  private activeTabId: string | null = null;
  private splitSecondaryTabId: string | null = null;
  private splitRatio = 0.5;
  private bounds: ViewBounds = { x: 0, y: 76, width: 1200, height: 800 };
  private isOverlayActive = false;
  private htmlFullscreenTabId: string | null = null;
  private translationJobVersions: Map<string, number> = new Map();
  private popupAttempts: Map<string, number[]> = new Map();

  constructor(mainWindow: BrowserWindow, tabSession: Electron.Session = session.defaultSession) {
    this.mainWindow = mainWindow;
    this.tabSession = tabSession;
  }

  public setBounds(bounds: ViewBounds) {
    this.bounds = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    };

    this.applyViewLayout();
  }

  public setOverlay(isOverlay: boolean) {
    this.isOverlayActive = isOverlay;
    this.applyViewLayout();
  }

  private invalidateTranslationJob(tabId: string) {
    this.translationJobVersions.set(tabId, (this.translationJobVersions.get(tabId) || 0) + 1);
  }

  private beginTranslationJob(tabId: string): number {
    this.invalidateTranslationJob(tabId);
    return this.translationJobVersions.get(tabId)!;
  }

  private isCurrentTranslationJob(tabId: string, entry: TabEntry, jobId: number, url: string, wc: WebContents): boolean {
    return this.translationJobVersions.get(tabId) === jobId && this.tabs.get(tabId) === entry && entry.url === url && !wc.isDestroyed();
  }

  private isVirtualUrl(url?: string): boolean {
    return !url || url === 'aero://newtab' || url === 'browser://newtab' || /^about:blank(?:[#?].*)?$/i.test(url);
  }

  private isLoadableUrl(url: string): boolean {
    if (this.isVirtualUrl(url)) return true;
    try {
      const protocol = new URL(url).protocol;
      return protocol === 'http:' || protocol === 'https:' || protocol === 'file:';
    } catch {
      return false;
    }
  }

  private isExternalProtocolUrl(url: string): boolean {
    return /^(mailto|tel|vscode|zoommtg):/i.test(url);
  }

  public createTab(tabId: string, initialUrl: string = 'aero://newtab', isIncognito: boolean = false) {
    if (!tabId || this.tabs.has(tabId)) {
      return;
    }

    const safeInitialUrl = this.normalizeTabUrl(initialUrl);

    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'guestPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
        session: this.tabSession,
      },
    });

    view.setBackgroundColor('#13151a');
    view.setVisible(false);

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

    const entry: TabEntry = {
      view,
      url: safeInitialUrl,
      title: this.isVirtualUrl(safeInitialUrl) ? '새 탭' : '로딩 중...',
      canGoBack: false,
      canGoForward: false,
      isLoading: !this.isVirtualUrl(safeInitialUrl),
      isMuted: false,
      isIncognito,
    };

    this.tabs.set(tabId, entry);

    // Lifecycle events
    wc.on('did-start-loading', () => {
      this.invalidateTranslationJob(tabId);
      entry.isLoading = true;
      this.notifyTabStatus(tabId);
    });

    wc.on('did-stop-loading', () => {
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
      if (!isMainFrame || errorCode === -3) return;
      this.invalidateTranslationJob(tabId);
      entry.isLoading = false;
      if (validatedURL && this.isLoadableUrl(validatedURL)) {
        entry.url = this.normalizeTabUrl(validatedURL);
      }
      entry.title = `페이지를 불러오지 못했습니다: ${errorDescription}`;
      this.sendToChrome('tab:status-updated', {
        id: tabId,
        url: entry.url,
        title: entry.title,
        canGoBack: entry.canGoBack,
        canGoForward: entry.canGoForward,
        isLoading: false,
        error: { code: errorCode, description: errorDescription || '알 수 없는 네트워크 오류', url: validatedURL || entry.url },
      });
    });

    wc.on('page-title-updated', (_e, title) => {
      entry.title = this.limitText(title, 500) || entry.title;
      this.notifyTabStatus(tabId);
    });

    wc.on('page-favicon-updated', (_e, favicons) => {
      if (favicons && favicons.length > 0) {
        this.sendToChrome('tab:status-updated', {
          id: tabId,
          favicon: favicons[0],
        });
      }
    });

    wc.on('did-navigate', (_e, url) => {
      this.invalidateTranslationJob(tabId);
      entry.url = this.normalizeTabUrl(url);
      entry.canGoBack = this.canGoBack(wc);
      entry.canGoForward = this.canGoForward(wc);
      this.notifyTabStatus(tabId);
    });

    wc.on('did-navigate-in-page', (_e, url) => {
      this.invalidateTranslationJob(tabId);
      entry.url = this.normalizeTabUrl(url);
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
                session: this.tabSession,
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
      if (!this.isLoadableUrl(url)) event.preventDefault();
    });

    wc.on('render-process-gone', (_event, details) => {
      const current = this.tabs.get(tabId);
      if (!current || current !== entry || details.reason === 'clean-exit') return;
      current.isLoading = false;
      current.title = '페이지 렌더러가 종료되었습니다. 새로고침해 주세요.';
      this.sendToChrome('tab:status-updated', {
        id: tabId,
        url: current.url,
        title: current.title,
        isLoading: false,
        lifecycle: 'crashed' as TabLifecycle,
        error: { code: -1, description: '페이지 렌더러가 종료되었습니다.', url: current.url },
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
      } else if (isCmd && !input.shift && !input.alt && input.key.toLowerCase() === 'k') {
        event.preventDefault();
        this.sendToChrome('menu:open-command-palette');
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
      } else if (isCmd && input.alt && input.key.toLowerCase() === 't') {
        event.preventDefault();
        this.sendToChrome('tab:translate-active');
      } else if ((isCmd && input.alt && input.key.toLowerCase() === 'i') || input.key === 'F12') {
        event.preventDefault();
        this.toggleDevTools(tabId);
      }
    });

    // Context menu
    wc.on('context-menu', (_e, params) => {
      const items: MenuItemConstructorOptions[] = [];
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
      const selectedText = params.selectionText ? params.selectionText.trim() : '';
      if (selectedText) {
        const preview = selectedText.length > 25 ? selectedText.substring(0, 25) + '...' : selectedText;
        items.push(
          {
            label: `한국어로 선택 번역: "${preview}"`,
            click: () => this.sendToChrome('tab:selection-translate', selectedText),
          },
          { type: 'separator' }
        );
      }

      items.push(
        {
          label: '뒤로 가기',
          enabled: this.canGoBack(wc),
          click: () => wc.goBack(),
        },
        {
          label: '앞으로 가기',
          enabled: this.canGoForward(wc),
          click: () => wc.goForward(),
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
          label: '한국어로 이 페이지 번역',
          click: () => this.sendToChrome('tab:translate-active'),
        },
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
      wc.loadURL(safeInitialUrl).catch(() => {});
    }
  }

  public switchTab(tabId: string) {
    const current = this.tabs.get(tabId);
    if (!current) return;

    if (this.activeTabId && this.activeTabId !== tabId) {
      this.invalidateTranslationJob(this.activeTabId);
    }

    this.activeTabId = tabId;
    this.applyViewLayout();
    if (!this.isOverlayActive && !this.isVirtualUrl(current.url) && !current.view.webContents.isDestroyed()) {
      try { current.view.webContents.focus(); } catch {}
    }
  }

  public closeTab(tabId: string) {
    const entry = this.tabs.get(tabId);
    if (!entry) return;

    this.invalidateTranslationJob(tabId);
    this.tabs.delete(tabId);
    this.translationJobVersions.delete(tabId);
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

  public getSession(): Electron.Session {
    return this.tabSession;
  }

  public getHttpOrigins(): string[] {
    const origins = new Set<string>();
    for (const entry of this.tabs.values()) {
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
      this.createTab(tabId, url, this.tabSession !== session.defaultSession);
      return;
    }

    const safeUrl = this.normalizeTabUrl(url);
    if (!safeUrl) return;

    this.invalidateTranslationJob(tabId);
    entry.url = safeUrl;

    if (this.isVirtualUrl(safeUrl)) {
      entry.isLoading = false;
      entry.title = '새 탭';
      this.notifyTabStatus(tabId);
    } else {
      entry.isLoading = true;
      this.notifyTabStatus(tabId);
      entry.view.webContents.loadURL(safeUrl).catch(() => {});
    }
    // Recompute both panes. Setting the active view to the full viewport here
    // used to make it overlap the secondary pane during split navigation.
    this.applyViewLayout();
  }

  public goBack(tabId: string) {
    const entry = this.tabs.get(tabId);
    if (entry && this.canGoBack(entry.view.webContents)) {
      this.invalidateTranslationJob(tabId);
      // Use the same WebContents navigation path as the page context menu.
      // Keeping gesture, toolbar, and menu navigation on one path avoids a
      // renderer transition difference that can appear as a brief flash.
      entry.view.webContents.goBack();
    }
  }

  public goForward(tabId: string) {
    const entry = this.tabs.get(tabId);
    if (entry && this.canGoForward(entry.view.webContents)) {
      this.invalidateTranslationJob(tabId);
      entry.view.webContents.goForward();
    }
  }

  public reload(tabId: string, ignoreCache: boolean = false) {
    const entry = this.tabs.get(tabId);
    if (entry && !entry.view.webContents.isDestroyed()) {
      this.invalidateTranslationJob(tabId);
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

  public async translatePage(tabId: string, translateBatchFn: (texts: string[]) => Promise<string[]>): Promise<boolean> {
    const entry = this.tabs.get(tabId);
    if (!entry) return false;

    const wc = entry.view.webContents;
    if (wc.isDestroyed() || this.isVirtualUrl(entry.url)) return false;
    const translationUrl = entry.url;
    const jobId = this.beginTranslationJob(tabId);
    const startedAt = Date.now();

    const clearTranslationState = async (restoreAppliedText: boolean) => {
      if (wc.isDestroyed()) return;
      await wc.executeJavaScript(`
        (function(jobId, restoreAppliedText) {
          var state = window.__aeroTranslationState;
          if (!state || state.jobId !== jobId) return;
          if (restoreAppliedText && Array.isArray(state.nodes)) {
            state.nodes.forEach(function(item) {
              try {
                var expected = item.prefix + (item.translated || '') + item.suffix;
                if (item.node && item.node.isConnected && item.translated && item.node.nodeValue === expected) {
                  item.node.nodeValue = item.original;
                }
              } catch (e) {}
            });
          }
          window.__aeroTranslationState = null;
          window.__aeroTranslated = false;
        })(${jobId}, ${restoreAppliedText})
      `);
    };

    try {
      const translationMode = await wc.executeJavaScript(`
        (function(jobId) {
          if (!window.__aeroTranslated) return 'translate';

          var state = window.__aeroTranslationState;
          if (state && Array.isArray(state.nodes)) {
            state.nodes.forEach(function(item) {
              try {
                var expected = item.prefix + (item.translated || '') + item.suffix;
                if (item.node && item.node.isConnected && item.translated && item.node.nodeValue === expected) {
                  item.node.nodeValue = item.original;
                }
              } catch (e) {}
            });
          }
          window.__aeroTranslationState = null;
          window.__aeroTranslated = false;
          return 'restore';
        })(${jobId})
      `);
      if (translationMode === 'restore') {
        return false;
      }
      if (!this.isCurrentTranslationJob(tabId, entry, jobId, translationUrl, wc)) {
        await clearTranslationState(false);
        return false;
      }

      const extractResult: string[] = await wc.executeJavaScript(`
        (function() {
          var blockedTags = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'SVG', 'CANVAS']);
          var maxNodes = ${TRANSLATION_LIMITS.maxTranslatableNodes};
          var maxTextChars = ${TRANSLATION_LIMITS.maxTextChars};
          var nodes = [];
          var texts = [];
          var visibilityCache = new WeakMap();
          function isVisible(parent, doc) {
            if (visibilityCache.has(parent)) return visibilityCache.get(parent);
            var style = (doc.defaultView || window).getComputedStyle(parent);
            var visible = style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.opacity !== '0';
            visibilityCache.set(parent, visible);
            return visible;
          }
          function collectDocument(doc) {
            if (!doc || nodes.length >= maxNodes) return;
            var walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_TEXT);
            var node;

            while ((node = walker.nextNode()) && nodes.length < maxNodes) {
              var parent = node.parentElement;
              if (!parent || blockedTags.has(parent.tagName) || parent.closest('script,style,code,pre,noscript,textarea,input,select,option,[contenteditable],[data-aero-ignore-translation]')) continue;
              if (!isVisible(parent, doc)) continue;

              var raw = node.nodeValue || '';
              var text = raw.trim();
              if (text.length < 2 || text.length > maxTextChars || !/[\\p{L}\\p{N}]/u.test(text)) continue;

              var start = raw.indexOf(text);
              nodes.push({
                node: node,
                original: raw,
                prefix: start > 0 ? raw.slice(0, start) : '',
                suffix: start >= 0 ? raw.slice(start + text.length) : '',
                text: text,
                translated: '',
              });
              texts.push(text);
            }

            if (nodes.length >= maxNodes) return;
            Array.from(doc.querySelectorAll('iframe, frame')).forEach(function(frame) {
              if (nodes.length >= maxNodes) return;
              try {
                if (frame.contentDocument) collectDocument(frame.contentDocument);
              } catch (e) {}
            });
          }

          collectDocument(document);

          window.__aeroTranslationState = { jobId: ${jobId}, nodes: nodes, translated: false };
          window.__aeroTranslated = false;
          return texts;
        })()
      `);

      if (!this.isCurrentTranslationJob(tabId, entry, jobId, translationUrl, wc)) {
        await clearTranslationState(false);
        return false;
      }
      if (!extractResult || extractResult.length === 0) {
        await clearTranslationState(false);
        return false;
      }

      const CHUNK_SIZE = TRANSLATION_LIMITS.maxTextsPerRequest;
      const MAX_CONCURRENT_CHUNKS = TRANSLATION_LIMITS.maxConcurrentRequests;
      const chunks: { start: number; texts: string[] }[] = [];
      for (let start = 0; start < extractResult.length; start += CHUNK_SIZE) {
        chunks.push({ start, texts: extractResult.slice(start, start + CHUNK_SIZE) });
      }
      const translatedTexts: string[] = new Array(extractResult.length);
      for (let groupStart = 0; groupStart < chunks.length; groupStart += MAX_CONCURRENT_CHUNKS) {
        if (!this.isCurrentTranslationJob(tabId, entry, jobId, translationUrl, wc)) {
          await clearTranslationState(false);
          return false;
        }
        const group = chunks.slice(groupStart, groupStart + MAX_CONCURRENT_CHUNKS);
        const translatedGroup = await Promise.all(group.map(async (chunk) => {
          const translated = await translateBatchFn(chunk.texts);
          if (
            !Array.isArray(translated) ||
            translated.length !== chunk.texts.length ||
            translated.some((value, index) => typeof value !== 'string' || (chunk.texts[index].trim() && !value.trim()))
          ) {
            throw new TranslationError('invalid_response', '온라인 번역 응답이 올바르지 않습니다.');
          }
          return translated;
        }));

        for (let i = 0; i < group.length; i++) {
          const chunk = group[i];
          for (let j = 0; j < chunk.texts.length; j++) translatedTexts[chunk.start + j] = translatedGroup[i][j];
        }
      }

      if (!this.isCurrentTranslationJob(tabId, entry, jobId, translationUrl, wc)) {
        await clearTranslationState(false);
        return false;
      }

      const appliedCount = await wc.executeJavaScript(`
        (function(jobId, translations) {
          var state = window.__aeroTranslationState;
          if (!state || state.jobId !== jobId || !Array.isArray(state.nodes)) return 0;
          var applied = 0;
          for (var i = 0; i < translations.length; i++) {
            var item = state.nodes[i];
            var translated = translations[i];
            if (!item || !item.node || !item.node.isConnected || !translated || !translated.trim()) continue;
            try {
              // Do not overwrite text changed by the site while the request
              // was in flight. This keeps SPA updates safe.
              if (item.node.nodeValue !== item.original) continue;
              item.node.nodeValue = item.prefix + translated + item.suffix;
              item.translated = translated;
              applied++;
            } catch (e) {}
          }
          return applied;
        })(${jobId}, ${JSON.stringify(translatedTexts)})
      `);

      if (!this.isCurrentTranslationJob(tabId, entry, jobId, translationUrl, wc)) {
        await clearTranslationState(true);
        return false;
      }
      if (!appliedCount) {
        await clearTranslationState(false);
        return false;
      }

      await wc.executeJavaScript(`
        (function(jobId) {
          var state = window.__aeroTranslationState;
          if (state && state.jobId === jobId) {
            state.translated = true;
            window.__aeroTranslated = true;
          }
        })(${jobId})
      `);
      return true;
    } catch (err) {
      const normalized = normalizeTranslationError(err);
      console.warn('[Translation]', {
        provider: 'google-mobile-web',
        code: normalized.code,
        durationMs: Date.now() - startedAt,
      });
      try {
        await clearTranslationState(true);
      } catch {}
      return false;
    }
  }

  public destroyAll() {
    const entries = Array.from(this.tabs.values());
    this.tabs.clear();
    this.translationJobVersions.clear();
    this.activeTabId = null;
    this.splitSecondaryTabId = null;
    for (const entry of entries) {
      try {
        entry.view.setVisible(false);
        this.mainWindow.contentView.removeChildView(entry.view);
        entry.view.webContents.close({ waitForBeforeUnload: false });
      } catch {}
    }
  }

  private notifyTabStatus(tabId: string) {
    const entry = this.tabs.get(tabId);
    if (!entry || this.mainWindow.isDestroyed() || entry.view.webContents.isDestroyed()) return;

    this.sendToChrome('tab:status-updated', {
      id: tabId,
      url: entry.url,
      title: entry.title,
      canGoBack: entry.canGoBack,
      canGoForward: entry.canGoForward,
      isLoading: entry.isLoading,
      error: null,
    });
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
          entry.view.setVisible(false);
          continue;
        }
        const isSecondary = split && id === this.splitSecondaryTabId;
        entry.view.setBounds({
          x: this.bounds.x + (isSecondary ? primaryWidth + gutter : 0),
          y: this.bounds.y,
          width: isSecondary ? this.bounds.width - primaryWidth - gutter : primaryWidth,
          height: this.bounds.height,
        });
        entry.view.setVisible(true);
      } catch {}
    }
  }

  private sendToChrome(channel: string, payload?: unknown) {
    if (this.mainWindow.isDestroyed() || this.mainWindow.webContents.isDestroyed()) return;
    try {
      this.mainWindow.webContents.send(channel, payload);
    } catch {}
  }

  private normalizeTabUrl(url: unknown): string {
    if (typeof url !== 'string') return 'aero://newtab';
    const trimmed = url.trim();
    if (this.isVirtualUrl(trimmed)) return 'aero://newtab';
    if (!this.isLoadableUrl(trimmed)) return 'aero://newtab';
    try {
      return new URL(trimmed).href;
    } catch {
      return 'aero://newtab';
    }
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
