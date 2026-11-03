import { app, BrowserWindow } from 'electron';
import { TabManager } from '../electron/TabManager';
import { DataManager } from '../electron/DataManager';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const profile = mkdtempSync(join(tmpdir(), 'null-lightweight-qa-'));
app.setPath('userData', profile);
const requests = new Set<string>();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const server = createServer((req, res) => {
  requests.add(req.url!);
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><title>Live fixture</title><link rel="icon" href="data:,"><body><input id="draft"><script>window.keptState="alive"</script>');
});
async function wait(check: () => boolean, label: string) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (check()) return; await delay(10); }
  throw new Error('Timed out: ' + label);
}
app.whenReady().then(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const win = new BrowserWindow({ show: false });
  const manager = new TabManager(win);
  const results: Record<string, boolean> = {};
  const load = async (id: string) => {
    const wc = manager.getTabWebContents(id)!;
    await wait(() => !wc.isLoading() && wc.getURL().startsWith(origin) && requests.has(new URL(wc.getURL()).pathname), id);
  };
  try {
    for (let i = 0; i < 20; i++) manager.createTab(`tab-${i}`, `${origin}/tab-${i}`, false, 'workspace-default', { deferLoad: i > 0 });
    manager.switchTab('tab-0'); await load('tab-0'); await delay(100);
    assert.equal(manager.getTabCount(), 20); assert.equal(win.contentView.children.length, 20);
    assert.deepEqual([...requests], ['/tab-0']);
    results.restoresAllMetadataWithoutBackgroundRequests = true;
    await manager.getTabWebContents('tab-0')!.executeJavaScript('document.querySelector("input").value="unsaved draft"');
    manager.switchTab('tab-1'); await load('tab-1');
    assert.ok(requests.has('/tab-1')); manager.switchTab('tab-0');
    assert.equal(await manager.getTabWebContents('tab-0')!.executeJavaScript('document.querySelector("input").value'), 'unsaved draft');
    results.firstSelectionLoadsAndLiveStateSurvivesSwitch = true;
    let repeatedStatuses = 0;
    const originalSend = win.webContents.send.bind(win.webContents);
    win.webContents.send = ((channel: string, ...args: unknown[]) => {
      if (channel === 'tab:status-updated') repeatedStatuses++;
      originalSend(channel, ...args);
    }) as typeof win.webContents.send;
    for (let i = 0; i < 100; i++) (manager as unknown as { notifyTabStatus(id: string): void }).notifyTabStatus('tab-0');
    assert.equal(repeatedStatuses, 0);
    win.webContents.send = originalSend;
    results.identicalStatusesDoNotCrossIpc = true;
    manager.setSplitView(true, 'tab-2', 0.3); await load('tab-2');
    assert.equal(manager.getTabWebContents('tab-2')!.getURL(), `${origin}/tab-2`);
    results.splitLoadsDeferredSecondary = true;
    manager.setSplitView(false); manager.reload('tab-3'); await load('tab-3');
    results.explicitReloadLoadsDeferredTab = true;
    manager.navigateTab('tab-4', `${origin}/replacement`); await load('tab-4');
    manager.switchTab('tab-4'); await delay(50); assert.ok(!requests.has('/tab-4'));
    results.navigationSupersedesDeferredUrl = true;
    manager.closeTab('tab-5'); await delay(50); assert.ok(!requests.has('/tab-5'));
    results.closeNeverLoadsDeferredTab = true;
    manager.navigateTab('tab-4', 'null://newtab');
    await wait(() => manager.getTabWebContents('tab-4')!.getURL() === 'about:blank', 'release replaced website');
    assert.equal(await manager.getTabWebContents('tab-4')!.executeJavaScript('typeof window.keptState'), 'undefined');
    results.internalPageReleasesPreviousDocument = true;
    manager.createTab('background-user-link', `${origin}/new-user-link`); await load('background-user-link');
    results.newBackgroundLinksStillLoadImmediately = true;
    manager.destroyAll(); assert.equal(win.contentView.children.length, 0);
    results.closeReleasesAllViews = true;

    const data = new DataManager();
    const store = join(profile, 'browser_store.json');
    data.setNotes('baseline'); data.flushSync();
    data.setNotes('async save');
    await delay(650);
    assert.equal(JSON.parse(readFileSync(store, 'utf8')).notes, 'async save');
    results.debouncedAsyncSavePersists = true;
    // Deterministically hold an older disk write across a newer shutdown flush.
    const original = fs.writeFile;
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    fs.writeFile = (async (...args: Parameters<typeof fs.writeFile>) => { await blocked; return original(...args); }) as typeof fs.writeFile;
    data.setNotes('stale async snapshot');
    const pending = (data as unknown as { persistAsync(): Promise<void> }).persistAsync();
    data.setNotes('latest shutdown data'); data.markCleanExit();
    release(); await pending; fs.writeFile = original;
    const latest = JSON.parse(readFileSync(store, 'utf8'));
    assert.equal(latest.notes, 'latest shutdown data'); assert.equal(latest.lastExitWasClean, true);
    assert.equal(new DataManager().getNotes(), 'latest shutdown data');
    results.lateWriteCannotOverwriteShutdownOrRestart = true;
    console.log('NULL_LIGHTWEIGHT_QA=' + JSON.stringify({ ok: true, results, profile }));
  } finally { manager.destroyAll(); win.destroy(); server.closeAllConnections(); server.close(); }
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
