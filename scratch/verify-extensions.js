// Real Electron integration test. Every extension and profile lives in a fresh
// temporary directory; the user's browser profile is never opened.
const { app, BrowserWindow, session, dialog, protocol, screen } = require('electron');
const { buildSync } = require('esbuild');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { Module } = require('node:module');
const AdmZip = require('adm-zip');

const root = path.resolve(__dirname, '..');
const restoreFile = process.argv.find((arg) => arg.startsWith('--restore='))?.slice('--restore='.length);
const restore = restoreFile ? JSON.parse(fs.readFileSync(restoreFile, 'utf8')) : null;
const work = restore?.profile || fs.mkdtempSync(path.join(os.tmpdir(), 'null-extension-qa-'));
app.setPath('userData', path.join(work, 'profile'));
app.setName('NULL Browser');
app.on('window-all-closed', (event) => event.preventDefault());
protocol.registerSchemesAsPrivileged([{ scheme: 'crx', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
process.env.NODE_PATH = [path.join(root, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
Module._initPaths();

function compile(source, name) {
  const outfile = path.join(work, name);
  buildSync({ absWorkingDir: root, entryPoints: [source], outfile, bundle: true, platform: 'node', format: 'cjs',
    external: ['electron', 'electron-chrome-web-store', 'electron-chrome-extensions'] });
  return outfile;
}
const extensionManagerModule = compile('electron/ExtensionManager.ts', 'ExtensionManager.cjs');
const { TabManager } = require(compile('electron/TabManager.ts', 'TabManager.cjs'));
fs.copyFileSync(path.join(root, 'dist-electron/guestPreload.js'), path.join(work, 'guestPreload.js'));
fs.copyFileSync(path.join(root, 'dist-electron/webStorePreload.js'), path.join(work, 'webStorePreload.js'));
fs.copyFileSync(path.join(root, 'dist-electron/extensionCompatPreload.js'), path.join(work, 'extensionCompatPreload.js'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
async function waitFor(predicate, message, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${message}`);
}

function varint(value) {
  const bytes = [];
  do { bytes.push((value & 127) | (value > 127 ? 128 : 0)); value = Math.floor(value / 128); } while (value);
  return Buffer.from(bytes);
}
function field(tag, value) { return Buffer.concat([varint(tag * 8 + 2), varint(value.length), value]); }

function makeFixture() {
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' });
  const crxId = crypto.createHash('sha256').update(publicKey).digest().subarray(0, 16);
  const id = [...crxId.toString('hex')].map((n) => String.fromCharCode(97 + parseInt(n, 16))).join('');
  const manifest = {
    manifest_version: 3, name: 'NULL One Click QA', version: '1.0.0',
    permissions: ['tabs', 'storage', 'scripting'], host_permissions: ['http://127.0.0.1/*'],
    background: { service_worker: 'worker.js' },
    action: { default_title: 'NULL extension QA', default_popup: 'popup.html' },
    content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'] }],
    icons: { '16': 'icon.png' },
  };
  const icon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/+kAAAAASUVORK5CYII=', 'base64');
  const zip = new AdmZip();
  const files = {
    'manifest.json': JSON.stringify(manifest),
    'worker.js': `const api=globalThis.browser||chrome;
      api.commands.onCommand.addListener(()=>{});
      api.runtime.onInstalled.addListener(() => api.action.setBadgeText({text:'OK'}));
      api.runtime.onMessage.addListener((message, sender, reply) => {
        if (message === 'active') { api.tabs.query({active:true,currentWindow:true}).then(reply); return true; }
      });`,
    'content.js': `document.documentElement.dataset.nullExtensionTest = 'ready';`,
    'popup.html': '<!doctype html><html><body style="width:280px;height:120px"><h1>NULL extension popup</h1><output id="result"></output><script src="popup.js"></script></body></html>',
    'popup.js': `const api=globalThis.browser||chrome;
      document.body.dataset.alias=String(api===chrome);
      api.tabs.query({active:true,currentWindow:true}).then(tabs => {
      document.querySelector('#result').textContent=JSON.stringify(tabs.map(t => ({id:t.id,url:t.url})));
      api.runtime.sendMessage('active').then(result => { document.body.dataset.worker = result?.length ? 'ok' : 'empty'; });
    });`,
    'icon.png': icon,
  };
  for (const [name, body] of Object.entries(files)) zip.addFile(name, Buffer.isBuffer(body) ? body : Buffer.from(body));
  const contents = zip.toBuffer();
  const signedHeader = field(1, crxId);
  const size = Buffer.alloc(4); size.writeUInt32LE(signedHeader.length);
  const signature = crypto.sign('sha256', Buffer.concat([Buffer.from('CRX3 SignedData\0'), size, signedHeader, contents]), keys.privateKey);
  const proof = Buffer.concat([field(1, publicKey), field(2, signature)]);
  const header = Buffer.concat([field(2, proof), field(10000, signedHeader)]);
  const prefix = Buffer.alloc(12); prefix.write('Cr24'); prefix.writeUInt32LE(3, 4); prefix.writeUInt32LE(header.length, 8);
  return { id, manifest, icon, files, crx: Buffer.concat([prefix, header, contents]) };
}

let manager;
let win;
let server;
let sequence = 0;
let extensionManager;
let confirmationCount = 0;
let acceptInstall = false;
const results = {};
const fixture = makeFixture();
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url || input.toString());
  if (url.hostname === 'clients2.google.com' && url.pathname.endsWith('/crx') && (url.searchParams.get('x') || '').includes(fixture.id)) {
    return new Response(fixture.crx, { status: 200, headers: { 'content-type': 'application/x-chrome-extension' } });
  }
  if (url.hostname === 'null-qa.invalid') return new Response(fixture.icon, { status: 200 });
  return originalFetch(input, options);
};
dialog.showMessageBox = async (options) => {
  confirmationCount++;
  if (options.message.includes(fixture.manifest.name)) assert(options.detail.includes('tabs'), 'install prompt omitted permissions');
  return { response: acceptInstall ? 1 : 0, checkboxChecked: false };
};

async function run() {
  await app.whenReady();
  const { ExtensionManager } = require(extensionManagerModule);
  server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>NULL fixture tab</title><h1>NULL fixture</h1>'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  extensionManager = new ExtensionManager();
  await extensionManager.initialize({
    createTab: async (details) => {
      const id = `extension-${++sequence}`;
      manager.createTab(id, details.url || origin);
      if (details.active !== false) manager.switchTab(id);
      return [manager.getTabWebContents(id), win];
    },
    selectTab: (contents) => {
      if (manager.isRegisteringExtensionTab()) return;
      const id = manager.getTabId(contents);
      if (id && manager.getActiveTabId() !== id) manager.switchTab(id);
    },
    removeTab: (contents) => { const id = manager.getTabId(contents); if (id) manager.closeTab(id); },
    requestPermissions: async () => false,
  });
  win = new BrowserWindow({ show: true, width: 1100, height: 780,
    webPreferences: { preload: path.join(root, 'dist-electron/preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const ui = path.join(work, 'chrome.html');
  fs.writeFileSync(ui, '<!doctype html><title>NULL 확장 QA · 임시 프로필</title><body style="margin:0"><browser-action-list style="position:fixed;right:8px;top:8px" alignment="bottom left"></browser-action-list></body>');
  await win.loadFile(ui);
  manager = new TabManager(win, session.defaultSession, extensionManager.runtime);
  manager.setBounds({ x: 0, y: 70, width: 1100, height: 680 });

  if (restore) {
    assert((await extensionManager.list()).some((extension) => extension.id === restore.id), 'fresh-process restore failed');
    manager.createTab('restored-site', origin); manager.switchTab('restored-site');
    const restoredSite = manager.getTabWebContents('restored-site');
    await waitFor(async () => !restoredSite.isLoading() && await restoredSite.executeJavaScript("document.documentElement.dataset.nullExtensionTest === 'ready'"), 'restored content script');
    await waitFor(async () => await win.webContents.executeJavaScript(`!!document.querySelector('browser-action-list')?.shadowRoot?.querySelector('[id="${restore.id}"]')`), 'restored toolbar action');
    let restoredPopup;
    extensionManager.runtime.once('browser-action-popup-created', value => { restoredPopup=value; });
    await win.webContents.executeJavaScript(`document.querySelector('browser-action-list').shadowRoot.querySelector('[id="${restore.id}"]').click()`, true);
    await waitFor(() => restoredPopup?.browserWindow && !restoredPopup.browserWindow.webContents.isLoading(), 'restored popup');
    await waitFor(async () => (await restoredPopup.browserWindow.webContents.executeJavaScript('document.body.dataset.worker')) === 'ok', 'restored worker');
    restoredPopup.destroy();
    await extensionManager.remove(restore.id);
    assert((await extensionManager.list()).length === 0, 'fresh-process removal failed');
    results.freshProcessRestore = true;
    results.freshProcessContentAndPopupAndWorker = true;
    results.freshProcessRemoval = true;
    console.log('NULL_EXTENSION_QA_RESULT=' + JSON.stringify({ok:true, results, profile:work}));
    return;
  }

  // Serve a deterministic store-page fixture at the real origin. The actual
  // bridge, confirmation, CRX installer, permissions and extension runtime run.
  const storeUrl = `https://chromewebstore.google.com/detail/null-qa/${fixture.id}`;
  await session.defaultSession.protocol.handle('https', async (request) => {
    if (new URL(request.url).hostname !== 'chromewebstore.google.com') return new Response('', {status:404});
    return new Response(`<!doctype html><html><title>Extension store QA</title><body>
      <div id="download-dialog" jscontroller="h4ilFc" role="dialog" aria-labelledby="promo-header"><h2 id="promo-header">Switch to Chrome</h2></div>
      <div id="download-banner" jscontroller="o2G9me"><button jscontroller="O626Fe">Install Chrome</button></div>
      <div id="permission-dialog" role="dialog">Permission or installation error must remain visible</div>
      <button id="unsupported" disabled>Unsupported extension</button><button id="install">Add to NULL</button>
      <script>document.querySelector('#install').onclick=async()=>{
        window.installResult=await chrome.webstorePrivate.beginInstallWithManifest3(${JSON.stringify({
          id: fixture.id, manifest: JSON.stringify(fixture.manifest), localizedName: fixture.manifest.name,
          iconUrl: 'https://null-qa.invalid/icon.png',
        })});
      };</script></body></html>`, {headers:{'content-type':'text/html'}});
  });
  manager.createTab('store', storeUrl); manager.switchTab('store');
  const store = manager.getTabWebContents('store');
  await waitFor(async () => !store.isLoading() && await store.executeJavaScript('!!chrome.webstorePrivate?.beginInstallWithManifest3'), 'store install API');
  await waitFor(async () => await store.executeJavaScript(`['download-dialog','download-banner'].every(id=>getComputedStyle(document.getElementById(id)).display==='none')`), 'only Chrome download promotions suppressed');
  assert(await store.executeJavaScript(`document.getElementById('unsupported').disabled && getComputedStyle(document.getElementById('permission-dialog')).display!=='none' && !document.getElementById('install').disabled`), 'store presentation altered install gating or hid a real dialog');
  results.storeDownloadPromotionsOnly = true;
  await store.executeJavaScript("document.querySelector('#install').click()", true);
  await waitFor(async () => Boolean(await store.executeJavaScript('window.installResult')), 'cancelled installation');
  assert((await store.executeJavaScript('window.installResult')) === 'user_cancelled', 'cancel path was not reached');
  assert((await extensionManager.list()).length === 0, 'cancel installed extension');
  results.cancelDoesNotInstall = true;
  acceptInstall = true;
  await store.executeJavaScript("window.installResult=null; document.querySelector('#install').click()", true);
  await waitFor(async () => Boolean(await store.executeJavaScript('window.installResult')), 'store install result');
  const installResult = await store.executeJavaScript('window.installResult');
  assert(installResult === 'success', `Store install returned ${installResult}; confirmations=${confirmationCount}`);
  await waitFor(async () => (await extensionManager.list()).some((ext) => ext.id === fixture.id), 'one-click CRX install');
  assert(confirmationCount === 2, 'installation confirmation missing');
  assert((await extensionManager.list())[0].source === 'webstore', 'store source metadata missing');
  results.storeButtonInstallsCrx = true;

  manager.createTab('site', origin); manager.switchTab('site');
  const site = manager.getTabWebContents('site');
  await waitFor(async () => !site.isLoading() && await site.executeJavaScript("document.documentElement.dataset.nullExtensionTest === 'ready'"), 'content script');
  results.contentScript = true;
  await waitFor(async () => await win.webContents.executeJavaScript(`!!document.querySelector('browser-action-list')?.shadowRoot?.querySelector('[id="${fixture.id}"]')`), 'toolbar extension action');
  results.toolbarAction = true;
  let popup;
  const popupListenerBaseline = { move: win.listenerCount('move'), resize: win.listenerCount('resize'), display: screen.listenerCount('display-metrics-changed') };
  extensionManager.runtime.once('browser-action-popup-created', (value) => { popup = value; });
  await win.webContents.executeJavaScript(`document.querySelector('browser-action-list').shadowRoot.querySelector('[id="${fixture.id}"]').click()`, true);
  await waitFor(() => popup?.browserWindow && !popup.browserWindow.webContents.isLoading(), 'extension popup');
  await waitFor(async () => (await popup.browserWindow.webContents.executeJavaScript("document.querySelector('#result')?.textContent || ''")).includes(origin), 'popup active tab query');
  await waitFor(async () => (await popup.browserWindow.webContents.executeJavaScript('document.body.dataset.worker')) === 'ok', 'service worker messaging');
  results.popupAndActiveTabAndServiceWorker = true;
  assert(await popup.browserWindow.webContents.executeJavaScript("document.body.dataset.alias==='true'"),'browser-first extension bypassed bridge');
  results.browserNamespaceMatchesChromeInPopupAndWorker=true;
  const assertPopupFits = () => {
    const bounds=popup.browserWindow.getBounds(),parent=win.getContentBounds(),area=screen.getDisplayMatching(win.getBounds()).workArea;
    for (const [label,region] of [['parent',parent],['screen',area]]) {
      assert(bounds.x>=region.x&&bounds.y>=region.y&&bounds.x+bounds.width<=region.x+region.width&&bounds.y+bounds.height<=region.y+region.height,`popup outside ${label}: ${JSON.stringify({bounds,region})}`);
    }
    return bounds;
  };
  assertPopupFits();
  await popup.browserWindow.webContents.executeJavaScript("document.body.style.width='900px';document.body.style.height='1200px';true");
  await waitFor(()=>popup.browserWindow.getBounds().width>=700,'large popup preferred width');
  assertPopupFits();
  win.setSize(800,600); await delay(120); assertPopupFits();
  const area=screen.getDisplayMatching(win.getBounds()).workArea;
  win.setPosition(area.x+area.width-600,area.y+50); await delay(120); assertPopupFits();
  const constrained=popup.browserWindow.getBounds();
  assert(constrained.width<800,'partial offscreen parent did not reduce popup width');
  fs.writeFileSync(path.join(work,'popup-contained.png'),(await popup.browserWindow.capturePage()).toPNG());
  results.popupBoundsSmallWindowLargeContentAndDisplayEdge={...constrained};
  popup.destroy();
  assert(win.listenerCount('move')===popupListenerBaseline.move&&win.listenerCount('resize')===popupListenerBaseline.resize&&screen.listenerCount('display-metrics-changed')===popupListenerBaseline.display,'popup listeners leaked on close');
  results.popupBoundsListenerCleanup=true;
  win.setBounds({x:area.x+20,y:area.y+20,width:1100,height:780});

  // A second workspace gets the same installed catalog, but separate extension
  // execution/storage and browser-action routing. No extra browser window.
  const workspaceSession = session.fromPartition('persist:aero-workspace-extension-qa');
  await extensionManager.initialize({}, workspaceSession);
  const { ElectronChromeExtensions } = require('electron-chrome-extensions');
  const workspaceRuntime = ElectronChromeExtensions.fromSession(workspaceSession);
  const workspaceManager = new TabManager(win, workspaceSession, workspaceRuntime);
  workspaceManager.setBounds({ x: 0, y: 70, width: 1100, height: 680 });
  manager.setOverlay(true);
  workspaceManager.createTab('workspace-site', `${origin}/workspace-b`); workspaceManager.switchTab('workspace-site');
  const workspaceSite = workspaceManager.getTabWebContents('workspace-site');
  await waitFor(async () => !workspaceSite.isLoading() && await workspaceSite.executeJavaScript("document.documentElement.dataset.nullExtensionTest==='ready'"), 'workspace content script');
  await win.webContents.executeJavaScript(`document.body.innerHTML='<browser-action-list partition="persist:aero-workspace-extension-qa" alignment="bottom right"></browser-action-list>';true`);
  await waitFor(async () => await win.webContents.executeJavaScript(`!!document.querySelector('browser-action-list')?.shadowRoot?.querySelector('[id="${fixture.id}"]')`), 'workspace browser action');
  let workspacePopup;
  workspaceRuntime.once('browser-action-popup-created', value=>{workspacePopup=value});
  await win.webContents.executeJavaScript(`document.querySelector('browser-action-list').shadowRoot.querySelector('[id="${fixture.id}"]').click()`, true);
  await waitFor(()=>workspacePopup?.browserWindow&&!workspacePopup.browserWindow.webContents.isLoading(),'workspace popup');
  await waitFor(async()=> (await workspacePopup.browserWindow.webContents.executeJavaScript("document.querySelector('#result').textContent")).includes('/workspace-b'),'workspace active-tab routing');
  assert(workspacePopup.browserWindow.webContents.session===workspaceSession,'extension popup escaped workspace');
  await workspacePopup.browserWindow.webContents.executeJavaScript("chrome.storage.local.set({qaAccount:'workspace-b'})");
  workspacePopup.destroy();
  workspaceManager.destroyAll();manager.setOverlay(false);manager.switchTab('site');
  await win.webContents.executeJavaScript(`document.body.innerHTML='<browser-action-list alignment="bottom right"></browser-action-list>';true`);
  await waitFor(async () => await win.webContents.executeJavaScript(`!!document.querySelector('browser-action-list')?.shadowRoot?.querySelector('[id="${fixture.id}"]')`),'default action restored');
  let defaultPopup;
  extensionManager.runtime.once('browser-action-popup-created', value=>{defaultPopup=value});
  await win.webContents.executeJavaScript(`document.querySelector('browser-action-list').shadowRoot.querySelector('[id="${fixture.id}"]').click()`,true);
  await waitFor(()=>defaultPopup?.browserWindow&&!defaultPopup.browserWindow.webContents.isLoading(),'default popup');
  assert(!await defaultPopup.browserWindow.webContents.executeJavaScript("chrome.storage.local.get('qaAccount').then(v=>v.qaAccount)"),'extension storage leaked between workspaces');
  defaultPopup.destroy();
  results.workspaceCatalogContentPopupAndStorageIsolation = true;

  // No management API or content script may leak into the private session.
  const privateSession = session.fromPartition(`null-private-extension-qa-${Date.now()}`);
  const privateWin = new BrowserWindow({ show: false, webPreferences: { session: privateSession, sandbox: true, contextIsolation: true } });
  await privateWin.loadURL(origin);
  // Chromium may share an extension registry with the off-the-record session.
  // Verify actual execution isolation rather than equating registry visibility
  // with permission to run in a private page.
  assert(!await privateWin.webContents.executeJavaScript('document.documentElement.dataset.nullExtensionTest'), 'private content script leak');
  privateWin.destroy();
  results.privateIsolation = true;

  // Reject look-alike store origins at preload level, not merely at install.
  manager.createTab('lookalike', 'https://chromewebstore.google.com.evil.invalid/');
  const lookalike = manager.getTabWebContents('lookalike');
  await waitFor(() => !lookalike.isLoading(), 'look-alike origin');
  assert(!await lookalike.executeJavaScript('!!globalThis.electronWebstore'), 'look-alike origin received install API');
  manager.closeTab('lookalike');
  results.exactStoreOrigin = true;

  // Restore through the same loader used on application startup, then ensure
  // uninstall removes the managed package so it cannot return after restart.
  const installedPath = (await extensionManager.list())[0].path;
  session.defaultSession.extensions.removeExtension(fixture.id);
  const { loadAllExtensions } = require('electron-chrome-web-store');
  await loadAllExtensions(session.defaultSession, path.join(app.getPath('userData'), 'Extensions'));
  assert((await extensionManager.list()).some((ext) => ext.id === fixture.id), 'startup restore failed');
  results.startupRestore = true;
  await extensionManager.remove(fixture.id);
  assert(workspaceSession.extensions.getAllExtensions().length===0,'removed extension remains in another workspace');
  results.workspaceCatalogUninstallPropagation = true;
  assert(!fs.existsSync(installedPath), 'managed extension package remained after removal');
  await loadAllExtensions(session.defaultSession, path.join(app.getPath('userData'), 'Extensions'));
  assert((await extensionManager.list()).length === 0, 'removed extension returned');
  results.removeDoesNotReturn = true;

  session.defaultSession.protocol.unhandle('https');
  if (process.env.NULL_RUN_STORE === 'true') {
    const darkReader = 'eimadpbcbfnmbkopoojfekhnkhdbieeh';
    manager.createTab('real-store', `https://chromewebstore.google.com/detail/dark-reader/${darkReader}`);
    manager.switchTab('real-store');
    const realStore = manager.getTabWebContents('real-store');
    // A background/occluded document can defer the store's animation-frame
    // initialization. Exercise the foreground installation path, not a timer
    // waiting on a tab that the test never made visible to the user.
    win.show(); win.focus(); realStore.focus();
    realStore.on('did-finish-load', () => console.log('[extension QA] real store loaded'));
    realStore.on('did-fail-load', (_event, code, message) => console.log('[extension QA] store load error', code, message));
    realStore.on('console-message', (_event, ...args) => {
      const message = typeof _event.message === 'string' ? _event.message : args[1];
      if (String(message).includes('webstore') || String(message).includes('Error')) console.log('[store console]', String(message).slice(0,350));
    });
    await waitFor(async () => !realStore.isLoading() && await realStore.executeJavaScript(`Array.from(document.querySelectorAll('button')).some(b => !b.disabled && /Add to|추가/.test(b.textContent))`), 'real store install button', 60000);
    console.log('[extension QA] real store buttons', await realStore.executeJavaScript(`Array.from(document.querySelectorAll('button')).filter(b => /Add to|추가/.test(b.textContent)).map(b=>({text:b.textContent,disabled:b.disabled,html:b.outerHTML.slice(0,600)}))`));
    fs.writeFileSync(path.join(work,'real-store.png'), (await realStore.capturePage()).toPNG());
    await realStore.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b => !b.disabled && /Add to|추가/.test(b.textContent)).click()`, true);
    await waitFor(async () => (await extensionManager.list()).some((ext) => ext.id === darkReader), 'real Dark Reader store install', 90000);
    results.realChromeStoreDarkReader = true;
    manager.switchTab('site');
    site.reload();
    await waitFor(async () => !site.isLoading() && await site.executeJavaScript("!!document.querySelector('style.darkreader') || !!document.documentElement.dataset.darkreaderMode"), 'Dark Reader content execution', 20000);
    results.darkReaderContentExecution = true;
    await waitFor(async () => await win.webContents.executeJavaScript(`!!document.querySelector('browser-action-list')?.shadowRoot?.querySelector('[id="${darkReader}"]')`), 'Dark Reader toolbar action');
    let darkPopup;
    extensionManager.runtime.once('browser-action-popup-created', value => { darkPopup = value; });
    await win.webContents.executeJavaScript(`document.querySelector('browser-action-list').shadowRoot.querySelector('[id="${darkReader}"]').click()`, true);
    await waitFor(() => darkPopup?.browserWindow && !darkPopup.browserWindow.webContents.isLoading(), 'Dark Reader popup');
    await waitFor(async () => await darkPopup.browserWindow.webContents.executeJavaScript('document.body.innerText.length > 100 && document.querySelectorAll("button,input").length > 2'), 'Dark Reader popup controls, not loading placeholder');
    results.darkReaderPopup = true;
    darkPopup.destroy();
    await extensionManager.remove(darkReader);
  }
  // Leave a managed install for the runner's second, fresh Electron process.
  manager.switchTab('store');
  await session.defaultSession.protocol.handle('https', async () => new Response(`<!doctype html><title>Restart fixture</title><script>
    window.addEventListener('DOMContentLoaded',async()=>window.installResult=await chrome.webstorePrivate.beginInstallWithManifest3(${JSON.stringify({
      id:fixture.id, manifest:JSON.stringify(fixture.manifest), localizedName:fixture.manifest.name, iconUrl:'https://null-qa.invalid/icon.png',
    })}));</script>`, {headers:{'content-type':'text/html'}}));
  await store.loadURL(storeUrl);
  await waitFor(async () => (await extensionManager.list()).some((extension) => extension.id === fixture.id), 'prepare restart install');
  session.defaultSession.protocol.unhandle('https');
  fs.writeFileSync(path.join(work, 'restart.json'), JSON.stringify({profile:work,id:fixture.id}));
  console.log('NULL_EXTENSION_QA_RESULT=' + JSON.stringify({ ok: true, results, electron: process.versions.electron, chromium: process.versions.chrome, profile: work }));
}

const timeout = setTimeout(() => { console.error('Extension QA exceeded time limit'); app.exit(1); }, 240000);
run().then(() => {
  clearTimeout(timeout);
  manager?.destroyAll(); win?.destroy(); server?.close(); app.quit();
}).catch((error) => {
  console.error(error);
  clearTimeout(timeout);
  manager?.destroyAll(); win?.destroy(); server?.close(); app.exit(1);
});
