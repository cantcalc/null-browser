// Compare owned, fresh-profile browser processes against one loopback fixture.
// No real profile is opened, no security policy is disabled, and no app is published.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const beforeApp = process.env.NULL_PERF_BEFORE_APP || path.join(root, 'release-review-20261102-interactions/mac-arm64/NULL Browser.app');
const afterApp = process.env.NULL_PERF_AFTER_APP || path.join(root, 'release-review-20261102-optimized/mac-arm64/NULL Browser.app');
const samples = Number(process.env.NULL_PERF_SAMPLES || 21);
if (!Number.isInteger(samples) || samples < 1 || samples > 100) throw new Error('NULL_PERF_SAMPLES must be 1..100');
fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
const output = fs.mkdtempSync(path.join(root, 'tmp', 'loading-benchmark-'));
const results = { conditions: { samplesPerRound: samples, rounds: 2, viewport: '1200x700 @1', warmupMs: 3500, pageWarmups: 3, httpCacheDisabled: true, freshProfiles: true, loopbackOnly: true }, runs: [] };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const median = values => { const a = [...values].sort((a, b) => a - b); return (a[(a.length - 1) >> 1] + a[a.length >> 1]) / 2; };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII=', 'base64');
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/asset/')) {
    response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }); response.end(png); return;
  }
  const images = url.pathname === '/assets' ? Array.from({ length: 120 }, (_, i) => `<img width="8" height="8" src="/asset/${i}.png?token=${url.searchParams.get('token')}">`).join('') : '';
  const rows = Array.from({ length: 200 }, (_, i) => `<div>Identical browser diagnostic row ${i}</div>`).join('');
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(`<!doctype html><head><title>Controlled performance fixture</title><link rel="icon" href="data:,"></head><body style="font:16px system-ui;background:#fafafa;color:#202124;margin:16px"><h1>Browser audit</h1>${images}${rows}</body>`);
});
let current;
async function waitFor(check, label, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { try { const v = await check(); if (v) return v; } catch {} await delay(35); }
  throw new Error('Timed out: ' + label);
}
async function freePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(); let sequence = 0;
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', e => { const data = JSON.parse(e.data), task = pending.get(data.id); if (!task) return; pending.delete(data.id); clearTimeout(task.timer); data.error ? task.reject(new Error(JSON.stringify(data.error))) : task.resolve(data.result); });
  socket.addEventListener('close', () => { for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('Owned QA socket closed')); } pending.clear(); });
  return {
    socket,
    send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout ' + method)); }, 15000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); }); },
    async evaluate(expression) { const value = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text); return value.result.value; },
  };
}
async function launch(kind, round, origin) {
  const profile = path.join(output, `${kind}-${round}`), port = await freePort(); fs.mkdirSync(profile);
  const run = { kind, round, profile, port, connections: [], log: '' }; current = run;
  if (kind !== 'chrome') fs.writeFileSync(path.join(profile, 'browser_store.json'), JSON.stringify({ settings: { firstRunCompleted: true, startupBehavior: 'restore', theme: 'noir' }, workspaces: [{ id: 'workspace-default', name: 'work', color: '#ffffff' }], activeWorkspaceId: 'workspace-default', lastExitWasClean: true, history: [], bookmarks: [], session: { tabs: [{ id: 'perf-tab', url: origin + '/light', title: 'fixture', pinned: false, workspaceId: 'workspace-default' }], activeTabId: 'perf-tab' } }));
  const args = [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--no-proxy-server'];
  if (kind === 'chrome') args.push('--no-first-run', '--no-default-browser-check', '--disable-default-apps', '--disable-extensions', '--window-size=1360,880', origin + '/light'); else args.push('--inspect=0');
  const binary = kind === 'chrome' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : path.join(kind === 'null-before' ? beforeApp : afterApp, 'Contents/MacOS/NULL Browser');
  const started = performance.now(); run.process = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [run.process.stdout, run.process.stderr]) stream.on('data', data => { run.log += data; run.inspector ||= run.log.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/)?.[1]; });
  if (kind !== 'chrome') { await waitFor(() => run.inspector, 'owned main inspector'); run.main = await connect(run.inspector); run.connections.push(run.main); }
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page' && x.url === origin + '/light'), 'fixture page');
  run.page = await connect(target.webSocketDebuggerUrl); run.connections.push(run.page);
  await waitFor(() => run.page.evaluate("document.readyState==='complete'"), 'initial fixture');
  run.startupReadyMs = performance.now() - started;
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); run.version = version.Browser;
  if (kind === 'chrome') { run.browser = await connect(version.webSocketDebuggerUrl); run.connections.push(run.browser); }
  else await run.main.evaluate("(()=>{const e=process.mainModule.require('electron'),w=e.BrowserWindow.getAllWindows()[0];e.app.focus({steal:true});w.show();w.moveTop();w.focus();w.contentView.children.find(v=>v.getVisible())?.webContents.focus();return true})()");
  await run.page.send('Page.enable'); await run.page.send('Network.enable'); await run.page.send('Network.setCacheDisabled', { cacheDisabled: true });
  await run.page.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 700, deviceScaleFactor: 1, mobile: false });
  await run.page.send('Page.bringToFront'); await delay(3500); return run;
}
async function stop(run) {
  if (!run) return;
  try { if (run.main) await run.main.evaluate("setTimeout(()=>process.mainModule.require('electron').app.quit(),50);true"); else await run.browser.send('Browser.close'); } catch {}
  await Promise.race([new Promise(r => run.process.exitCode !== null ? r() : run.process.once('exit', r)), delay(3000)]);
  for (const c of run.connections) c.socket.close(); if (run.process.exitCode === null) run.process.kill('SIGTERM');
  fs.writeFileSync(path.join(run.profile, 'process.log'), run.log); if (current === run) current = null;
}
async function navigate(run, origin, page) {
  const url = `${origin}${page}?token=${Math.random().toString(36).slice(2)}`;
  if (run.main) await run.main.evaluate("(()=>{const e=process.mainModule.require('electron'),w=e.BrowserWindow.getAllWindows()[0];e.app.focus({steal:true});w.moveTop();w.focus();w.contentView.children.find(v=>v.getVisible())?.webContents.focus();return true})()");
  await run.page.send('Page.bringToFront'); await run.page.send('Page.navigate', { url });
  await waitFor(() => run.page.evaluate(`location.href===${JSON.stringify(url)}&&document.readyState==='complete'&&performance.getEntriesByType('navigation')[0]?.loadEventEnd>0`), 'load completion');
  return run.page.evaluate("(()=>{const n=performance.getEntriesByType('navigation')[0];return {loadMs:n.loadEventEnd,dclMs:n.domContentLoadedEventEnd,ttfbMs:n.responseStart,resources:performance.getEntriesByType('resource').length,visibility:document.visibilityState}})()");
}
async function main() {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
  results.startedAt = new Date().toISOString();
  for (const [round, kinds] of [[1, ['null-before', 'null-after', 'chrome']], [2, ['chrome', 'null-after', 'null-before']]]) for (const kind of kinds) {
    const run = await launch(kind, round, origin);
    try {
      const record = { kind, round, browser: run.version, startupReadyMs: run.startupReadyMs, pages: {} };
      for (const page of ['/light', '/assets']) {
        for (let i = 0; i < 3; i++) await navigate(run, origin, page);
        const values = []; for (let i = 0; i < samples; i++) { values.push(await navigate(run, origin, page)); await delay(75); }
        if (page === '/assets' && values.some(v => v.resources !== 120)) throw new Error('Fixture resource mismatch');
        record.pages[page] = { samples: values, medianLoadMs: median(values.map(v => v.loadMs)), medianDclMs: median(values.map(v => v.dclMs)), visibleSamples: values.filter(v => v.visibility === 'visible').length };
      }
      results.runs.push(record); console.log(JSON.stringify({ kind, round, browser: run.version, pages: Object.fromEntries(Object.entries(record.pages).map(([key, value]) => [key, { medianLoadMs: value.medianLoadMs, visibleSamples: value.visibleSamples }])) }));
    } finally { await stop(run); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2)); }
  }
  results.summary = Object.fromEntries(['null-before', 'null-after', 'chrome'].map(kind => [kind, Object.fromEntries(['/light', '/assets'].map(page => { const values = results.runs.filter(r => r.kind === kind).flatMap(r => r.pages[page].samples); return [page, { samples: values.length, medianLoadMs: median(values.map(v => v.loadMs)), minMs: Math.min(...values.map(v => v.loadMs)), maxMs: Math.max(...values.map(v => v.loadMs)), visibleSamples: values.filter(v => v.visibility === 'visible').length }]; }))]));
  console.log('NULL_LOADING_BENCHMARK=' + JSON.stringify({ summary: results.summary, resultFile: path.join(output, 'results.json') }));
}
main().catch(error => { console.error(error); results.error = error.stack; process.exitCode = 1; }).finally(async () => { await stop(current); results.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2)); server.closeAllConnections(); server.close(); });
