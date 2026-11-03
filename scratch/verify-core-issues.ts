import { app, BrowserWindow, session } from 'electron';
import { createServer } from 'http';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { clearOriginStorage } from '../electron/siteData';
import { DataManager } from '../electron/DataManager';

console.log('NULL core issue verification booted');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function createFixtureServer(): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html><body>storage fixture</body></html>');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not expose a TCP port');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function seedStorage(window: BrowserWindow, marker: string) {
  await window.webContents.executeJavaScript(`(async () => {
    document.cookie = ${JSON.stringify(`null_cookie=${marker}; path=/`)};
    localStorage.setItem('null-local', ${JSON.stringify(marker)});
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('null-db', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('values');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction('values', 'readwrite');
        transaction.objectStore('values').put(${JSON.stringify(marker)}, 'marker');
        transaction.oncomplete = () => { request.result.close(); resolve(undefined); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    const cache = await caches.open('null-cache');
    await cache.put('/null-cache-entry', new Response(${JSON.stringify(marker)}));
  })()`, true);
}

async function readStorage(window: BrowserWindow) {
  return window.webContents.executeJavaScript(`(async () => ({
    cookie: document.cookie,
    local: localStorage.getItem('null-local'),
    databases: typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).map((item) => item.name) : [],
    caches: await caches.keys(),
  }))()`, true) as Promise<{ cookie: string; local: string | null; databases: string[]; caches: string[] }>;
}

async function reload(window: BrowserWindow, origin: string) {
  await window.loadURL(origin);
}

async function testSiteDataIsolation() {
  const fixture = await createFixtureServer();
  console.log('Fixture server ready', fixture.origin);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const normalSession = session.fromPartition(`null-core-normal-${suffix}`);
  const privateSession = session.fromPartition(`null-core-private-${suffix}`);
  const normalWindow = new BrowserWindow({ show: false, webPreferences: { session: normalSession, sandbox: true } });
  const privateWindow = new BrowserWindow({ show: false, webPreferences: { session: privateSession, sandbox: true } });
  console.log('Fixture windows created');

  try {
    await Promise.all([normalWindow.loadURL(fixture.origin), privateWindow.loadURL(fixture.origin)]);
    console.log('Fixture pages loaded');
    await Promise.all([seedStorage(normalWindow, 'normal'), seedStorage(privateWindow, 'private')]);
    console.log('Fixture storage seeded');

    const fixtureCookies = await normalSession.cookies.get({ url: fixture.origin });
    const fixtureCookie = fixtureCookies.find((cookie) => cookie.name === 'null_cookie');
    assert(fixtureCookie?.domain, 'Fixture cookie was not available for legacy origin reproduction');
    const legacyOrigin = `${fixtureCookie.secure ? 'https' : 'http'}://${fixtureCookie.domain.replace(/^\./, '')}`;
    await normalSession.clearStorageData({ origin: legacyOrigin });
    await reload(normalWindow, fixture.origin);
    const afterLegacyClear = await readStorage(normalWindow);
    assert(afterLegacyClear.local === 'normal', 'Legacy portless origin unexpectedly cleared target localStorage');
    assert(afterLegacyClear.databases.includes('null-db'), 'Legacy portless origin unexpectedly cleared target IndexedDB');
    console.log('Legacy Settings origin bug reproduced', { actualOrigin: fixture.origin, legacyOrigin });

    assert(await clearOriginStorage(normalSession, fixture.origin), 'Normal session clear was rejected');
    await Promise.all([reload(normalWindow, fixture.origin), reload(privateWindow, fixture.origin)]);
    const normalAfter = await readStorage(normalWindow);
    const privateAfterNormalClear = await readStorage(privateWindow);

    assert(!normalAfter.cookie.includes('null_cookie='), 'Normal cookie remained after origin clear');
    assert(normalAfter.local === null, 'Normal localStorage remained after origin clear');
    assert(!normalAfter.databases.includes('null-db'), 'Normal IndexedDB remained after origin clear');
    assert(!normalAfter.caches.includes('null-cache'), 'Normal Cache Storage remained after origin clear');
    assert(privateAfterNormalClear.cookie.includes('null_cookie=private'), 'Clearing normal session changed private cookies');
    assert(privateAfterNormalClear.local === 'private', 'Clearing normal session changed private localStorage');

    assert(await clearOriginStorage(privateSession, fixture.origin), 'Private session clear was rejected');
    await reload(privateWindow, fixture.origin);
    const privateAfter = await readStorage(privateWindow);
    assert(!privateAfter.cookie.includes('null_cookie='), 'Private cookie remained after origin clear');
    assert(privateAfter.local === null, 'Private localStorage remained after origin clear');
    assert(!privateAfter.databases.includes('null-db'), 'Private IndexedDB remained after origin clear');
    assert(!privateAfter.caches.includes('null-cache'), 'Private Cache Storage remained after origin clear');
  } finally {
    normalWindow.destroy();
    privateWindow.destroy();
    await fixture.close();
  }
}

function testHistoryControls(tempUserData: string) {
  app.setPath('userData', tempUserData);
  const manager = new DataManager();

  manager.addHistory('https://example.com/kept', 'kept');
  manager.addSearchHistory('kept query', 'google');
  assert(manager.getHistory().length === 1, 'Browsing history did not save while enabled');
  assert(manager.getSearchHistory().length === 1, 'Search history did not save while enabled');

  manager.updateSettings({ saveBrowsingHistory: false, saveSearchHistory: false });
  manager.addHistory('https://example.com/blocked', 'blocked');
  manager.addSearchHistory('blocked query', 'google');
  assert(manager.getHistory().length === 1, 'Browsing history saved while disabled or prior data was deleted');
  assert(manager.getSearchHistory().length === 1, 'Search history saved while disabled or prior data was deleted');
  manager.markCleanExit();

  const restored = new DataManager();
  assert(restored.getSettings().saveBrowsingHistory === false, 'Browsing-history setting did not persist');
  assert(restored.getSettings().saveSearchHistory === false, 'Search-history setting did not persist');
  assert(restored.getHistory().length === 1, 'Existing browsing history changed after restart');
  assert(restored.getSearchHistory().length === 1, 'Existing search history changed after restart');
}

const keepAlive = setInterval(() => {}, 1000);

app.whenReady().then(async () => {
  console.log('Electron ready');
  const tempUserData = mkdtempSync(join(tmpdir(), 'null-core-issues-'));
  try {
    testHistoryControls(tempUserData);
    console.log('History controls passed');
    await testSiteDataIsolation();
    console.log('Site data isolation passed');
    console.log(JSON.stringify({
      ok: true,
      tests: ['legacy Settings origin reproduction', 'history controls', 'normal/private origin storage isolation'],
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      userAgent: app.userAgentFallback,
    }, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearInterval(keepAlive);
    rmSync(tempUserData, { recursive: true, force: true });
    app.quit();
  }
}).catch((error) => {
  clearInterval(keepAlive);
  console.error(error);
  app.exit(1);
});
