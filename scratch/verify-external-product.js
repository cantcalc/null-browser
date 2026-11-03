const { app, BrowserWindow, session } = require('electron');
const { buildSync } = require('esbuild');
const fs = require('fs');
const os = require('os');
const path = require('path');

const targetUrl = process.env.NULL_EXTERNAL_URL;
const targetName = process.env.NULL_EXTERNAL_NAME || 'external-site';
const projectRoot = path.join(__dirname, '..');
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-p0-product-'));
app.setPath('userData', path.join(runtimeDir, 'profile'));

function compile(entryPoint, name) {
  const outfile = path.join(runtimeDir, name);
  buildSync({ absWorkingDir: projectRoot, entryPoints: [entryPoint], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile });
  return outfile;
}

function domainOf(rawUrl) {
  try { return new URL(rawUrl).hostname; } catch { return 'invalid'; }
}

function log(event, payload = {}) {
  console.log(`[p0-product] ${JSON.stringify({ event, site: targetName, ...payload })}`);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
  console.error('NULL_EXTERNAL_URL must be an http(s) URL');
  process.exitCode = 2;
  app.quit();
} else {
  app.whenReady().then(async () => {
    const { TabManager } = require(compile('electron/TabManager.ts', 'TabManager.cjs'));
    compile('electron/guestPreload.ts', 'guestPreload.js');
    const ses = session.fromPartition(`null-p0-product-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { session: ses, sandbox: true } });
    const manager = new TabManager(win, ses);
    manager.setBounds({ x: 0, y: 0, width: 1200, height: 800 });
    manager.createTab('external', targetUrl);
    manager.switchTab('external');
    const entry = manager.tabs.get('external');
    const wc = entry.view.webContents;
    let finished = false;
    let rendererGone = null;
    let fail = null;
    const startedAt = Date.now();

    wc.on('did-start-navigation', (_event, url, _isInPlace, isMainFrame) => {
      if (isMainFrame) log('did-start-navigation', { domain: domainOf(url) });
    });
    wc.on('did-navigate', (_event, url) => log('did-navigate', { domain: domainOf(url) }));
    wc.on('did-finish-load', () => { finished = true; log('did-finish-load', { domain: domainOf(wc.getURL()), durationMs: Date.now() - startedAt }); });
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) {
        fail = { code: errorCode, description: errorDescription, domain: domainOf(validatedURL || targetUrl) };
        log('did-fail-load', fail);
      }
    });
    wc.on('render-process-gone', (_event, details) => {
      rendererGone = details.reason || 'unknown';
      log('render-process-gone', { reason: rendererGone, domain: domainOf(wc.isDestroyed() ? targetUrl : wc.getURL()) });
    });

    try {
      log('start', { domain: domainOf(targetUrl), architecture: 'TabManager-WebContentsView' });
      await wc.loadURL(targetUrl).catch((error) => { fail = { error: String(error && error.message || error), domain: domainOf(wc.getURL() || targetUrl) }; });
      await delay(Number(process.env.NULL_EXTERNAL_SETTLE_MS || 2500));
      const finalUrl = wc.isDestroyed() ? targetUrl : wc.getURL() || targetUrl;
      log('result', { status: rendererGone ? 'renderer-gone' : finished ? 'loaded' : fail ? 'failed' : 'loaded-without-finish-event', domain: domainOf(finalUrl), durationMs: Date.now() - startedAt });
    } finally {
      manager.destroyAll();
      if (!win.isDestroyed()) win.destroy();
      await delay(250);
      try { await ses.clearStorageData(); } catch {}
      fs.rmSync(runtimeDir, { recursive: true, force: true });
      app.quit();
    }
  }).catch((error) => {
    console.error(`[p0-product] ${JSON.stringify({ event: 'startup-error', site: targetName, error: String(error && error.message || error) })}`);
    process.exitCode = 1;
    app.quit();
  });
}
