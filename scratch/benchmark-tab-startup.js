// Owned loopback-only process; never opens the user's profile. Working-set
// sums include shared pages and must not be reported as unique physical RAM.
const { app, BrowserWindow } = require('electron');
const { buildSync } = require('esbuild');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { createServer } = require('node:http');
const profile = mkdtempSync(join(tmpdir(), 'null-startup-benchmark-'));
app.setPath('userData', profile);
const root = resolve(__dirname, '..');
buildSync({ absWorkingDir: root, entryPoints: ['electron/TabManager.ts'], bundle: true,
  platform: 'node', format: 'cjs', external: ['electron'], outfile: join(profile, 'TabManager.cjs') });
buildSync({ absWorkingDir: root, entryPoints: ['electron/guestPreload.ts'], bundle: true,
  platform: 'node', format: 'cjs', external: ['electron'], outfile: join(profile, 'guestPreload.js') });
const { TabManager } = require(join(profile, 'TabManager.cjs'));
const delay = ms => new Promise(r => setTimeout(r, ms));
const requests = new Set();
const server = createServer((req, res) => {
  requests.add(req.url);
  res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  res.end('<!doctype html><title>Startup fixture</title><link rel="icon" href="data:,"><body><h1>Fixture</h1>' +
    '<p>Controlled browser restore workload</p>'.repeat(2000) +
    '<script>window.keptState="unchanged";window.fixtureData=Array.from({length:800000},(_,i)=>i);</script>');
});
app.whenReady().then(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/tab/`;
  const win = new BrowserWindow({ show: false, width: 1200, height: 800 });
  const manager = new TabManager(win);
  const deferred = process.env.NULL_DEFER_RESTORE === 'true';
  const started = performance.now();
  for (let i = 0; i < 20; i++) manager.createTab(`tab-${i}`, url + i, false, 'workspace-default', { deferLoad: deferred && i > 0 });
  manager.switchTab('tab-0');
  const creationMs = performance.now() - started;
  const until = Date.now() + 20000;
  while (Date.now() < until && (manager.tabs.get('tab-0').isLoading || requests.size < (deferred ? 1 : 20))) await delay(20);
  const firstReadyMs = performance.now() - started;
  await delay(1500);
  const metrics = app.getAppMetrics();
  const startup = { creationMs, firstReadyMs, requestedPages: requests.size,
    renderers: metrics.filter(x => x.type === 'Tab').length,
    workingSetKiB: metrics.reduce((n, x) => n + x.memory.workingSetSize, 0), tabs: manager.getTabCount() };
  const switched = performance.now(); manager.switchTab('tab-19');
  while (Date.now() < until && (manager.tabs.get('tab-19').isLoading || !requests.has('/tab/19'))) await delay(20);
  const firstSelectionReadyMs = performance.now() - switched;
  manager.switchTab('tab-0');
  const keptState = await manager.getTabWebContents('tab-0').executeJavaScript('window.keptState');
  const result = { deferred, startup, firstSelectionReadyMs, requestedAfterSelection: requests.size, keptState, profile };
  writeFileSync(join(profile, 'result.json'), JSON.stringify(result, null, 2));
  console.log('NULL_TAB_STARTUP=' + JSON.stringify(result));
  manager.destroyAll(); win.destroy(); server.closeAllConnections(); server.close(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
