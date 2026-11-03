const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rawSites = process.env.NULL_EXTERNAL_SITES;
const sites = rawSites ? JSON.parse(rawSites) : [];
const settleMs = Number(process.env.NULL_EXTERNAL_SETTLE_MS || 1000);
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-p0-sequence-'));
app.setPath('userData', path.join(runtimeDir, 'profile'));

function domainOf(rawUrl) {
  try { return new URL(rawUrl).hostname; } catch { return 'invalid'; }
}

function log(event, payload = {}) {
  // Domain, status, and lifecycle only. Never emit page content or credentials.
  console.log(`[p0-sequence] ${JSON.stringify({ event, ...payload })}`);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!Array.isArray(sites) || sites.length === 0 || sites.some((site) => !site || !/^https?:\/\//i.test(site.url))) {
  console.error('NULL_EXTERNAL_SITES must be a non-empty JSON array of {name,url} http(s) entries');
  process.exitCode = 2;
  app.quit();
} else {
  app.whenReady().then(async () => {
    const partition = `null-p0-sequence-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ses = session.fromPartition(partition);
    const win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { session: ses, sandbox: true, nodeIntegration: false, contextIsolation: true } });
    const wc = win.webContents;
    let rendererGone = null;
    let currentFinalUrl = '';
    let mainFrameFinished = false;
    let mainFrameFailure = null;
    const results = [];

    wc.on('did-start-navigation', (_event, url, _isInPlace, isMainFrame) => {
      if (isMainFrame) log('did-start-navigation', { domain: domainOf(url), index: results.length + 1 });
    });
    wc.on('will-redirect', (_event, url, _isInPlace, isMainFrame) => {
      if (isMainFrame) log('will-redirect', { domain: domainOf(url), index: results.length + 1 });
    });
    wc.on('did-navigate', (_event, url) => { currentFinalUrl = url; log('did-navigate', { domain: domainOf(url), index: results.length + 1 }); });
    wc.on('did-finish-load', () => { mainFrameFinished = true; currentFinalUrl = wc.getURL(); log('did-finish-load', { domain: domainOf(currentFinalUrl), index: results.length + 1 }); });
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) {
        mainFrameFailure = { code: errorCode, description: errorDescription, domain: domainOf(validatedURL || currentFinalUrl) };
        log('did-fail-load', { ...mainFrameFailure, index: results.length + 1 });
      }
    });
    wc.on('render-process-gone', (_event, details) => {
      rendererGone = details.reason || 'unknown';
      log('render-process-gone', { reason: rendererGone, domain: domainOf(currentFinalUrl || sites[Math.max(0, results.length - 1)].url), index: results.length + 1 });
    });

    try {
      for (const site of sites) {
        const startedAt = Date.now();
        mainFrameFinished = false;
        mainFrameFailure = null;
        currentFinalUrl = site.url;
        log('start', { name: site.name, domain: domainOf(site.url), index: results.length + 1 });
        try { await wc.loadURL(site.url); } catch (error) {
          mainFrameFailure = { error: String(error && error.message || error), domain: domainOf(wc.isDestroyed() ? site.url : wc.getURL() || site.url) };
        }
        const deadline = Date.now() + 20_000;
        while (!rendererGone && !mainFrameFinished && !mainFrameFailure && Date.now() < deadline) await delay(50);
        await delay(settleMs);
        const finalUrl = wc.isDestroyed() ? currentFinalUrl : wc.getURL() || currentFinalUrl;
        const status = rendererGone ? 'renderer-gone' : mainFrameFinished ? 'loaded' : 'failed';
        const result = { name: site.name, status, domain: domainOf(finalUrl), durationMs: Date.now() - startedAt, error: mainFrameFailure?.error || mainFrameFailure?.description || undefined };
        results.push(result);
        log('result', result);
        if (rendererGone) break;
      }
      log('summary', { count: sites.length, completed: results.length, results });
    } finally {
      try { if (!win.isDestroyed()) win.destroy(); } catch {}
      await delay(250);
      try { await ses.clearStorageData(); } catch {}
      fs.rmSync(runtimeDir, { recursive: true, force: true });
      app.quit();
    }
  }).catch((error) => {
    console.error(`[p0-sequence] ${JSON.stringify({ event: 'startup-error', error: String(error && error.message || error) })}`);
    process.exitCode = 1;
    app.quit();
  });
}
