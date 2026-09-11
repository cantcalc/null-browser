const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const targetUrl = process.env.AERO_EXTERNAL_URL;
const targetName = process.env.AERO_EXTERNAL_NAME || 'external-site';
const settleMs = Number(process.env.AERO_EXTERNAL_SETTLE_MS || 2500);
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aero-p0-site-'));
app.setPath('userData', path.join(runtimeDir, 'profile'));

function domainOf(rawUrl) {
  try { return new URL(rawUrl).hostname; } catch { return 'invalid'; }
}

function log(event, payload = {}) {
  // Deliberately log only event names, status, timing, and domains. Never log
  // page content, cookies, credentials, query values, or tokens.
  console.log(`[p0-site] ${JSON.stringify({ event, site: targetName, ...payload })}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
  console.error('AERO_EXTERNAL_URL must be an http(s) URL');
  process.exitCode = 2;
  app.quit();
} else {
  app.whenReady().then(async () => {
    const startedAt = Date.now();
    const partition = `aero-p0-site-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ses = session.fromPartition(partition);
    const win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 800,
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    const wc = win.webContents;
    let finalUrl = targetUrl;
    let rendererGone = null;
    let didNavigate = false;
    let navigationWarning = null;

    wc.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
      if (isMainFrame) log('did-start-navigation', { domain: domainOf(url), isInPlace: Boolean(isInPlace) });
    });
    wc.on('will-redirect', (_event, url, isInPlace, isMainFrame) => {
      if (isMainFrame) log('will-redirect', { domain: domainOf(url), isInPlace: Boolean(isInPlace) });
    });
    wc.on('did-redirect-navigation', (_event, url, isInPlace, isMainFrame) => {
      if (isMainFrame) log('did-redirect-navigation', { domain: domainOf(url), isInPlace: Boolean(isInPlace) });
    });
    wc.on('did-navigate', (_event, url) => {
      finalUrl = url;
      didNavigate = true;
      log('did-navigate', { domain: domainOf(url) });
    });
    wc.on('did-finish-load', () => {
      finalUrl = wc.isDestroyed() ? finalUrl : wc.getURL() || finalUrl;
      log('did-finish-load', { domain: domainOf(finalUrl), durationMs: Date.now() - startedAt });
    });
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) {
        finalUrl = validatedURL || finalUrl;
        log('did-fail-load', { code: errorCode, description: errorDescription, domain: domainOf(finalUrl) });
      }
    });
    wc.on('render-process-gone', (_event, details) => {
      rendererGone = details.reason || 'unknown';
      log('render-process-gone', { reason: rendererGone, domain: domainOf(finalUrl) });
    });

    let resultStatus = 'failed';
    let resultError = null;
    try {
      log('start', { domain: domainOf(targetUrl) });
      await Promise.race([
        wc.loadURL(targetUrl),
        delay(20_000).then(() => { throw new Error('timeout'); }),
      ]);
      await delay(settleMs);
      resultStatus = rendererGone ? 'renderer-gone' : 'loaded';
    } catch (error) {
      finalUrl = wc.isDestroyed() ? finalUrl : wc.getURL() || finalUrl;
      const message = String(error && error.message || error);
      if (/ERR_ABORTED\s*\(-3\)/i.test(message) && didNavigate) {
        navigationWarning = message;
        resultStatus = 'loaded';
      } else {
        resultError = message;
      }
    }
    finalUrl = wc.isDestroyed() ? finalUrl : wc.getURL() || finalUrl;
    log('result', { status: resultStatus, error: resultError || undefined, warning: navigationWarning || undefined, domain: domainOf(finalUrl), durationMs: Date.now() - startedAt });
    process.exitCode = resultStatus === 'loaded' ? 0 : 1;
    {
      // Close exactly once, then let Electron perform its normal quit path.
      // This avoids the old harness' forced app.exit during active Chromium
      // network/renderer teardown.
      try { if (!win.isDestroyed()) win.destroy(); } catch {}
      await delay(250);
      try { await ses.clearStorageData(); } catch {}
      fs.rmSync(runtimeDir, { recursive: true, force: true });
      app.quit();
    }
  }).catch((error) => {
    console.error(`[p0-site] ${JSON.stringify({ event: 'startup-error', site: targetName, error: String(error && error.message || error) })}`);
    process.exitCode = 1;
    app.quit();
  });
}
