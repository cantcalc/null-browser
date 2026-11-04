import { app, BrowserWindow, ipcMain, session, Menu, shell, clipboard, ClipboardItem, dialog, protocol } from 'electron';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { pathToFileURL } from 'url';
import { DataManager } from './DataManager';
import { DownloadManager } from './DownloadManager';
import { PermissionManager } from './PermissionManager';
import { TabManager } from './TabManager';
import { ClearDataOptions, Workspace } from './types';
import { clearOriginStorage } from './siteData';
import { UpdateManager } from './Updater';
import { ExtensionManager } from './ExtensionManager';
import { CookiePolicyManager } from './CookiePolicyManager';
import { WorkspaceSessions } from './WorkspaceSessions';
import { ElectronChromeExtensions, setSessionPartitionResolver } from 'electron-chrome-extensions';
import { hasExtensionCaptureGrant } from './ExtensionCompatibility';
import { PRODUCT_NAME, PROFILE_DIRECTORY, STORAGE_APPLICATION_NAME } from '../shared/brand';
import type { AIService, AIHost } from './ai/AIService';
import type { AICommand } from '../shared/ai';
import { parseNavigationInput } from '../src/utils/navigationParser';

// Product branding may change; the established profile/partitions must not.
// Explicit QA/CLI profiles always win and never touch the user's real data.
app.setPath('userData', app.commandLine.getSwitchValue('user-data-dir') || path.join(app.getPath('appData'), PROFILE_DIRECTORY));
// Electron 45 initializes OSCrypt before ready using app.name. Retain the
// previous storage identity at that stage, then expose the new product name.
app.setName(process.platform === 'win32' ? PRODUCT_NAME : STORAGE_APPLICATION_NAME);

// Horizontal history navigation is implemented by NULL's gesture bridge.
// Disable Chromium's native overscroll history animation so it cannot flash
// the WebContentsView while the browser performs the same navigation.
app.commandLine.appendSwitch('disable-features', 'OverscrollHistoryNavigation');
protocol.registerSchemesAsPrivileged([{ scheme: 'crx', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let mainWindow: BrowserWindow | null = null;
const allWindows: Set<BrowserWindow> = new Set();
const windowTabManagers: Map<BrowserWindow, TabManager> = new Map();
const dataManager = new DataManager();
const downloadManager = new DownloadManager();
const permissionManager = new PermissionManager(dataManager);
const updateManager = new UpdateManager();
const extensionManager = new ExtensionManager(contents => {
  const owner = getWindowForWebContents(contents);
  return Boolean(owner && windowTabManagers.get(owner)?.ownsWebContents(contents));
});
const downloadSessions = new WeakSet<Electron.Session>();
const cookiePolicyManager = new CookiePolicyManager(dataManager.getSettings());
const gestureNavigationTimes = new WeakMap<Electron.WebContents, number>();
const preparedSessions = new WeakSet<Electron.Session>();
const workspaceSessions = new WorkspaceSessions(prepareSession, dataManager.getLegacySessionWorkspaceId());
let pendingOpenUrl: string | null = null;
let crashRecoveryPending = dataManager.didPreviousRunCrash();
let aiService: AIService | undefined;
let aiLoading: Promise<AIService> | undefined;
function getAIService() {
  return aiLoading ||= Promise.all([import('./ai/AIService'), import('./ai/Vault')]).then(([service, vault]) => {
    aiService = new service.AIService(new vault.AIVault(path.join(app.getPath('userData'), 'null-ai-vault.json')));
    return aiService;
  });
}
function aiHost(win: BrowserWindow, workspaceId?: string): AIHost {
  const manager = windowTabManagers.get(win)!;
  return { win, manager, workspaceId: workspaceId || manager.getActiveWorkspaceId(), searchURL: query => parseNavigationInput(query, dataManager.getSettings()).url };
}

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
  const sessions = new Set<Electron.Session>(workspaceSessions.all());
  for (const manager of windowTabManagers.values()) sessions.add(manager.getSession());
  for (const targetSession of sessions) applySessionPreferences(targetSession);
}

function createWindow(options?: { isIncognito?: boolean; initialUrl?: string; workspaceId?: string }) {
  const isIncognito = options?.isIncognito ?? false;
  const requestedUrl = options?.initialUrl;
  const isExtensionPage = !isIncognito && typeof requestedUrl === 'string' && (() => {
    try {
      const parsed = new URL(requestedUrl);
      return parsed.protocol === 'chrome-extension:' && Boolean(session.defaultSession.extensions.getExtension(parsed.hostname));
    } catch { return false; }
  })();
  const initialUrl = requestedUrl && (isBrowserUrl(requestedUrl) || isExtensionPage) ? requestedUrl : undefined;
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

  const tabManager = new TabManager(win, ses, isIncognito ? undefined : extensionManager.runtime,
    isIncognito ? undefined : (id) => workspaceSessions.get(id),
    isIncognito ? undefined : async (target) => {
      await initializeExtensionsForSession(target);
      return ElectronChromeExtensions.fromSession(target);
    });
  windowTabManagers.set(win, tabManager);
  if (!isIncognito) tabManager.onAISelection = (tabId, text, intent, sourceURL) => {
    const wc = tabManager.getTabWebContents(tabId);
    if (!wc || wc.isDestroyed() || wc.getURL() !== sourceURL) return;
    void getAIService().then(service => service.selection(aiHost(win, tabManager.getWorkspaceId(wc)), tabId, text, intent)).catch(() => {});
  };
  updateManager.attachWindow(win);

  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = win;
  }
  allWindows.add(win);
  const syncWindowMenu = () => {
    const menu = Menu.getApplicationMenu();
    for (const id of ['null-preferences', 'null-about']) {
      const item = menu?.getMenuItemById(id);
      if (item) item.enabled = !isIncognito;
    }
  };
  win.on('focus', syncWindowMenu);
  if (win.isFocused()) syncWindowMenu();
  // Tell the chrome renderer to report its viewport immediately. Its frame
  // observers may be throttled while a native guest owns focus. Coalesce resize
  // events in one main-loop turn rather than introducing a polling timer.
  let resizePending = false;
  const reportWindowResize = () => {
    if (resizePending) return;
    resizePending = true;
    setImmediate(() => {
      resizePending = false;
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('window:resized');
    });
  };
  win.on('resize', reportWindowResize);
  win.on('enter-full-screen', reportWindowResize);
  win.on('leave-full-screen', reportWindowResize);

  prepareSession(ses);

  // Keep all external navigation inside a managed tab. This prevents a
  // popup from escaping the selected session (especially from incognito).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (win && !win.isDestroyed() && (isBrowserUrl(url) || /^(mailto|tel|vscode|zoommtg):/i.test(url))) {
      win.webContents.send('tab:open-external', url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('console-message', (event) => {
    console.log(`[Renderer] [${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
  });

  const isDev = process.env.NODE_ENV === 'development';
  const distPath = path.join(__dirname, '../dist/index.html');
  const query = new URLSearchParams();
  if (isIncognito) query.set('incognito', '1');
  if (initialUrl) query.set('initialUrl', initialUrl);
  if (options?.workspaceId) query.set('workspaceId', options.workspaceId);
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
    aiService?.detach(win.id);
    const tm = windowTabManagers.get(win);
    if (tm) {
      tm.destroyAll();
      windowTabManagers.delete(win);
    }
    updateManager.detachWindow(win);
    if (!ses.isPersistent()) downloadManager.removeSession(ses);
    allWindows.delete(win);
    if (isIncognito) {
      cookiePolicyManager.detach(ses);
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

function prepareSession(ses: Electron.Session) {
  if (preparedSessions.has(ses)) return;
  preparedSessions.add(ses);
  applySessionPreferences(ses);
  cookiePolicyManager.attach(ses);
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const securityOrigin = (details as Electron.PermissionRequest & { securityOrigin?: string }).securityOrigin;
    if (permission === 'display-capture' && securityOrigin?.startsWith('chrome-extension://')) {
      return callback(hasExtensionCaptureGrant(contents, permission, securityOrigin));
    }
    if (hasExtensionCaptureGrant(contents, permission, securityOrigin)) return callback(true);
    permissionManager.handlePermissionRequest(contents, permission, callback, details, request => {
      const owner = getWindowForWebContents(contents);
      if (owner && !owner.isDestroyed()) owner.webContents.send('permission:request', request);
      else permissionManager.resolveRequest(request.requestId, 'deny');
    });
  });
  ses.setPermissionCheckHandler((contents, permission, origin, details) =>
    hasExtensionCaptureGrant(contents, permission, origin) || permissionManager.handlePermissionCheck(contents, permission, origin, details));
  if (downloadSessions.has(ses)) return;
  downloadSessions.add(ses);
  ses.on('will-download', (event, item, contents) => {
    const preferences = dataManager.getSettings();
    downloadManager.handleWillDownload(event, item, contents, getWindowForWebContents(contents), {
      downloadPath: preferences.downloadPath, askDownloadLocation: preferences.askDownloadLocation,
      onUpdate: info => { if (ses.isPersistent()) dataManager.upsertDownload(info); },
    });
  });
}

// Native macOS Application Menu
function setupApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const getActiveWin = () => BrowserWindow.getFocusedWindow() || mainWindow;

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'NULL',
            submenu: [
              {
                id: 'null-about',
                label: 'NULL 정보',
                click: () => getActiveWin()?.webContents.send('menu:open-about'),
              },
              { type: 'separator' as const },
              {
                id: 'null-preferences',
                label: '환경설정...',
                accelerator: 'CmdOrCtrl+,',
                click: () => getActiveWin()?.webContents.send('menu:open-settings'),
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const, label: 'NULL 숨기기' },
              { role: 'hideOthers' as const, label: '기타 숨기기' },
              { role: 'unhide' as const, label: '모두 표시' },
              { type: 'separator' as const },
              { role: 'quit' as const, label: 'NULL 종료' },
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

function isNormalChromeSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  const win = BrowserWindow.fromWebContents(event.sender);
  return Boolean(win && windowTabManagers.has(win) && win.webContents === event.sender &&
    event.senderFrame === event.sender.mainFrame && event.sender.session === session.defaultSession);
}

// Only the exact, top-level browser chrome gets the AI capability. Guests,
// extension pages, private windows and chrome subframes cannot reach the vault.
ipcMain.handle('ai:command', async (event, command: AICommand, expectedWorkspaceId?: string) => {
  if (!isNormalChromeSender(event)) return { ok: false, error: '일반 브라우저 창에서만 AI를 사용할 수 있습니다.' };
  const win = BrowserWindow.fromWebContents(event.sender)!;
  const url = new URL(event.sender.getURL());
  const isLocal = url.protocol === 'file:' && decodeURIComponent(url.pathname) === path.resolve(__dirname, '../dist/index.html');
  const dev = process.env.NODE_ENV === 'development' && url.origin === new URL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173').origin && url.pathname === '/';
  if (!isLocal && !dev) return { ok: false, error: '신뢰할 수 없는 AI 호출입니다.' };
  const host = aiHost(win);
  if (expectedWorkspaceId !== undefined && expectedWorkspaceId !== host.workspaceId) return { ok: false, error: '워크스페이스가 변경되었습니다. 다시 시도해 주세요.' };
  try { return await (await getAIService()).command(host, command); }
  catch { return { ok: false, error: 'AI 저장소 또는 서비스에 접근하지 못했습니다. 암호화 저장소 상태를 확인해 주세요.' }; }
});
app.on('before-quit', () => aiService?.dispose());

ipcMain.handle('extensions:list', (event) => isNormalChromeSender(event) ? extensionManager.list() : []);
ipcMain.handle('extensions:install', async (event) => {
  if (!isNormalChromeSender(event)) return { ok: false, error: '일반 창에서 확장 프로그램을 설치해 주세요.' };
  const ownerWindow = getWindowForWebContents(event.sender);
  const dialogOptions: Electron.OpenDialogOptions = {
    title: 'Chrome 확장 프로그램 폴더 선택',
    properties: ['openDirectory'],
    message: 'manifest.json이 들어 있는 압축 해제된 확장 프로그램 폴더를 선택하세요.',
  };
  const result = ownerWindow
    ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, error: 'cancelled' };
  }

  try {
    const extension = await extensionManager.install(result.filePaths[0]);
    return { ok: true, extension };
  } catch (error) {
    const message = error instanceof Error ? error.message : '확장 프로그램을 설치하지 못했습니다.';
    console.error('[extensions] Install failed:', error);
    return { ok: false, error: message };
  }
});
ipcMain.handle('extensions:remove', (event, extensionId: string) =>
  isNormalChromeSender(event) && typeof extensionId === 'string' ? extensionManager.remove(extensionId) : false);
ipcMain.on('extensions:open-store', (event) => {
  if (isNormalChromeSender(event)) event.sender.send('tab:open-external', 'https://chromewebstore.google.com/');
});

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
  const manager = getWinTabManager(sender);
  if (!manager) return null;
  return manager.ownsWebContents(sender) ? sender.session : manager.getActiveSession();
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

ipcMain.on('tab:create', (event, { id, url, workspaceId, deferLoad }) => {
  const manager = getWinTabManager(event.sender);
  if (!manager || !BrowserWindow.fromWebContents(event.sender)) return;
  const known = dataManager.getWorkspaces().workspaces;
  if (manager.getSession().isPersistent() && typeof workspaceId === 'string' && !known.some(item => item.id === workspaceId)) {
    console.warn('[workspace] Refused tab with unknown workspace');
    return;
  }
  const target = known.some(item => item.id === workspaceId) ? workspaceId : manager.getActiveWorkspaceId();
  manager.createTab(id, url, !manager.getSession().isPersistent(), target, { deferLoad: deferLoad === true });
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
ipcMain.on('tab:guest-gesture', (event, action: string, source: string) => {
  if (action !== 'back' && action !== 'forward') return;
  if (source !== 'wheel' && source !== 'button') return;
  if (event.senderFrame !== event.sender.mainFrame) return;
  const win = getWindowForWebContents(event.sender);
  const manager = win && windowTabManagers.get(win);
  const state = manager?.getGuestGestureState(event.sender);
  if (!state) return;
  const accepted = action === 'back' ? state.canGoBack : state.canGoForward;
  // Chromium already handles native mouse back/forward buttons. Observing
  // them is only for the edge cue; navigating here too skips two entries.
  if (source === 'button') {
    event.sender.send('tab:gesture-feedback', { action, accepted });
    return;
  }
  // The old page's wheel momentum can continue after a navigation. The main
  // process cooldown survives document/preload replacement, unlike guest state.
  const now = performance.now();
  if (accepted && now - (gestureNavigationTimes.get(event.sender) ?? -Infinity) < 650) return;
  event.sender.send('tab:gesture-feedback', { action, accepted });
  if (accepted) {
    gestureNavigationTimes.set(event.sender, now);
    // Navigate the already-validated source view directly. A React renderer
    // round trip must not delay a gesture or move focus to the wrong split pane.
    if (action === 'back') manager!.goBack(state.id);
    else manager!.goForward(state.id);
  }
});

ipcMain.on('tab:guest-open-newtab', (event, url: string) => {
  const win = getWindowForWebContents(event.sender);
  if (win && isBrowserUrl(url)) win.webContents.send('tab:open-external', url);
});

// Settings & Preferences IPC
ipcMain.handle('settings:get', () => dataManager.getSettings());
ipcMain.handle('settings:update', (_e, updates) => {
  const settings = dataManager.updateSettings(updates);
  cookiePolicyManager.update(settings);
  if (updates?.preferredLanguages || typeof updates?.spellCheckEnabled === 'boolean') applyPreferencesToOpenSessions();
  return settings;
});
ipcMain.handle('settings:reset', () => {
  const settings = dataManager.resetSettings();
  cookiePolicyManager.update(settings);
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
  if (imported) {
    cookiePolicyManager.update(dataManager.getSettings());
    applyPreferencesToOpenSessions();
  }
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
    downloadManager.clearHistory(isPersistentSession ? undefined : targetSession, cutoff, isPersistentSession);
    event.sender.send('downloads:cleared', cutoff);
  }
  if (safeOptions.cache) {
    await targetSession.clearCache();
  }
  if (safeOptions.cookies) {
    await targetSession.clearStorageData({
      storages: ['cookies', 'localstorage', 'serviceworkers', 'cachestorage', 'indexdb', 'filesystem'],
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
  const targetSession = getSessionForWebContents(event.sender);
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
ipcMain.on('window:newWindow', (event, url?: string) => createWindow({ initialUrl: url, workspaceId: getWinTabManager(event.sender)?.getActiveWorkspaceId() }));
ipcMain.on('window:newPrivateWindow', (_e, url?: string) => createWindow({ isIncognito: true, initialUrl: url }));
ipcMain.handle('page:captureVisible', async (event) => {
  const ownerWindow = getWindowForWebContents(event.sender);
  if (!ownerWindow || ownerWindow.isDestroyed()) return null;
  try {
    const img = await ownerWindow.capturePage();
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Uint8Array.from(img.toPNG())], { type: 'image/png' }) })]);
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
    defaultPath: path.join(app.getPath('downloads'), 'null-page.pdf'),
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
  if (!targetSession) return [];
  const live = downloadManager.getDownloads(targetSession.isPersistent() ? undefined : targetSession, targetSession.isPersistent());
  if (!targetSession?.isPersistent()) return live;
  const liveIds = new Set(live.map((item) => item.id));
  return [...live, ...dataManager.getDownloads().filter((item) => !liveIds.has(item.id))]
    .sort((a, b) => b.startTime - a.startTime);
});
function downloadSessionForSender(sender: Electron.WebContents, id: string): Electron.Session | null {
  const caller = getSessionForWebContents(sender);
  const owner = downloadManager.getDownloadSession(id);
  return caller?.isPersistent() && owner?.isPersistent() ? owner : caller;
}
ipcMain.on('downloads:cancel', (event, id: string) => { const ses = downloadSessionForSender(event.sender, id); if (ses) downloadManager.cancelDownload(id, ses); });
function savedDownloadForSender(sender: Electron.WebContents, id: string) {
  // Renderer input is only an ID. Resolve paths from our own normal-profile
  // history; a private window must never read or open those records.
  return typeof id === 'string' && getSessionForWebContents(sender)?.isPersistent()
    ? dataManager.getDownloads().find(item => item.id === id) : undefined;
}
ipcMain.on('downloads:open', (event, id: string) => {
  const ses = downloadSessionForSender(event.sender, id);
  if (!ses) return;
  if (downloadManager.getDownloadSession(id)) downloadManager.openDownload(id, ses);
  else { const saved = savedDownloadForSender(event.sender, id); if (saved?.state === 'completed' && saved.savePath) void shell.openPath(saved.savePath); }
});
ipcMain.on('downloads:showInFinder', (event, id: string) => {
  const ses = downloadSessionForSender(event.sender, id);
  if (!ses) return;
  if (downloadManager.getDownloadSession(id)) downloadManager.showInFinder(id, ses);
  else { const saved = savedDownloadForSender(event.sender, id); if (saved?.savePath) shell.showItemInFolder(saved.savePath); }
});
ipcMain.on('downloads:remove', (event, id: string) => {
  const targetSession = downloadSessionForSender(event.sender, id);
  if (!targetSession) return;
  downloadManager.removeFromList(id, targetSession);
  if (targetSession.isPersistent()) dataManager.removeDownloadHistory(id);
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

function initializeExtensionsForSession(targetSession: Electron.Session): Promise<void> {
  return extensionManager.initialize({
    createTab: async (details) => {
      const win = (typeof details.windowId === 'number' ? BrowserWindow.fromId(details.windowId) : null) ||
        BrowserWindow.getFocusedWindow() || mainWindow;
      const manager = win && windowTabManagers.get(win);
      if (!win || !manager || manager.getSession() !== session.defaultSession) {
        throw new Error('확장 프로그램은 일반 NULL 창에서만 새 탭을 열 수 있습니다.');
      }
      const id = `tab-${randomUUID()}`;
      const url = details.url || 'null://newtab';
      const workspaceId = workspaceSessions.idFor(targetSession) || 'workspace-default';
      if (!dataManager.getWorkspaces().workspaces.some(item => item.id === workspaceId)) throw new Error('워크스페이스가 더 이상 존재하지 않습니다.');
      manager.createTab(id, url, false, workspaceId);
      const contents = manager.getTabWebContents(id);
      if (!contents) throw new Error('확장 프로그램 탭을 만들지 못했습니다.');
      if (details.active !== false) manager.switchTab(id);
      win.webContents.send('tab:extension-created', { id, url, active: details.active !== false, workspaceId });
      return [contents, win];
    },
    selectTab: (contents, win) => {
      const manager = windowTabManagers.get(win as BrowserWindow);
      if (manager?.isRegisteringExtensionTab()) return;
      const id = manager?.getTabId(contents);
      if (id && manager?.getActiveTabId() !== id) {
        manager?.switchTab(id);
        (win as BrowserWindow).webContents.send('tab:extension-selected', id);
      }
    },
    removeTab: (contents, win) => {
      const manager = windowTabManagers.get(win as BrowserWindow);
      const id = manager?.getTabId(contents);
      if (id) {
        manager?.closeTab(id);
        (win as BrowserWindow).webContents.send('tab:extension-closed', id);
      }
    },
    createWindow: async (details) => {
      if (details.incognito) throw new Error('확장 프로그램에서는 시크릿 창을 만들 수 없습니다.');
      return createWindow({ initialUrl: typeof details.url === 'string' ? details.url : details.url?.[0], workspaceId: workspaceSessions.idFor(targetSession) });
    },
    removeWindow: (win) => { win.close(); },
    requestPermissions: async (extension, permissions) => {
      const { response } = await dialog.showMessageBox({
        type: 'question', title: '확장 프로그램 권한',
        message: `${extension.name}의 추가 권한을 허용할까요?`,
        detail: [...(permissions.permissions || []), ...(permissions.origins || [])].join('\n'),
        buttons: ['취소', '허용'], defaultId: 0, cancelId: 0, noLink: true,
      });
      return response === 1;
    },
  }, targetSession);
}

app.whenReady().then(async () => {
  app.setName(PRODUCT_NAME);
  if (!gotTheLock) return;
  dataManager.markRunStarted();
  updateManager.initialize();
  prepareSession(session.defaultSession);
  setSessionPartitionResolver(token => {
    if (!token.startsWith('workspace:')) throw new Error('Unknown workspace session');
    const id = token.slice('workspace:'.length);
    if (!dataManager.getWorkspaces().workspaces.some(item => item.id === id)) throw new Error('Unknown workspace');
    return workspaceSessions.get(id);
  });
  await initializeExtensionsForSession(session.defaultSession);
  extensionManager.onChanged(() => {
    for (const [win, manager] of windowTabManagers) {
      if (!win.isDestroyed() && manager.getSession() === session.defaultSession) win.webContents.send('extensions:changed');
    }
  });
  setupApplicationMenu();
  const initialUrl = pendingOpenUrl || process.argv.find(isBrowserUrl);
  pendingOpenUrl = null;
  createWindow(initialUrl ? { initialUrl } : undefined);

  if (app.isPackaged) {
    setTimeout(() => void updateManager.checkForUpdates(), 3000);
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
