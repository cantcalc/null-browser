const { app, BrowserWindow, session, Menu } = require('electron');
const { spawn } = require('child_process');
const { buildSync } = require('esbuild');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-full-runtime-'));
const userDataDir = path.join(runtimeDir, 'profile');
const downloadDir = path.join(runtimeDir, 'downloads');
fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(downloadDir, { recursive: true });
app.setPath('userData', userDataDir);
// The harness uses hidden windows. Keep the Electron event loop alive when a
// fixture window is destroyed between test groups.
app.on('window-all-closed', (event) => event.preventDefault());

function compile(entryPoint, name) {
  const outfile = path.join(runtimeDir, name);
  buildSync({ absWorkingDir: projectRoot, entryPoints: [entryPoint], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile });
  return outfile;
}

const DataManager = require(compile('electron/DataManager.ts', 'DataManager.cjs')).DataManager;
const PermissionManager = require(compile('electron/PermissionManager.ts', 'PermissionManager.cjs')).PermissionManager;
const DownloadManager = require(compile('electron/DownloadManager.ts', 'DownloadManager.cjs')).DownloadManager;
const tabManagerPath = compile('electron/TabManager.ts', 'TabManager.cjs');
compile('electron/guestPreload.ts', 'guestPreload.js');
const TabManager = require(tabManagerPath).TabManager;

const results = { data: {}, permissions: {}, tabs: {}, downloads: {}, externalSites: [], memory: {} };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, message, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) { if (await predicate()) return; await delay(25); }
  throw new Error(`Timed out: ${message}`);
}

async function createFixtureServer() {
  const timers = new Set();
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/download') {
      const body = Buffer.alloc(128 * 1024, 0x61);
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="null-qa.bin"', 'content-length': String(body.length) });
      response.end(body); return;
    }
    if (url.pathname === '/slow-download') {
      const total = 8 * 1024 * 1024; let sent = 0;
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="null-cancel.bin"', 'content-length': String(total) });
      const timer = setInterval(() => {
        if (response.destroyed || sent >= total) { clearInterval(timer); timers.delete(timer); if (!response.destroyed) response.end(); return; }
        const chunk = Buffer.alloc(Math.min(64 * 1024, total - sent), 0x62); sent += chunk.length; response.write(chunk);
      }, 15);
      timers.add(timer); response.on('close', () => { clearInterval(timer); timers.delete(timer); }); return;
    }
    if (url.pathname === '/interrupted-download') {
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="null-interrupted.bin"', 'content-length': String(1024 * 1024) });
      response.write(Buffer.alloc(16 * 1024, 0x63)); setTimeout(() => response.destroy(), 20); return;
    }
    const pages = {
      '/one': ['One', '<h1>Alpha navigation page</h1><a id="next" href="/two">Next</a>'],
      '/two': ['Two', '<h1>Beta navigation page</h1><a href="/one">Previous</a>'],
      '/popup': ['Popup', '<a id="popup" target="_blank" href="/two">Open tab</a>'],
    };
    const [title, body] = pages[url.pathname] || ['Fixture', '<h1>NULL runtime fixture</h1>'];
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': 'null_fixture=1; Path=/; SameSite=Lax' });
    response.end(`<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  return { origin: `http://127.0.0.1:${address.port}`, close: () => new Promise((resolve, reject) => { for (const timer of timers) clearInterval(timer); server.close((error) => error ? reject(error) : resolve()); }) };
}

function testData() {
  const manager = new DataManager();
  const retired = ['adBlockEnabled', 'siteTranslation', 'accentColor', 'newTabConfig'];
  manager.updateSettings({ adBlockEnabled: true, siteTranslation: { 'https://example.com': 'always' } });
  assert(retired.every(key => !(key in manager.getSettings())), 'retired settings survived update');
  const legacyImport = { settings: { ...manager.getSettings(), adBlockEnabled: true, siteTranslation: { 'https://example.com': 'always' } } };
  assert(manager.importSettingsJson(JSON.stringify(legacyImport)), 'legacy settings import failed');
  assert(retired.every(key => !(key in JSON.parse(manager.exportSettingsJson()).settings)), 'retired settings survived import/export');
  assert(manager.getWorkspaces().workspaces[0].name === 'work', 'default workspace is not work');
  manager.updateSettings({ firstRunCompleted: true, theme: 'graphite' });
  manager.saveWorkspaces([{ id: 'workspace-default', name: 'work', color: '#3b82f6' }, { id: 'workspace-qa', name: 'QA', color: '#10b981' }], 'workspace-qa');
  manager.saveWorkspaces([{ id: 'workspace-default', name: 'work', color: '#3b82f6' }, { id: 'workspace-qa', name: 'QA Renamed', color: '#10b981' }], 'workspace-qa');
  manager.clearHistory(); manager.clearSearchHistory();
  manager.addHistory('https://example.com/qa', 'QA history'); manager.addSearchHistory('null qa search', 'google');
  assert(manager.getHistory().length === 1 && manager.getSearchHistory().length === 1, 'history add failed');
  manager.updateSettings({ saveBrowsingHistory: false, saveSearchHistory: false });
  manager.addHistory('https://example.com/blocked', 'Blocked'); manager.addSearchHistory('blocked search', 'google');
  assert(manager.getHistory().length === 1 && manager.getSearchHistory().length === 1, 'history OFF failed');
  manager.updateSettings({ saveBrowsingHistory: true, saveSearchHistory: true });
  const one = manager.addBookmark('QA One', 'https://example.com/one'); const two = manager.addBookmark('QA Two', 'https://example.com/two');
  assert(manager.updateBookmark(one.id, { title: 'QA One Edited' }).title === 'QA One Edited', 'bookmark edit failed');
  manager.reorderBookmarks([one.id, two.id]); assert(manager.getBookmarks()[0].id === one.id, 'bookmark reorder failed');
  assert(manager.exportBookmarksHtml().includes('QA One Edited'), 'bookmark export failed');
  assert(manager.importBookmarksHtml('<A HREF="https://example.net/imported">Imported</A><A HREF="javascript:bad">Unsafe</A>') === 1, 'bookmark import validation failed');
  manager.removeBookmark(two.id); assert(!manager.getBookmarks().some((item) => item.id === two.id), 'bookmark remove failed');
  const fav = manager.addFavorite({ title: 'QA Favorite', url: 'https://example.org/favorite' }); manager.updateFavorite(fav.id, { title: 'QA Favorite Edited' });
  assert(manager.getFavorites().some((item) => item.id === fav.id && item.title === 'QA Favorite Edited'), 'favorite edit failed'); manager.removeFavorite(fav.id);
  manager.setNotes('QA persistent note'); manager.pushClosedTab({ url: 'https://example.com/closed', title: 'Closed', closedAt: Date.now() }); assert(manager.popClosedTab(), 'closed tab failed');
  manager.saveSession([{ id: 'tab-qa-1', url: 'https://example.com/one', title: 'One', pinned: true, workspaceId: 'workspace-qa' }], 'tab-qa-1');
  manager.setSiteZoom('https://example.com/path', 1.4); manager.setPermission('https://example.com', 'notifications', 'allow');
  const retained = path.join(downloadDir, 'retained.bin'); fs.writeFileSync(retained, 'keep');
  manager.upsertDownload({ id: 'download-history-qa', filename: 'retained.bin', totalBytes: 4, receivedBytes: 4, state: 'completed', savePath: retained, startTime: Date.now(), sourceUrl: 'https://example.com/file', sourceHostname: 'example.com' });
  manager.removeDownloadHistory('download-history-qa'); assert(fs.existsSync(retained), 'download history removal deleted file');
  manager.flushSync();
  const restored = new DataManager();
  assert(retired.every(key => !(key in restored.getSettings())), 'retired settings returned on restart');
  assert(restored.getSettings().theme === 'noir', 'legacy dark theme migration/restart failed'); assert(restored.getWorkspaces().activeWorkspaceId === 'workspace-qa', 'workspace restart failed');
  assert(restored.getWorkspaces().workspaces.some((item) => item.name === 'QA Renamed'), 'workspace rename restart failed');
  assert(restored.getHistory().length === 1 && restored.getSearchHistory().length === 1, 'history restart failed'); assert(restored.getNotes() === 'QA persistent note', 'notes restart failed');
  assert(restored.getSession().activeTabId === 'tab-qa-1', 'session restart failed'); assert(restored.getSiteZoom('https://example.com/anything') === 1.4, 'site zoom restart failed');
  assert(restored.getPermission('https://example.com', 'notifications') === 'allow', 'permission restart failed');
  restored.saveWorkspaces([{ id: 'workspace-default', name: 'work', color: '#3b82f6' }], 'workspace-default'); restored.clearHistory(); restored.clearSearchHistory(); restored.flushSync();
  const afterDelete = new DataManager(); assert(afterDelete.getWorkspaces().workspaces.length === 1 && afterDelete.getHistory().length === 0, 'delete/restart failed');
  afterDelete.markRunStarted(); const crashed = new DataManager(); assert(crashed.didPreviousRunCrash(), 'crash marker failed'); crashed.markCleanExit();
  results.data = { legacyFeatureSettingsRemoved: true, workspaceCrudRestart: true, historyTogglesDeleteRestart: true, bookmarksCrudReorderImportExport: true, favoritesCrud: true, notesClosedTabs: true, sessionZoomPermissionRestart: true, crashMarker: true, removeDownloadKeepsFile: true };
  return crashed;
}

async function testPermissions(dataManager, origin) {
  const manager = new PermissionManager(dataManager);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const normalSession = session.fromPartition(`persist:null-permission-${suffix}`);
  const privateSession = session.fromPartition(`null-permission-private-${suffix}`);
  const normalWindow = new BrowserWindow({ show: false, webPreferences: { session: normalSession, sandbox: true } });
  const privateWindow = new BrowserWindow({ show: false, webPreferences: { session: privateSession, sandbox: true } });
  try {
    await Promise.all([normalWindow.loadURL(origin), privateWindow.loadURL(origin)]);
    const request = (window, permission, decision) => new Promise((resolve, reject) => {
      let prompted = false;
      manager.handlePermissionRequest(window.webContents, permission, (granted) => resolve({ granted, prompted }), { requestingUrl: `${origin}/permission` }, (prompt) => {
        prompted = true;
        if (!manager.resolveRequest(prompt.requestId, decision)) reject(new Error('permission prompt did not resolve'));
      });
    });
    const normal = await request(normalWindow, 'notifications', 'allow');
    assert(normal.granted && normal.prompted, 'persistent permission allow failed');
    assert(dataManager.getPermission(origin, 'notifications') === 'allow', 'persistent permission not stored');
    assert(manager.handlePermissionCheck(normalWindow.webContents, 'notifications', origin), 'persistent permission check failed');
    const privateAllow = await request(privateWindow, 'geolocation', 'allow');
    assert(privateAllow.granted, 'private permission allow failed');
    assert(manager.getSessionPermissions(privateSession, origin).geolocation === 'allow', 'private permission not isolated');
    assert(dataManager.getPermission(origin, 'geolocation') === undefined, 'private permission leaked');
    manager.clearSessionPermissions(privateSession, origin);
    assert(!manager.handlePermissionCheck(privateWindow.webContents, 'geolocation', origin), 'private permission reset failed');
    const once = await request(privateWindow, 'media', 'once');
    assert(once.granted && manager.getSessionPermissions(privateSession, origin).media === undefined, 'allow once persisted');
    results.permissions = { persistentAllow: true, privateIsolation: true, reset: true, allowOnce: true };
  } finally { normalWindow.destroy(); privateWindow.destroy(); }
}

function entry(manager, id) { return manager.tabs.get(id); }
function memoryKiB() { return app.getAppMetrics().reduce((sum, item) => sum + (item.memory?.workingSetSize || 0), 0); }

async function testTabs(origin) {
  const ses = session.fromPartition(`null-tabs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const window = new BrowserWindow({ show: false, width: 1000, height: 700, webPreferences: { sandbox: true, session: ses } });
  const events = [];
  const originalSend = window.webContents.send.bind(window.webContents);
  window.webContents.send = (channel, ...args) => { events.push({ channel, args }); return originalSend(channel, ...args); };
  const manager = new TabManager(window, ses);
  manager.setBounds({ x: 10, y: 90, width: 980, height: 600 });
  try {
    manager.createTab('one', `${origin}/one`); manager.createTab('two', `${origin}/two`); manager.switchTab('one');
    await waitFor(() => !entry(manager, 'one').isLoading && !entry(manager, 'two').isLoading, 'fixture tabs load');
    assert(entry(manager, 'one').title === 'One', 'tab title did not update');
    const guest = entry(manager, 'one').view.webContents;
    let prevented = false;
    for (const input of [{ key: 'k', alt: false }, { key: 't', alt: true }]) {
      guest.emit('before-input-event', { preventDefault: () => { prevented = true; } }, { type: 'keyDown', meta: true, control: false, shift: false, ...input });
    }
    assert(!prevented && !events.some(event => /translate|command-palette/.test(event.channel) || /translate|command-palette/.test(String(event.args[0]))), 'retired shortcut still handled');
    let contextItems;
    const buildMenu = Menu.buildFromTemplate;
    try {
      Menu.buildFromTemplate = items => { contextItems = items; return { popup() {} }; };
      guest.emit('context-menu', {}, { x: 5, y: 5, selectionText: 'Hello world', linkURL: `${origin}/two` });
    } finally { Menu.buildFromTemplate = buildMenu; }
    assert(contextItems.some(item => item.label === '새 탭에서 링크 열기') && contextItems.some(item => item.label === '검사 (Inspect Element)'), 'basic context menu lost');
    assert(contextItems.every(item => !/번역|translate/i.test(item.label || '')), 'translation context menu remains');
    manager.navigateTab('one', `${origin}/two`); await waitFor(() => !entry(manager, 'one').isLoading && entry(manager, 'one').url.endsWith('/two'), 'navigate');
    manager.goBack('one'); await waitFor(() => entry(manager, 'one').url.endsWith('/one'), 'back');
    manager.goForward('one'); await waitFor(() => entry(manager, 'one').url.endsWith('/two'), 'forward');
    manager.reload('one'); await waitFor(() => !entry(manager, 'one').isLoading, 'reload');
    const splitBounds = [];
    manager.setSplitView(true, 'two', 0.5);
    for (const ratio of [0.3, 0.4, 0.5, 0.6, 0.7]) {
      manager.setSplitRatio(ratio); const primary = entry(manager, 'one').view.getBounds(); const secondary = entry(manager, 'two').view.getBounds();
      assert(primary.width + secondary.width + 6 === 980, `split width mismatch ${ratio}`); assert(secondary.x === 10 + primary.width + 6, `split x mismatch ${ratio}`);
      assert(primary.height === 600 && secondary.height === 600, `split height mismatch ${ratio}`); splitBounds.push({ ratio, primaryWidth: primary.width, secondaryWidth: secondary.width });
    }
    manager.navigateTab('one', `${origin}/one`);
    await waitFor(() => !entry(manager, 'one').isLoading && entry(manager, 'one').url.endsWith('/one'), 'split navigation');
    const boundsAfterSplitNavigation = entry(manager, 'one').view.getBounds();
    assert(boundsAfterSplitNavigation.width < 980 && entry(manager, 'two').view.getBounds().x > boundsAfterSplitNavigation.x + boundsAfterSplitNavigation.width, 'split navigation expanded primary view');
    manager.setOverlay(true); assert(!entry(manager, 'one').view.getVisible() && !entry(manager, 'two').view.getVisible(), 'overlay did not hide views');
    manager.setOverlay(false); assert(entry(manager, 'one').view.getVisible() && entry(manager, 'two').view.getVisible(), 'views did not return');
    manager.switchTab('two'); manager.setSplitView(true, 'one', 0.5); assert(entry(manager, 'one').view.getVisible() && entry(manager, 'two').view.getVisible(), 'pane swap failed');
    assert(typeof manager.translatePage === 'undefined', 'removed translation engine is still reachable');
    manager.createTab('popup', `${origin}/popup`); manager.switchTab('popup'); await waitFor(() => !entry(manager, 'popup').isLoading, 'popup page');
    await entry(manager, 'popup').view.webContents.executeJavaScript("document.getElementById('popup').click()", true); await waitFor(() => events.some((e) => e.channel === 'tab:open-external' && String(e.args[0]).endsWith('/two')), 'target blank managed event');
    manager.navigateTab('popup', 'javascript:alert(1)'); assert(entry(manager, 'popup').url === 'null://newtab', 'unsafe URL was not rejected');
    const closingContents = entry(manager, 'two').view.webContents; const childrenBefore = window.contentView.children.length; manager.closeTab('two'); await waitFor(() => closingContents.isDestroyed(), 'closed WebContents');
    assert(window.contentView.children.length === childrenBefore - 1, 'closed view stayed attached');
    const before20 = memoryKiB(); for (let i = 0; i < 20; i++) manager.createTab(`memory-${i}`, `${origin}/one?tab=${i}`);
    await waitFor(() => Array.from(manager.tabs.entries()).filter(([id]) => id.startsWith('memory-')).every(([, item]) => !item.isLoading), '20 pages', 20000);
    const with20 = memoryKiB(); for (let i = 1; i < 20; i++) manager.closeTab(`memory-${i}`); await delay(500); const afterClose19 = memoryKiB();
    manager.setSplitView(false);
    manager.createTab('virtual-secondary', 'null://newtab');
    manager.switchTab('one');
    manager.setSplitView(true, 'virtual-secondary', 0.5);
    assert(entry(manager, 'one').view.getBounds().width === 980, 'virtual tab created a false split gap');
    results.tabs = { navigationBackForwardReload: true, titleStatus: true, splitBounds, splitNavigationBounds: true, virtualSplitGuard: true, overlayVisibility: true, paneSwap: true, translationEngineRemoved: true, removedShortcutsAndContextMenu: true, targetBlankManaged: true, unsafeProtocolBlocked: true, closedViewDestroyed: true };
    results.memory = { unit: 'KiB', before20, with20, afterClose19 };
  } finally { manager.destroyAll(); window.destroy(); }
}

async function testDownloads(origin) {
  // Electron's default session is the same session used by the production
  // normal window and gives the will-download path a full browser lifecycle.
  // The whole harness still runs against its temporary userData directory.
  const ses = session.defaultSession;
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, session: ses } });
  const manager = new DownloadManager(); let finish = null;
  ses.on('will-download', (event, item, webContents) => { console.log('[runtime] will-download', item.getURL()); return manager.handleWillDownload(event, item, webContents, window, {
    downloadPath: downloadDir, askDownloadLocation: false,
    onUpdate: (info) => { if (finish && info.state !== 'progressing') { const done = finish; finish = null; done(info); } },
  }); });
  const download = async (url, afterStart) => {
    const completed = new Promise((resolve) => { finish = resolve; });
    // Use the same user-facing path as a page download. In headless hidden
    // windows downloadURL can be ignored before a document has a frame.
    await window.webContents.executeJavaScript(`(() => { const link = document.createElement('a'); link.href = ${JSON.stringify(url)}; link.download = ''; document.body.appendChild(link); link.click(); link.remove(); })()`, true);
    // Small fixture downloads may complete before the polling tick, so the
    // existence of an item is the reliable start signal.
    await waitFor(() => manager.getDownloads(ses).length > 0, 'download start');
    const item = manager.getDownloads(ses).find((item) => item.state === 'progressing'); if (afterStart) await afterStart(item);
    return Promise.race([completed, delay(15000).then(() => { throw new Error(`download timeout ${url}`); })]);
  };
  try {
    await window.loadURL(origin);
    const complete = await download(`${origin}/download`);
    assert(complete.state === 'completed' && fs.existsSync(complete.savePath), 'completed download failed');
    assert(fs.statSync(complete.savePath).size === 128 * 1024, 'download size mismatch');
    manager.removeFromList(complete.id, ses); assert(!manager.getDownloads(ses).some((item) => item.id === complete.id), 'remove download failed'); assert(fs.existsSync(complete.savePath), 'remove list deleted file');
    const cancelled = await download(`${origin}/slow-download`, (item) => manager.cancelDownload(item.id, ses)); assert(cancelled.state === 'cancelled', 'cancel download failed');
    const interrupted = await download(`${origin}/interrupted-download`); assert(interrupted.state === 'interrupted', 'interrupted download failed');
    results.downloads = { complete: true, sizeVerified: true, cancel: true, interrupted: true, removeListKeepsFile: true };
  } finally { manager.removeSession(ses); window.destroy(); }
}

async function testExternalSites() {
  const sites = [['Google', 'https://www.google.com/'], ['GitHub', 'https://github.com/'], ['Wikipedia', 'https://www.wikipedia.org/'], ['Hacker News', 'https://news.ycombinator.com/'], ['YouTube', 'https://www.youtube.com/'], ['ChatGPT', 'https://chatgpt.com/']];
  // External navigation used to reuse a hidden BrowserWindow in this same
  // process after the 20-WebContentsView lifecycle test. On macOS that mixed
  // teardown/load sequence could crash Chromium before results were printed.
  // Keep this harness honest by making each site a fresh Electron process,
  // which also matches the P0 isolation requirement.
  for (const [name, url] of sites) {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(__dirname, 'verify-external-site-isolated.js')], {
      cwd: projectRoot,
      env: { ...process.env, NULL_EXTERNAL_NAME: name, NULL_EXTERNAL_URL: url },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    const outcome = await new Promise((resolve) => {
      child.on('close', (code, signal) => resolve({ code, signal }));
      child.on('error', (error) => resolve({ code: null, signal: null, error: String(error && error.message || error) }));
    });
    const resultLine = stdout.split('\n').reverse().find((line) => line.includes('[p0-site]') && line.includes('"event":"result"'));
    let isolatedResult = null;
    if (resultLine) {
      try { isolatedResult = JSON.parse(resultLine.slice(resultLine.indexOf('{'))); } catch {}
    }
    results.externalSites.push({
      name,
      status: isolatedResult?.status || (outcome.signal ? 'crashed' : 'failed'),
      domain: isolatedResult?.domain || new URL(url).hostname,
      durationMs: isolatedResult?.durationMs || Date.now() - started,
      exitCode: outcome.code,
      signal: outcome.signal || undefined,
      error: isolatedResult?.error || outcome.error || (outcome.signal ? `signal ${outcome.signal}` : stderr.trim().slice(-300) || undefined),
    });
  }
}

const keepAlive = setInterval(() => {}, 1000);
app.whenReady().then(async () => {
  console.log('[runtime] Electron ready');
  const fixture = await createFixtureServer(); console.log('[runtime] Fixture ready', fixture.origin);
  try {
    const dataManager = testData(); console.log('[runtime] Data passed');
    await testPermissions(dataManager, fixture.origin); console.log('[runtime] Permissions passed');
    await testTabs(fixture.origin); console.log('[runtime] Tabs passed');
    await testDownloads(fixture.origin); console.log('[runtime] Downloads passed');
    if (process.env.NULL_RUN_EXTERNAL === 'true') {
      await testExternalSites(); console.log('[runtime] External sites finished');
    } else {
      console.log('[runtime] External sites skipped (set NULL_RUN_EXTERNAL=true for isolated network probe)');
    }
    console.log('NULL_FULL_RUNTIME_QA_RESULT=' + JSON.stringify({ ok: true, electron: process.versions.electron, chromium: process.versions.chrome, userAgent: app.userAgentFallback, results }, null, 2));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { await fixture.close().catch(() => {}); clearInterval(keepAlive); fs.rmSync(runtimeDir, { recursive: true, force: true }); app.exit(process.exitCode || 0); }
}).catch((error) => { clearInterval(keepAlive); console.error(error); fs.rmSync(runtimeDir, { recursive: true, force: true }); app.exit(1); });
