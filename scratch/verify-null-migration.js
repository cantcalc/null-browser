// Owned, temporary-profile migration from the previous installed app to NULL.
// Never attaches to the user's running app or reads their account values.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'null-migration-qa-'));
const oldBinary = '/Applications/Vyro.app/Contents/MacOS/Vyro';
const newBinary = path.join(root, 'release/mac-arm64/NULL.app/Contents/MacOS/NULL');
const delay = ms => new Promise(r => setTimeout(r, ms));
let child, socket, origin;
async function wait(check, label) {
  for (let i = 0; i < 250; i++) { if (await check()) return; await delay(80); }
  throw new Error('Timed out: ' + label);
}
async function launch(binary) {
  let output = '', endpoint;
  child = spawn(binary, [`--user-data-dir=${profile}`, '--inspect=0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
    output += data.toString(); endpoint ||= output.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/)?.[1];
  });
  await wait(() => endpoint, 'owned inspector');
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const pending = new Map(); let id = 0;
  socket.addEventListener('message', event => { const m = JSON.parse(event.data), p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
  const evaluate = async expression => {
    const result = await new Promise((resolve, reject) => {
      const current = ++id, timer = setTimeout(() => { pending.delete(current); reject(Error('Owned QA expression timed out')); }, 20000);
      pending.set(current, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: current, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await wait(() => evaluate("!!process.mainModule&&process.mainModule.require('electron').app.isReady()&&process.mainModule.require('electron').BrowserWindow.getAllWindows().some(w=>!w.webContents.isLoading())"), 'old/new app hydration');
  await evaluate("process.mainModule.require('electron').BrowserWindow.getAllWindows().forEach(w=>w.hide());true");
  return evaluate;
}
async function stop(evaluate) {
  const exited = new Promise(resolve => child.once('exit', resolve));
  await evaluate("setTimeout(()=>process.mainModule.require('electron').app.quit(),30);true");
  socket.close(); await Promise.race([exited, delay(5000)]);
  if (child.exitCode === null) child.kill('SIGTERM');
}
const requests = [];
const server = http.createServer((req, res) => { requests.push(req.headers.cookie || ''); res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Owned migration fixture</title>'); });
async function run() {
  assert(fs.existsSync(oldBinary), 'Previous installed Vyro app is required for this migration check');
  assert(fs.existsSync(newBinary), 'Package NULL before testing migration');
  await new Promise(r => server.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(path.join(profile, 'browser_store.json'), JSON.stringify({ lastExitWasClean: true, settings: { firstRunCompleted: true, theme: 'paper', interfaceStyle: 'studio', startupBehavior: 'restore' }, workspaces: [{ id: 'workspace-default', name: 'work', color: '#aaa' }, { id: 'migration-space', name: 'Second', color: '#bbb' }], activeWorkspaceId: 'workspace-default', legacySessionWorkspaceId: 'workspace-default', session: { tabs: [{ id: 'owned-old', url: 'aero://newtab', title: '새 탭', workspaceId: 'workspace-default' }], activeTabId: 'owned-old' }, bookmarks: [{ id: 'kept-marker', title: 'Owned bookmark', url: origin, createdAt: Date.now() }], history: [{ id: 'kept-history', title: 'Owned history', url: origin, visitedAt: Date.now() }] }));
  const old = await launch(oldBinary);
  const encrypted = await old(`(async()=>{const e=process.mainModule.require('electron'),c=process.mainModule.require('crypto');const s=e.session.fromPartition('persist:aero-workspace-'+c.createHash('sha256').update('migration-space').digest('hex').slice(0,32));for(const [ses,value]of [[e.session.defaultSession,'normal-marker'],[s,'workspace-marker']]){await ses.cookies.set({url:${JSON.stringify(origin)},name:'owned_migration',value,expirationDate:Date.now()/1000+86400});await ses.cookies.flushStore();}return e.safeStorage.encryptString('owned-null-migration-marker').toString('base64');})()`);
  await stop(old);
  const current = await launch(newBinary);
  const actual = await current(`(async()=>{const e=process.mainModule.require('electron'),c=process.mainModule.require('crypto');const s=e.session.fromPartition('persist:aero-workspace-'+c.createHash('sha256').update('migration-space').digest('hex').slice(0,32));const values=[];for(const ses of [e.session.defaultSession,s]){values.push((await ses.cookies.get({url:${JSON.stringify(origin)}})).find(x=>x.name==='owned_migration')?.value);const w=new e.BrowserWindow({show:false,webPreferences:{session:ses}});await w.loadURL(${JSON.stringify(origin)});w.destroy();}return {name:e.app.getName(),profile:e.app.getPath('userData'),values,decrypted:e.safeStorage.decryptString(Buffer.from(${JSON.stringify(encrypted)},'base64'))};})()`);
  assert.equal(actual.name, 'NULL'); assert.equal(actual.profile, profile);
  assert.deepEqual(actual.values, ['normal-marker', 'workspace-marker']);
  assert.equal(actual.decrypted, 'owned-null-migration-marker');
  assert(requests.some(s => s.includes('normal-marker')) && requests.some(s => s.includes('workspace-marker')), 'Persisted cookies did not reach actual requests');
  await stop(current);
  const store = JSON.parse(fs.readFileSync(path.join(profile, 'browser_store.json'), 'utf8'));
  assert(store.bookmarks.some(x => x.id === 'kept-marker')); assert(store.history.some(x => x.id === 'kept-history'));
  assert.equal(store.workspaces.length, 2); assert.equal(store.settings.homeStyle, 'center');
  assert.equal(store.session.tabs[0].url, 'null://newtab');
  const result = { ok: true, normalCookieRestore: true, workspaceCookieRestore: true, realRequests: true, encryptionIdentityPreserved: true, bookmarksHistoryWorkspacesPreserved: true, legacyRouteMigrated: true, name: actual.name, profile };
  fs.writeFileSync(path.join(profile, 'migration-result.json'), JSON.stringify(result, null, 2));
  console.log('NULL_MIGRATION_QA=' + JSON.stringify(result));
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { socket?.close(); if (child?.exitCode === null) child.kill('SIGTERM'); server.close(); });
