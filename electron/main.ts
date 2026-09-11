import { app, BrowserWindow, ipcMain, session, Menu, shell, clipboard, dialog } from 'electron';
import * as path from 'path';
import * as http from 'http';
import { randomUUID } from 'crypto';
import { pathToFileURL } from 'url';
import { DataManager } from './DataManager';
import { DownloadManager } from './DownloadManager';
import { PermissionManager } from './PermissionManager';
import { TabManager } from './TabManager';
import { ClearDataOptions, Workspace } from './types';
import { normalizeTranslationError, TRANSLATION_LIMITS, TranslationError } from './translation';
import { clearOriginStorage } from './siteData';
import { UpdateManager } from './Updater';

let mainWindow: BrowserWindow | null = null;
const allWindows: Set<BrowserWindow> = new Set();
const windowTabManagers: Map<BrowserWindow, TabManager> = new Map();
const dataManager = new DataManager();
const downloadManager = new DownloadManager();
const permissionManager = new PermissionManager(dataManager);
const updateManager = new UpdateManager();
const adBlockSessions = new WeakSet<Electron.Session>();
const downloadSessions = new WeakSet<Electron.Session>();
const cookiePolicySessions = new WeakSet<Electron.Session>();
let pendingOpenUrl: string | null = null;
let crashRecoveryPending = dataManager.didPreviousRunCrash();

let adBlockEnabled = true;
let totalBlockedCount = 0;

// Indexed host list for the small built-in blocker. This is intentionally not
// advertised as a full EasyList-compatible blocker.
const AD_DOMAINS = new Set([
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.com',
  'criteo.com',
  'criteo.net',
  'adnxs.com',
  'taboola.com',
  'outbrain.com',
  'scorecardresearch.com',
  'amazon-adsystem.com',
  'adsystem.com',
  'facebook.net',
  'ads.twitter.com',
  'analytics.twitter.com',
  'ads.tiktok.com',
  'popads.net',
  'propellerads.com',
  'adcolony.com',
  'applifier.com',
  'unityads.unity3d.com',
  'adroll.com',
  'moatads.com',
  'smartadserver.com',
  'pubmatic.com',
  'rubiconproject.com',
  'openx.net',
  '33across.com',
  'adsafeprotected.com',
  'advertising.com',
  'adform.net',
  'adition.com',
  'adkernel.com',
  'adlightning.com',
  'admatic.com.tr',
  'adsrvr.org',
  'adstir.com',
  'appier.com',
  'bidvertiser.com',
  'bluekai.com',
  'casalemedia.com',
  'contextweb.com',
  'conversantmedia.com',
  'demdex.net',
  'exoclick.com',
  'eyeota.net',
  'flashtalking.com',
  'getclicky.com',
  'gumgum.com',
  'lijit.com',
  'liveintent.com',
  'mathtag.com',
  'media.net',
  'mixpanel.com',
  'neustar.biz',
  'nr-data.net',
  'quantserve.com',
  'rlcdn.com',
  'revcontent.com',
  'sail-horizon.com',
  'sharethrough.com',
  'simpli.fi',
  'sitescout.com',
  'skimresources.com',
  'tapad.com',
  'tidaltv.com',
  'tribalfusion.com',
  'turn.com',
  'zedo.com',
]);

function isBrowserUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeClearDataOptions(value: unknown): ClearDataOptions {
  const options = value && typeof value === 'object' ? (value as Partial<ClearDataOptions>) : {};
  return {
    history: options.history === true,
    searchHistory: options.searchHistory === true,
    downloads: options.downloads === true,
    cookies: options.cookies === true,
    cache: options.cache === true,
    timeRange: options.timeRange === 'hour' || options.timeRange === 'day' || options.timeRange === 'week' ? options.timeRange : 'all',
  };
}

function isAdUrl(rawUrl: string, resourceType?: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname;
    for (const adDomain of AD_DOMAINS) {
      if (host === adDomain || host.endsWith('.' + adDomain)) {
        if (adDomain === 'facebook.net' && !parsed.pathname.startsWith('/tr')) {
          continue;
        }
        return true;
      }
    }
    // Cover common first-party ad paths without blocking normal document
    // navigations. This is a conservative supplement to the host list.
    if (resourceType && resourceType !== 'mainFrame' && /^(script|stylesheet|image|font|media|xhr|fetch|subFrame)$/.test(resourceType)) {
      const adPath = /(?:^|[\/_\-.])(adserver|advert(?:isement|ising)?|banner|doubleclick|popunder|prebid|tracking-pixel)(?:[\/_\-.]|$)/i;
      if (adPath.test(parsed.pathname)) return true;
    }
  } catch {}
  return false;
}

function setupAdBlocker(ses: Electron.Session) {
  // Electron allows one onBeforeRequest listener per session. Re-registering it
  // for every window silently replaces the old listener and makes behaviour
  // depend on which window was created last.
  if (adBlockSessions.has(ses)) return;
  adBlockSessions.add(ses);

  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    if (!adBlockEnabled) {
      return callback({ cancel: false });
    }

    try {
      if (isAdUrl(details.url, details.resourceType)) {
        totalBlockedCount++;
        for (const win of allWindows) {
          if (!win.isDestroyed()) {
            win.webContents.send('adblock:blocked', totalBlockedCount);
          }
        }
        return callback({ cancel: true });
      }
    } catch {}

    callback({ cancel: false });
  });
}

function approximateSite(hostname: string): string {
  const normalized = hostname.toLowerCase().replace(/^\.|\.$/g, '');
  if (!normalized || normalized === 'localhost' || /^\d+(?:\.\d+){3}$/.test(normalized) || normalized.includes(':')) return normalized;
  const labels = normalized.split('.').filter(Boolean);
  return labels.length > 2 ? labels.slice(-2).join('.') : normalized;
}

function cookieDecision(requestUrl: string, firstPartyUrl: string | undefined): 'allow' | 'block' {
  const settings = dataManager.getSettings();
  try {
    const target = new URL(requestUrl);
    const targetOrigin = target.origin;
    const explicit = settings.cookieExceptions[targetOrigin];
    if (explicit) return explicit;
    if (settings.cookiePolicy !== 'block-third-party' || !firstPartyUrl) return 'allow';
    const firstParty = new URL(firstPartyUrl);
    const firstPartyExplicit = settings.cookieExceptions[firstParty.origin];
    if (firstPartyExplicit === 'allow') return 'allow';
    return approximateSite(target.hostname) === approximateSite(firstParty.hostname) ? 'allow' : 'block';
  } catch {
    return 'allow';
  }
}

function setupCookiePolicy(ses: Electron.Session) {
  if (cookiePolicySessions.has(ses)) return;
  cookiePolicySessions.add(ses);

  ses.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const firstPartyUrl = details.webContents && !details.webContents.isDestroyed()
      ? details.webContents.getURL()
      : details.referrer;
    if (cookieDecision(details.url, firstPartyUrl) !== 'block') return callback({ requestHeaders: details.requestHeaders });
    const requestHeaders = { ...details.requestHeaders };
    for (const name of Object.keys(requestHeaders)) {
      if (name.toLowerCase() === 'cookie') delete requestHeaders[name];
    }
    callback({ requestHeaders });
  });

  ses.webRequest.onHeadersReceived({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const firstPartyUrl = details.webContents && !details.webContents.isDestroyed()
      ? details.webContents.getURL()
      : details.referrer;
    if (cookieDecision(details.url, firstPartyUrl) !== 'block' || !details.responseHeaders) {
      return callback({ responseHeaders: details.responseHeaders });
    }
    const responseHeaders = { ...details.responseHeaders };
    for (const name of Object.keys(responseHeaders)) {
      if (name.toLowerCase() === 'set-cookie' || name.toLowerCase() === 'set-cookie2') delete responseHeaders[name];
    }
    callback({ responseHeaders });
  });
}

function applySessionPreferences(ses: Electron.Session) {
  const settings = dataManager.getSettings();
  // Keep the runtime's real Electron/Chromium identity. A hard-coded Chrome
  // version can drift from the embedded engine and does not make embedded
  // authentication flows equivalent to a supported system browser.
  ses.setUserAgent(app.userAgentFallback, settings.preferredLanguages.join(','));
  ses.setSpellCheckerEnabled(settings.spellCheckEnabled);
  if (settings.spellCheckEnabled) {
    const available = new Set(ses.availableSpellCheckerLanguages);
    const spellcheckLanguages = settings.preferredLanguages.filter((language) => available.has(language));
    if (spellcheckLanguages.length > 0) ses.setSpellCheckerLanguages(spellcheckLanguages);
  }
}

function applyPreferencesToOpenSessions() {
  const sessions = new Set<Electron.Session>([session.defaultSession]);
  for (const manager of windowTabManagers.values()) sessions.add(manager.getSession());
  for (const targetSession of sessions) applySessionPreferences(targetSession);
}

function createWindow(options?: { isIncognito?: boolean; initialUrl?: string }) {
  const isIncognito = options?.isIncognito ?? false;
  const initialUrl = options?.initialUrl && isBrowserUrl(options.initialUrl) ? options.initialUrl : undefined;
  const ses = isIncognito
    ? session.fromPartition(`incognito-${randomUUID()}`)
    : session.defaultSession;

  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 800,
    minHeight: 600,
    // Only macOS uses the custom hidden-inset titlebar. Windows keeps its
    // native frame and native minimize/maximize/close controls.
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 18, y: 9 },
        }
      : {}),
    backgroundColor: '#050505',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true,
      sandbox: true,
      session: ses,
    },
  });

  const tabManager = new TabManager(win, ses);
  windowTabManagers.set(win, tabManager);
  updateManager.attachWindow(win);

  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = win;
  }
  allWindows.add(win);

  applySessionPreferences(ses);

  // Keep the ad blocker setting consistent with the persisted preference.
  adBlockEnabled = dataManager.getSettings().adBlockEnabled ?? true;

  // Setup security & handlers
  setupAdBlocker(ses);
  setupCookiePolicy(ses);

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    permissionManager.handlePermissionRequest(webContents, permission, callback, details, (request) => {
      const ownerWindow = getWindowForWebContents(webContents);
      if (ownerWindow && !ownerWindow.isDestroyed()) {
        ownerWindow.webContents.send('permission:request', request);
      } else {
        permissionManager.resolveRequest(request.requestId, 'deny');
      }
    });
  });

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    return permissionManager.handlePermissionCheck(webContents, permission, requestingOrigin, details);
  });

  // A normal window uses the shared default session. Register this listener
  // once per session or every new window would receive the same download.
  if (!downloadSessions.has(ses)) {
    downloadSessions.add(ses);
    ses.on('will-download', (event, item, webContents) => {
      const ownerWindow = getWindowForWebContents(webContents);
      const preferences = dataManager.getSettings();
      downloadManager.handleWillDownload(event, item, webContents, ownerWindow, {
        downloadPath: preferences.downloadPath,
        askDownloadLocation: preferences.askDownloadLocation,
        onUpdate: (info) => {
          if (ses.isPersistent()) dataManager.upsertDownload(info);
        },
      });
    });
  }

  // Keep all external navigation inside a managed tab. This prevents a
  // popup from escaping the selected session (especially from incognito).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (win && !win.isDestroyed() && (isBrowserUrl(url) || /^(mailto|tel|vscode|zoommtg):/i.test(url))) {
      win.webContents.send('tab:open-external', url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer] [L${level}] ${message} (${sourceId}:${line})`);
  });

  const isDev = process.env.NODE_ENV === 'development';
  const distPath = path.join(__dirname, '../dist/index.html');
  const query = new URLSearchParams();
  if (isIncognito) query.set('incognito', '1');
  if (initialUrl) query.set('initialUrl', initialUrl);
  const queryParam = query.toString() ? `?${query.toString()}` : '';

  if (isDev) {
    const devServerUrl = (process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173') + queryParam;
    win.loadURL(devServerUrl).catch(() => {
      win?.loadFile(distPath, { search: queryParam });
    });
  } else {
    win.loadFile(distPath, { search: queryParam });
  }

  // The browser chrome must never be navigated away from its local app page.
  // Programmatic loadURL/loadFile calls above are unaffected by this guard.
  win.webContents.on('will-navigate', (event, url) => {
    if (isDev && url.startsWith(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173')) return;
    event.preventDefault();
  });

  win.on('closed', () => {
    const tm = windowTabManagers.get(win);
    if (tm) {
      tm.destroyAll();
      windowTabManagers.delete(win);
    }
    updateManager.detachWindow(win);
    if (!ses.isPersistent()) downloadManager.removeSession(ses);
    allWindows.delete(win);
    if (isIncognito) {
      ses.clearStorageData().catch(() => {});
      ses.clearCache().catch(() => {});
    }
    if (mainWindow === win) {
      mainWindow = allWindows.values().next().value || null;
    }
    if (allWindows.size === 0) {
      dataManager.flushSync();
    }
  });

  return win;
}

// Native macOS Application Menu
function setupApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const getActiveWin = () => BrowserWindow.getFocusedWindow() || mainWindow;

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'Aero',
            submenu: [
              {
                label: 'Aero 정보',
                click: () => getActiveWin()?.webContents.send('menu:open-about'),
              },
              { type: 'separator' as const },
              {
                label: '환경설정...',
                accelerator: 'CmdOrCtrl+,',
                click: () => getActiveWin()?.webContents.send('menu:open-settings'),
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const, label: 'Aero 숨기기' },
              { role: 'hideOthers' as const, label: '기타 숨기기' },
              { role: 'unhide' as const, label: '모두 표시' },
              { type: 'separator' as const },
              { role: 'quit' as const, label: 'Aero 종료' },
            ],
          },
        ]
      : []),
    {
      label: '파일',
      submenu: [
        {
          label: '새 탭',
          accelerator: 'CmdOrCtrl+T',
          click: () => getActiveWin()?.webContents.send('menu:new-tab'),
        },
        {
          label: '새 창',
          accelerator: 'CmdOrCtrl+N',
          click: () => createWindow(),
        },
        {
          label: '새 시크릿 창',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => createWindow({ isIncognito: true }),
        },
        { type: 'separator' as const },
        {
          label: '파일 열기...',
          accelerator: 'CmdOrCtrl+O',
          click: () => getActiveWin()?.webContents.send('menu:open-file'),
        },
        {
          label: '페이지 인쇄...',
          accelerator: 'CmdOrCtrl+P',
          click: () => getActiveWin()?.webContents.send('menu:print'),
        },
        {
          label: '페이지를 PDF로 저장...',
          click: () => getActiveWin()?.webContents.send('menu:save-pdf'),
        },
        { type: 'separator' as const },
        {
          label: '탭 닫기',
          accelerator: 'CmdOrCtrl+W',
          click: () => getActiveWin()?.webContents.send('menu:close-tab'),
        },
        { role: 'close' as const, label: '창 닫기' },
      ],
    },
    {
      label: '편집',
      submenu: [
        { role: 'undo' as const, label: '실행 취소' },
        { role: 'redo' as const, label: '다시 실행' },
        { type: 'separator' as const },
        { role: 'cut' as const, label: '오려두기' },
        { role: 'copy' as const, label: '복사' },
        { role: 'paste' as const, label: '붙여넣기' },
        { role: 'selectAll' as const, label: '모두 선택' },
      ],
    },
    {
      label: '보기',
      submenu: [
        {
          label: '새로고침',
          accelerator: 'CmdOrCtrl+R',
          click: () => getActiveWin()?.webContents.send('menu:reload'),
        },
        {
          label: '캐시 비우고 새로고침',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => getActiveWin()?.webContents.send('menu:reload-nocache'),
        },
        { type: 'separator' as const },
        {
          label: '실제 크기',
          accelerator: 'CmdOrCtrl+0',
          click: () => getActiveWin()?.webContents.send('menu:reset-zoom'),
        },
        {
          label: '확대',
          accelerator: 'CmdOrCtrl+=',
          click: () => getActiveWin()?.webContents.send('menu:zoom-in'),
        },
        {
          label: '축소',
          accelerator: 'CmdOrCtrl+-',
          click: () => getActiveWin()?.webContents.send('menu:zoom-out'),
        },
        { type: 'separator' as const },
        {
          label: '전체 화면',
          accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11',
          click: () => {
            const win = getActiveWin();
            if (win) win.setFullScreen(!win.isFullScreen());
          },
        },
        {
          label: 'Aside 패널 토글',
          accelerator: 'CmdOrCtrl+\\',
          click: () => getActiveWin()?.webContents.send('menu:toggle-aside'),
        },
      ],
    },
    {
      label: '방문 기록',
      submenu: [
        {
          label: '뒤로 가기',
          accelerator: 'CmdOrCtrl+[',
          click: () => getActiveWin()?.webContents.send('nav:app-backward'),
        },
        {
          label: '앞으로 가기',
          accelerator: 'CmdOrCtrl+]',
          click: () => getActiveWin()?.webContents.send('nav:app-forward'),
        },
        { type: 'separator' as const },
        {
          label: '닫은 탭 다시 열기',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => getActiveWin()?.webContents.send('menu:reopen-closed-tab'),
        },
        {
          label: '북마크·방문 기록·다운로드',
          accelerator: 'CmdOrCtrl+Shift+H',
          click: () => getActiveWin()?.webContents.send('menu:open-library'),
        },
      ],
    },
    {
      label: '북마크',
      submenu: [
        {
          label: '현재 페이지 북마크 추가/제거',
          click: () => getActiveWin()?.webContents.send('menu:toggle-bookmark'),
        },
        {
          label: '북마크 바 표시/숨기기',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => getActiveWin()?.webContents.send('menu:toggle-bookmark-bar'),
        },
        {
          label: '북마크 관리',
          click: () => getActiveWin()?.webContents.send('menu:open-library'),
        },
      ],
    },
    {
      label: '윈도우',
      submenu: [
        { role: 'minimize' as const, label: '최소화' },
        { role: 'zoom' as const, label: '확대/축소' },
        { type: 'separator' as const },
        { role: 'front' as const, label: '모두 앞으로 가져오기' },
      ],
    },
    {
      label: '도움말',
      submenu: [
        {
          label: '커맨드 팔레트 실행',
          accelerator: 'CmdOrCtrl+K',
          click: () => getActiveWin()?.webContents.send('menu:open-command-palette'),
        },
        {
          label: '개발자 도구 토글',
          accelerator: 'Alt+CmdOrCtrl+I',
          click: () => getActiveWin()?.webContents.send('menu:toggle-devtools'),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Window Controls IPC
ipcMain.on('window:minimize', (event) => {
  const win = getWindowForWebContents(event.sender);
  win?.minimize();
});
ipcMain.on('window:maximize', (event) => {
  const win = getWindowForWebContents(event.sender);
  if (!win) return;
  if (win.isFullScreen()) {
    win.setFullScreen(false);
  } else if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
});
ipcMain.on('window:toggle-fullscreen', (event) => {
  const win = getWindowForWebContents(event.sender);
  if (!win) return;
  win.setFullScreen(!win.isFullScreen());
});
ipcMain.on('window:close', (event) => {
  const win = getWindowForWebContents(event.sender);
  win?.close();
});
ipcMain.handle('window:isMaximized', (event) => {
  const win = getWindowForWebContents(event.sender);
  return win?.isMaximized() ?? false;
});

// Application updates. The updater is intentionally manual-download: the
// user must explicitly start the download and restart after it is ready.
ipcMain.handle('app:update-check', () => updateManager.checkForUpdates());
ipcMain.handle('app:update-download', () => updateManager.downloadUpdate());
ipcMain.on('app:update-install', () => updateManager.installUpdate());

// WebContentsView Native TabManager IPC
function getWinTabManager(sender: Electron.WebContents): TabManager | undefined {
  const directWin = BrowserWindow.fromWebContents(sender);
  if (directWin) return windowTabManagers.get(directWin);

  // WebContentsView webContents is not a BrowserWindow webContents, so
  // BrowserWindow.fromWebContents(sender) returns null for every guest view.
  // Resolve the owning manager explicitly to keep multi-window IPC isolated.
  for (const manager of windowTabManagers.values()) {
    if (manager.ownsWebContents(sender)) return manager;
  }

  return undefined;
}

function getWindowForWebContents(sender: Electron.WebContents): BrowserWindow | null {
  const directWin = BrowserWindow.fromWebContents(sender);
  if (directWin) return directWin;
  for (const [win, manager] of windowTabManagers) {
    if (manager.ownsWebContents(sender)) return win;
  }
  return null;
}

function getSessionForWebContents(sender: Electron.WebContents): Electron.Session | null {
  return getWinTabManager(sender)?.getSession() || null;
}

function isPersistentSender(sender: Electron.WebContents): boolean {
  return getSessionForWebContents(sender)?.isPersistent() ?? false;
}

function parseHttpOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

function openUrlInActiveWindow(url: string) {
  if (!isBrowserUrl(url)) return;
  const activeWin = BrowserWindow.getFocusedWindow() || mainWindow;
  if (activeWin && !activeWin.isDestroyed()) {
    activeWin.webContents.send('tab:open-external', url);
  } else {
    pendingOpenUrl = url;
  }
}

ipcMain.on('tab:create', (event, { id, url, isIncognito }) => {
  getWinTabManager(event.sender)?.createTab(id, url, isIncognito);
});

ipcMain.on('tab:close', (event, tabId: string) => {
  getWinTabManager(event.sender)?.closeTab(tabId);
});

ipcMain.on('tab:switch', (event, tabId: string) => {
  getWinTabManager(event.sender)?.switchTab(tabId);
});

ipcMain.on('tab:navigate', (event, { id, url }: { id: string; url: string }) => {
  getWinTabManager(event.sender)?.navigateTab(id, url);
});

ipcMain.on('tab:goBack', (event, tabId: string) => {
  getWinTabManager(event.sender)?.goBack(tabId);
});

ipcMain.on('tab:goForward', (event, tabId: string) => {
  getWinTabManager(event.sender)?.goForward(tabId);
});

ipcMain.on('tab:reload', (event, { id, ignoreCache }: { id: string; ignoreCache?: boolean }) => {
  getWinTabManager(event.sender)?.reload(id, ignoreCache);
});

ipcMain.on('tab:stop', (event, tabId: string) => {
  getWinTabManager(event.sender)?.stop(tabId);
});

ipcMain.on('tab:setMuted', (event, { id, muted }: { id: string; muted: boolean }) => {
  getWinTabManager(event.sender)?.setMuted(id, muted);
});

ipcMain.on('tab:setZoom', (event, { id, zoom }: { id: string; zoom: number }) => {
  getWinTabManager(event.sender)?.setZoom(id, zoom);
});

ipcMain.on('tab:find', (event, { id, text, forward }: { id: string; text: string; forward: boolean }) => {
  getWinTabManager(event.sender)?.findInPage(id, text, forward);
});

ipcMain.on('tab:stopFind', (event, tabId: string) => {
  getWinTabManager(event.sender)?.stopFindInPage(tabId);
});

ipcMain.on('tab:toggleDevTools', (event, tabId: string) => {
  getWinTabManager(event.sender)?.toggleDevTools(tabId);
});

ipcMain.handle('tab:translate', async (event, tabId: string) => {
  const tm = getWinTabManager(event.sender);
  if (tm) {
    return await tm.translatePage(tabId, (texts) => translateBatchWithGoogle(texts, 'ko'));
  }
  return false;
});

ipcMain.on('tab:setBounds', (event, bounds) => {
  getWinTabManager(event.sender)?.setBounds(bounds);
});

ipcMain.on('tab:setOverlay', (event, isOverlay: boolean) => {
  getWinTabManager(event.sender)?.setOverlay(isOverlay);
});

ipcMain.on('tab:setSplit', (event, { enabled, secondaryTabId, ratio }: { enabled: boolean; secondaryTabId?: string | null; ratio?: number }) => {
  getWinTabManager(event.sender)?.setSplitView(enabled, secondaryTabId, ratio);
});
ipcMain.on('tab:setSplitRatio', (event, ratio: number) => {
  getWinTabManager(event.sender)?.setSplitRatio(ratio);
});

// Guest View Event Relays
ipcMain.on('tab:guest-gesture', (event, action: string) => {
  const win = getWindowForWebContents(event.sender);
  win?.webContents.send('tab:gesture', { action });
});

ipcMain.on('tab:guest-open-newtab', (event, url: string) => {
  const win = getWindowForWebContents(event.sender);
  if (win && isBrowserUrl(url)) win.webContents.send('tab:open-external', url);
});

ipcMain.on('tab:guest-drawer-translate', (event, text: string) => {
  const win = getWindowForWebContents(event.sender);
  win?.webContents.send('tab:selection-translate', text);
});

// Settings & Preferences IPC
ipcMain.handle('settings:get', () => dataManager.getSettings());
ipcMain.handle('settings:update', (_e, updates) => {
  const settings = dataManager.updateSettings(updates);
  if (typeof updates?.adBlockEnabled === 'boolean') {
    adBlockEnabled = updates.adBlockEnabled;
  }
  if (updates?.preferredLanguages || typeof updates?.spellCheckEnabled === 'boolean') applyPreferencesToOpenSessions();
  return settings;
});
ipcMain.handle('settings:reset', () => {
  const settings = dataManager.resetSettings();
  adBlockEnabled = settings.adBlockEnabled;
  applyPreferencesToOpenSessions();
  return settings;
});

// Favorites (New Tab) IPC
ipcMain.handle('favorites:get', () => dataManager.getFavorites());
ipcMain.handle('favorites:add', (_e, fav) => dataManager.addFavorite(fav));
ipcMain.handle('favorites:remove', (_e, id: string) => dataManager.removeFavorite(id));
ipcMain.handle('favorites:update', (_e, id: string, updates) => dataManager.updateFavorite(id, updates));

// Workspaces are persisted only for the normal browser session. Private
// windows get one ephemeral workspace and never write it to disk.
ipcMain.handle('workspaces:get', (event) => {
  const manager = getWinTabManager(event.sender);
  if (manager?.getSession().isPersistent()) return dataManager.getWorkspaces();
  return { workspaces: [{ id: 'workspace-private', name: '시크릿', color: '#8b5cf6' }], activeWorkspaceId: 'workspace-private' };
});
ipcMain.handle('workspaces:save', (event, workspaces: Workspace[], activeWorkspaceId: string) => {
  const manager = getWinTabManager(event.sender);
  if (manager?.getSession().isPersistent()) return dataManager.saveWorkspaces(workspaces, activeWorkspaceId);
  return { workspaces, activeWorkspaceId };
});

// Default Browser IPC
ipcMain.handle('app:isDefaultBrowser', () => {
  try {
    return app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https');
  } catch {
    return false;
  }
});
ipcMain.handle('app:makeDefaultBrowser', () => {
  try {
    const httpRegistered = app.setAsDefaultProtocolClient('http');
    const httpsRegistered = app.setAsDefaultProtocolClient('https');
    return httpRegistered && httpsRegistered;
  } catch {
    return false;
  }
});

// Bookmarks HTML Import & Export
ipcMain.handle('bookmarks:exportHtml', () => dataManager.exportBookmarksHtml());
ipcMain.handle('bookmarks:importHtml', (_e, html: string) => dataManager.importBookmarksHtml(html));

// Settings JSON Import & Export
ipcMain.handle('settings:exportJson', () => dataManager.exportSettingsJson());
ipcMain.handle('settings:importJson', (_e, jsonStr: string) => {
  const imported = dataManager.importSettingsJson(jsonStr);
  if (imported) adBlockEnabled = dataManager.getSettings().adBlockEnabled;
  return imported;
});

// Clear Browsing Data
ipcMain.handle('data:clearBrowsingData', async (event, options: ClearDataOptions) => {
  const targetSession = getSessionForWebContents(event.sender);
  if (!targetSession) return;
  const safeOptions = normalizeClearDataOptions(options);
  const cutoff = safeOptions.timeRange === 'hour'
    ? Date.now() - 3600 * 1000
    : safeOptions.timeRange === 'day'
      ? Date.now() - 24 * 3600 * 1000
      : safeOptions.timeRange === 'week'
        ? Date.now() - 7 * 24 * 3600 * 1000
        : 0;
  const isPersistentSession = targetSession.isPersistent();
  if (isPersistentSession) dataManager.clearBrowsingData(safeOptions);
  if (safeOptions.downloads) {
    downloadManager.clearHistory(targetSession, cutoff);
    event.sender.send('downloads:cleared', cutoff);
  }
  if (safeOptions.cache) {
    await targetSession.clearCache();
  }
  if (safeOptions.cookies) {
    await targetSession.clearStorageData({
      storages: ['cookies', 'localstorage', 'serviceworkers', 'cachestorage', 'indexdb', 'websql', 'filesystem'],
    });
  }
});

// Site Data & Zoom
ipcMain.handle('site:clearData', async (_e, origin: string) => {
  try {
    const targetSession = getSessionForWebContents(_e.sender);
    if (!targetSession) return false;
    return await clearOriginStorage(targetSession, origin);
  } catch {
    return false;
  }
});
ipcMain.handle('site:listData', async (event) => {
  const manager = getWinTabManager(event.sender);
  const targetSession = manager?.getSession();
  if (!manager || !targetSession) return [];
  const cookies = await targetSession.cookies.get({});
  const grouped = new Map<string, { origin: string; hostname: string; cookieCount: number }>();
  const openOrigins = manager.getHttpOrigins();
  for (const cookie of cookies) {
    const hostname = (cookie.domain || '').replace(/^\./, '').toLowerCase();
    if (!hostname) continue;
    const matchingOpenOrigin = openOrigins.find((candidate) => {
      const parsed = new URL(candidate);
      return parsed.protocol === (cookie.secure ? 'https:' : 'http:') &&
        (parsed.hostname === hostname || parsed.hostname.endsWith(`.${hostname}`));
    });
    const origin = matchingOpenOrigin || `${cookie.secure ? 'https' : 'http'}://${hostname}`;
    const current = grouped.get(origin) || { origin, hostname, cookieCount: 0 };
    current.cookieCount += 1;
    grouped.set(origin, current);
  }
  return Array.from(grouped.values()).sort((a, b) => a.hostname.localeCompare(b.hostname));
});
ipcMain.handle('site:getZoom', (_e, origin: string) => dataManager.getSiteZoom(origin));
ipcMain.handle('site:setZoom', (_e, origin: string, zoom: number) => {
  dataManager.setSiteZoom(origin, zoom);
});

// Multi-Window & Screenshot
ipcMain.on('window:newWindow', (_e, url?: string) => createWindow({ initialUrl: url }));
ipcMain.on('window:newPrivateWindow', (_e, url?: string) => createWindow({ isIncognito: true, initialUrl: url }));
ipcMain.handle('page:captureVisible', async (event) => {
  const ownerWindow = getWindowForWebContents(event.sender);
  if (!ownerWindow || ownerWindow.isDestroyed()) return null;
  try {
    const img = await ownerWindow.capturePage();
    clipboard.writeImage(img);
    return img.toDataURL();
  } catch {
    return null;
  }
});

ipcMain.handle('file:open', async (event) => {
  const ownerWindow = getWindowForWebContents(event.sender);
  if (!ownerWindow || ownerWindow.isDestroyed()) return null;
  const result = await dialog.showOpenDialog(ownerWindow, {
    title: '파일 열기',
    properties: ['openFile'],
    filters: [
      { name: '웹 문서', extensions: ['html', 'htm', 'txt', 'pdf'] },
      { name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
      { name: '모든 파일', extensions: ['*'] },
    ],
  });
  return result.canceled || !result.filePaths[0] ? null : pathToFileURL(result.filePaths[0]).href;
});

ipcMain.on('page:print', (event, tabId: string) => {
  getWinTabManager(event.sender)?.print(tabId);
});

ipcMain.handle('page:savePdf', async (event, tabId: string) => {
  const ownerWindow = getWindowForWebContents(event.sender);
  const manager = getWinTabManager(event.sender);
  if (!ownerWindow || !manager || ownerWindow.isDestroyed()) return false;
  const result = await dialog.showSaveDialog(ownerWindow, {
    title: '페이지를 PDF로 저장',
    defaultPath: path.join(app.getPath('downloads'), 'aero-page.pdf'),
    filters: [{ name: 'PDF 문서', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return false;
  return manager.saveAsPdf(tabId, result.filePath);
});

ipcMain.handle('page:source', async (event, tabId: string) => {
  return getWinTabManager(event.sender)?.getPageSource(tabId) || null;
});

// Diagnostics
ipcMain.handle('app:getDiagnostics', () => ({
  version: app.getVersion(),
  electronVersion: process.versions.electron,
  chromiumVersion: process.versions.chrome,
  nodeVersion: process.versions.node,
  platform: process.platform,
  arch: process.arch,
}));

// External protocol open
ipcMain.on('shell:openExternal', (event, url: string) => {
  if (!url || !/^(mailto|tel|vscode|zoommtg):/i.test(url)) return;
  const ownerWindow = getWindowForWebContents(event.sender);
  const promptOptions = {
    type: 'question' as const,
    title: '외부 앱 열기',
    message: '이 링크를 외부 애플리케이션에서 열까요?',
    detail: url.slice(0, 500),
    buttons: ['취소', '열기'],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
  };
  const prompt = ownerWindow && !ownerWindow.isDestroyed()
    ? dialog.showMessageBox(ownerWindow, promptOptions)
    : dialog.showMessageBox(promptOptions);
  void prompt.then((result) => {
    if (result.response === 1) void shell.openExternal(url);
  }).catch(() => {});
});

ipcMain.on('permission:resolve', (event, requestId: string, decision: 'allow' | 'deny' | 'once') => {
  if (!requestId || !['allow', 'deny', 'once'].includes(decision)) return;
  // The prompt is rendered by the chrome renderer while the original
  // permission request belongs to a native WebContentsView. The request ID
  // is unguessable, so validate the decision in PermissionManager without
  // comparing those two different WebContents instances.
  permissionManager.resolveRequest(requestId, decision);
});

// History IPC
ipcMain.handle('history:get', (event) => (isPersistentSender(event.sender) ? dataManager.getHistory() : []));
ipcMain.on('history:add', (event, url: string, title: string) => {
  if (isPersistentSender(event.sender)) dataManager.addHistory(url, title);
});
ipcMain.on('history:clear', (event) => {
  if (isPersistentSender(event.sender)) dataManager.clearHistory();
});
ipcMain.on('history:remove', (event, id: string) => {
  if (isPersistentSender(event.sender)) dataManager.removeHistory(id);
});

// Search history is intentionally separate from browsing history. Private
// windows never reach these persistent handlers because their sender is not
// associated with a persistent session.
ipcMain.handle('search-history:get', (event) => (isPersistentSender(event.sender) ? dataManager.getSearchHistory() : []));
ipcMain.on('search-history:add', (event, query: string, engineId: string) => {
  if (isPersistentSender(event.sender)) dataManager.addSearchHistory(query, engineId);
});
ipcMain.on('search-history:remove', (event, id: string) => {
  if (isPersistentSender(event.sender)) dataManager.removeSearchHistory(id);
});
ipcMain.on('search-history:clear', (event) => {
  if (isPersistentSender(event.sender)) dataManager.clearSearchHistory();
});

// Site permission controls. Unknown permissions remain denied by default in
// PermissionManager; this API only exposes explicit per-origin decisions.
ipcMain.handle('site:getPermissions', (event, origin: string) => {
  const targetSession = getSessionForWebContents(event.sender);
  const safeOrigin = parseHttpOrigin(origin);
  if (!targetSession || !safeOrigin) return {};
  return targetSession.isPersistent()
    ? dataManager.getPermissions(safeOrigin)
    : permissionManager.getSessionPermissions(targetSession, safeOrigin);
});
ipcMain.handle('site:getAllPermissions', (event) => {
  const targetSession = getSessionForWebContents(event.sender);
  if (!targetSession) return {};
  return targetSession.isPersistent()
    ? dataManager.getAllPermissions()
    : permissionManager.getAllSessionPermissions(targetSession);
});
ipcMain.handle('site:setPermission', (event, origin: string, permission: string, decision: 'allow' | 'deny' | 'default') => {
  const targetSession = getSessionForWebContents(event.sender);
  const safeOrigin = parseHttpOrigin(origin);
  const safePermission = typeof permission === 'string' ? permission.trim().slice(0, 100) : '';
  if (!targetSession || !safeOrigin || !safePermission || !['allow', 'deny', 'default'].includes(decision)) return false;
  if (targetSession.isPersistent()) {
    if (decision === 'default') dataManager.clearPermission(safeOrigin, safePermission);
    else dataManager.setPermission(safeOrigin, safePermission, decision);
  } else if (decision === 'default') {
    permissionManager.clearSessionDecision(targetSession, safeOrigin, safePermission);
  } else {
    permissionManager.setSessionDecision(targetSession, safeOrigin, safePermission, decision);
  }
  return true;
});
ipcMain.handle('site:resetPermissions', (event, origin: string) => {
  const targetSession = getSessionForWebContents(event.sender);
  const safeOrigin = parseHttpOrigin(origin);
  if (!targetSession || !safeOrigin) return false;
  if (targetSession.isPersistent()) dataManager.clearPermissions(safeOrigin);
  else permissionManager.clearSessionPermissions(targetSession, safeOrigin);
  return true;
});

// Bookmarks IPC
ipcMain.handle('bookmarks:get', () => dataManager.getBookmarks());
ipcMain.handle('bookmarks:add', (_event, title: string, url: string) => dataManager.addBookmark(title, url));
ipcMain.handle('bookmarks:update', (_event, id: string, updates: { title?: string; url?: string }) => dataManager.updateBookmark(id, updates));
ipcMain.on('bookmarks:remove', (_event, id: string) => dataManager.removeBookmark(id));
ipcMain.handle('bookmarks:reorder', (_event, orderedIds: string[]) => dataManager.reorderBookmarks(orderedIds));

// Notes IPC
ipcMain.handle('notes:get', (event) => (isPersistentSender(event.sender) ? dataManager.getNotes() : ''));
ipcMain.on('notes:save', (event, content: string) => {
  if (isPersistentSender(event.sender)) dataManager.setNotes(content);
});

// Closed Tabs Stack IPC
ipcMain.handle('tabs:getClosed', (event) => (isPersistentSender(event.sender) ? dataManager.getClosedTabs() : []));
ipcMain.on('tabs:pushClosed', (event, tab) => {
  if (isPersistentSender(event.sender)) dataManager.pushClosedTab(tab);
});
ipcMain.handle('tabs:popClosed', (event) => (isPersistentSender(event.sender) ? dataManager.popClosedTab() : null));

// Session IPC
ipcMain.handle('session:get', (event) => (isPersistentSender(event.sender) ? dataManager.getSession() : null));
ipcMain.on('session:save', (event, tabs, activeTabId) => {
  if (isPersistentSender(event.sender)) dataManager.saveSession(tabs, activeTabId);
});
ipcMain.handle('session:getCrashRecovery', (event) => {
  if (!crashRecoveryPending || !isPersistentSender(event.sender)) return null;
  return dataManager.getSession();
});
ipcMain.handle('session:resolveCrashRecovery', (event) => {
  if (!isPersistentSender(event.sender)) return false;
  crashRecoveryPending = false;
  return true;
});

// Downloads IPC
ipcMain.handle('downloads:choosePath', async (event) => {
  const ownerWindow = getWindowForWebContents(event.sender);
  if (!ownerWindow) return null;
  const currentPath = dataManager.getSettings().downloadPath;
  const result = await dialog.showOpenDialog(ownerWindow, {
    title: '다운로드 폴더 선택',
    defaultPath: currentPath,
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0] || null;
});
ipcMain.handle('downloads:get', (event) => {
  const targetSession = getSessionForWebContents(event.sender);
  const live = downloadManager.getDownloads(targetSession || undefined);
  if (!targetSession?.isPersistent()) return live;
  const liveIds = new Set(live.map((item) => item.id));
  return [...live, ...dataManager.getDownloads().filter((item) => !liveIds.has(item.id))]
    .sort((a, b) => b.startTime - a.startTime);
});
ipcMain.on('downloads:cancel', (event, id: string) => downloadManager.cancelDownload(id, getSessionForWebContents(event.sender) || undefined));
ipcMain.on('downloads:open', (event, id: string) => downloadManager.openDownload(id, getSessionForWebContents(event.sender) || undefined));
ipcMain.on('downloads:showInFinder', (event, id: string) => downloadManager.showInFinder(id, getSessionForWebContents(event.sender) || undefined));
ipcMain.on('downloads:remove', (event, id: string) => {
  const targetSession = getSessionForWebContents(event.sender);
  if (!targetSession) return;
  downloadManager.removeFromList(id, targetSession);
  if (targetSession.isPersistent()) dataManager.removeDownloadHistory(id);
});

// AdBlock IPC
ipcMain.handle('adblock:getStats', () => ({ enabled: adBlockEnabled, blockedCount: totalBlockedCount }));
ipcMain.handle('adblock:toggle', (_event, enabled?: boolean) => {
  adBlockEnabled = typeof enabled === 'boolean' ? enabled : !adBlockEnabled;
  dataManager.updateSettings({ adBlockEnabled });
  return adBlockEnabled;
});

// Translation Engine with a bounded in-memory cache and request timeouts.
const translationCache = new Map<string, string>();
const TRANSLATION_TIMEOUT_MS = 10000;
const MAX_TRANSLATION_CACHE_ENTRIES = 500;

function translationCacheKey(text: string, targetLang: string): string {
  return `${targetLang.toLowerCase()}:${text}`;
}

function cacheTranslation(key: string, value: string) {
  translationCache.delete(key);
  translationCache.set(key, value);
  while (translationCache.size > MAX_TRANSLATION_CACHE_ENTRIES) {
    const oldestKey = translationCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    translationCache.delete(oldestKey);
  }
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRANSLATION_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw normalizeTranslationError(error);
  } finally {
    clearTimeout(timeout);
  }
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)));
}

function cleanTranslationResponse(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '')
  ).trim();
}

function logTranslationDiagnostic(error: unknown, durationMs: number) {
  const normalized = normalizeTranslationError(error);
  console.warn('[Translation]', {
    provider: 'google-mobile-web',
    code: normalized.code,
    status: normalized.status,
    durationMs,
  });
}

// This is an unofficial, keyless web endpoint. It is intentionally treated as
// best-effort only: no CAPTCHA/rate-limit evasion and no second provider are
// contacted when it fails.
async function googleMobileTranslate(text: string, targetLang: string = 'ko'): Promise<string> {
  const startedAt = Date.now();
  try {
    const url = `https://translate.google.com/m?sl=auto&tl=${targetLang}&q=${encodeURIComponent(text)}`;
    const res = await fetchWithTimeout(url, { headers: { Accept: 'text/html' } });
    if (!res.ok) {
      const code = res.status === 403 ? 'http_403' : res.status === 429 ? 'http_429' : 'http_error';
      throw new TranslationError(code, `온라인 번역 요청이 거부되었습니다 (${res.status}).`, res.status);
    }

    const html = await res.text();
    const match = html.match(/class=["'][^"']*result-container[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (!match || !match[1]) {
      throw new TranslationError('parse', '온라인 번역 응답 형식을 해석할 수 없습니다.');
    }
    const result = cleanTranslationResponse(match[1]);
    if (!result) throw new TranslationError('empty', '온라인 번역 결과가 비어 있습니다.');
    return result;
  } catch (error) {
    const normalized = normalizeTranslationError(error);
    logTranslationDiagnostic(normalized, Date.now() - startedAt);
    throw normalized;
  }
}

async function translateSingle(text: string, targetLang: string = 'ko'): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return '';

  const cacheKey = translationCacheKey(trimmed, targetLang);
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey)!;
  }

  const result = await googleMobileTranslate(trimmed, targetLang);
  cacheTranslation(cacheKey, result);
  return result;
}

function chunkTranslationRequests(items: { index: number; text: string }[]) {
  const delimiter = ' ||| ';
  const chunks: { index: number; text: string }[][] = [];
  let current: { index: number; text: string }[] = [];
  let currentChars = 0;

  for (const item of items) {
    const hasDelimiterCollision = item.text.includes(delimiter);
    const nextChars = currentChars + (current.length > 0 ? delimiter.length : 0) + item.text.length;
    if (
      current.length > 0 &&
      (current.length >= TRANSLATION_LIMITS.maxTextsPerRequest || nextChars > TRANSLATION_LIMITS.maxRequestChars || hasDelimiterCollision)
    ) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }

    if (hasDelimiterCollision) {
      chunks.push([item]);
      continue;
    }

    current.push(item);
    currentChars += (current.length > 1 ? delimiter.length : 0) + item.text.length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function translateBatchWithGoogle(texts: string[], targetLang: string = 'ko'): Promise<string[]> {
  const results: string[] = new Array(texts.length).fill('');
  const toTranslate: { index: number; text: string }[] = [];

  for (let i = 0; i < texts.length; i++) {
    const t = texts[i].trim();
    if (!t) {
      results[i] = '';
    } else if (translationCache.has(translationCacheKey(t, targetLang))) {
      results[i] = translationCache.get(translationCacheKey(t, targetLang))!;
    } else {
      toTranslate.push({ index: i, text: t });
    }
  }

  if (toTranslate.length === 0) return results;

  const delimiter = ' ||| ';
  const chunks = chunkTranslationRequests(toTranslate);

  for (let offset = 0; offset < chunks.length; offset += TRANSLATION_LIMITS.maxConcurrentRequests) {
    const group = chunks.slice(offset, offset + TRANSLATION_LIMITS.maxConcurrentRequests);
    const translatedGroup = await Promise.all(group.map(async (chunk) => {
      if (chunk.length === 1) return [await translateSingle(chunk[0].text, targetLang)];

      const raw = await googleMobileTranslate(chunk.map((item) => item.text).join(delimiter), targetLang);
      const parts = raw.split(/\s*\|\|\|\s*/).map((part) => part.trim());
      if (parts.length !== chunk.length || parts.some((part) => !part)) {
        throw new TranslationError('parse', '온라인 번역 응답의 문장 수가 일치하지 않습니다.');
      }
      return parts;
    }));

    for (let i = 0; i < group.length; i++) {
      for (let j = 0; j < group[i].length; j++) {
        const item = group[i][j];
        const translated = translatedGroup[i][j];
        results[item.index] = translated;
        cacheTranslation(translationCacheKey(item.text, targetLang), translated);
      }
    }
  }

  return results;
}

ipcMain.handle('translate:text', async (_event, text: string, targetLang?: string) => {
  return await translateSingle(text, targetLang || 'ko');
});

ipcMain.handle('translate:batch', async (_event, texts: string[], targetLang?: string) => {
  return await translateBatchWithGoogle(texts, targetLang || 'ko');
});

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const activeWin = BrowserWindow.getFocusedWindow() || mainWindow;
    if (activeWin) {
      if (activeWin.isMinimized()) activeWin.restore();
      activeWin.focus();
      const url = commandLine.find(isBrowserUrl);
      if (url) openUrlInActiveWindow(url);
    }
  });

  // macOS delivers default-browser URLs through open-url rather than argv.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    openUrlInActiveWindow(url);
  });
}

app.whenReady().then(() => {
  if (!gotTheLock) return;
  dataManager.markRunStarted();
  updateManager.initialize();
  setupApplicationMenu();
  const initialUrl = pendingOpenUrl || process.argv.find(isBrowserUrl);
  pendingOpenUrl = null;
  createWindow(initialUrl ? { initialUrl } : undefined);

  if (app.isPackaged) {
    setTimeout(() => void updateManager.checkForUpdates(), 3000);
  }

  if (process.env.AERO_DEBUG_SERVER === 'true') {
    const debugServer = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1:29999');
      if (parsedUrl.pathname === '/translate-now') {
        mainWindow?.webContents.send('tab:translate-active');
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    debugServer.listen(29999, '127.0.0.1');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  if (gotTheLock) dataManager.markCleanExit();
});

app.on('window-all-closed', () => {
  dataManager.flushSync();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
