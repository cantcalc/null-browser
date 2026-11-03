import { app, BrowserWindow, session, type Session } from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { CookiePolicyManager } from '../electron/CookiePolicyManager';

const profile = mkdtempSync(join(tmpdir(), 'null-policy-perf-'));
app.setPath('userData', profile);
app.on('window-all-closed', event => event.preventDefault());
const results: Record<string, unknown> = {};
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type Policy = { cookiePolicy: 'allow' | 'block-third-party'; cookieExceptions: Record<string, 'allow' | 'block'> };
function fakeSession() {
  const calls: { event: string; filter: unknown; listener: any }[] = [];
  const ses = { webRequest: {
    onBeforeSendHeaders: (filter: unknown, listener?: unknown) => calls.push({ event: 'request', filter: listener ? filter : null, listener: listener || null }),
    onHeadersReceived: (filter: unknown, listener?: unknown) => calls.push({ event: 'response', filter: listener ? filter : null, listener: listener || null }),
  } } as unknown as Session;
  return { ses, calls };
}
function legacyDecision(settings: Policy, url: string, first?: string) {
  const site = (hostname: string) => {
    const name = hostname.toLowerCase().replace(/^\.|\.$/g, '');
    if (!name || name === 'localhost' || /^\d+(?:\.\d+){3}$/.test(name) || name.includes(':')) return name;
    const labels = name.split('.').filter(Boolean);
    return labels.length > 2 ? labels.slice(-2).join('.') : name;
  };
  try {
    const target = new URL(url), explicit = settings.cookieExceptions[target.origin];
    if (explicit) return explicit;
    if (settings.cookiePolicy !== 'block-third-party' || !first) return 'allow';
    const firstParty = new URL(first);
    if (settings.cookieExceptions[firstParty.origin] === 'allow') return 'allow';
    return site(target.hostname) === site(firstParty.hostname) ? 'allow' : 'block';
  } catch { return 'allow'; }
}
function unitTests() {
  const a = fakeSession(), b = fakeSession();
  const manager = new CookiePolicyManager({ cookiePolicy: 'allow', cookieExceptions: {} });
  manager.attach(a.ses); manager.attach(a.ses); manager.attach(b.ses);
  assert.equal(a.calls.length + b.calls.length, 0, 'default allow still intercepts resources');
  manager.update({ cookiePolicy: 'allow', cookieExceptions: { 'https://ok.test': 'allow' } });
  assert.equal(a.calls.length, 0, 'allow-only exception installed blocking callbacks');
  const exceptions: Policy['cookieExceptions'] = { 'https://blocked.test': 'block', 'https://ok.test': 'allow' };
  manager.update({ cookiePolicy: 'allow', cookieExceptions: exceptions });
  assert.deepEqual(a.calls.at(-1)?.filter, { urls: ['https://blocked.test/*'] });
  assert.equal(b.calls.length, 2, 'already-open private/normal session not refreshed');
  const before = a.calls.length;
  manager.update({ cookiePolicy: 'allow', cookieExceptions: { 'https://ok.test': 'allow', 'https://blocked.test': 'block' } });
  assert.equal(a.calls.length, before, 'equivalent policy reinstalled callbacks');
  exceptions['https://blocked.test'] = 'allow';
  assert.equal(manager.decision('https://blocked.test/image', 'https://ok.test'), 'block', 'policy retained mutable caller reference');
  const request = a.calls.findLast(call => call.event === 'request')!.listener;
  const response = a.calls.findLast(call => call.event === 'response')!.listener;
  let answer: any;
  const headers = { cOoKiE: 'private=1', Accept: 'image/png' };
  request({ url: 'https://blocked.test/a', referrer: 'https://ok.test', requestHeaders: headers }, (value: unknown) => { answer = value; });
  assert.deepEqual(answer.requestHeaders, { Accept: 'image/png' }); assert.ok(headers.cOoKiE, 'request headers mutated');
  response({ url: 'https://blocked.test/a', referrer: '', responseHeaders: { 'SeT-CoOkIe': ['a=1'], 'set-cookie2': ['b=2'], ETag: ['a'] } }, (value: unknown) => { answer = value; });
  assert.deepEqual(answer.responseHeaders, { ETag: ['a'] });
  manager.update({ cookiePolicy: 'block-third-party', cookieExceptions: {} });
  assert.deepEqual(a.calls.at(-1)?.filter, { urls: ['http://*/*', 'https://*/*'] });
  manager.detach(b.ses); const afterDetach = b.calls.length;
  manager.update({ cookiePolicy: 'allow', cookieExceptions: {} });
  assert.equal(a.calls.at(-1)?.listener, null, 'allow reset did not remove owned hooks');
  assert.equal(b.calls.length, afterDetach, 'closed private session retained');
  manager.detach(a.ses);

  const urls = ['https://a.example.com/image', 'https://b.example.com', 'https://other.test/', 'http://localhost:321/a', 'http://127.0.0.1:321/a', 'http://[::1]:321/a', 'https://example.co.uk', 'invalid'];
  const policies: Policy[] = [];
  for (const cookiePolicy of ['allow', 'block-third-party'] as const) {
    policies.push({ cookiePolicy, cookieExceptions: {} });
    for (const url of urls.filter(url => url !== 'invalid')) for (const decision of ['allow', 'block'] as const) {
      policies.push({ cookiePolicy, cookieExceptions: { [new URL(url).origin]: decision } });
    }
  }
  let checked = 0;
  for (const policy of policies) {
    const candidate = new CookiePolicyManager(policy);
    for (const url of urls) for (const first of [undefined, ...urls]) {
      assert.equal(candidate.decision(url, first), legacyDecision(policy, url, first)); checked++;
    }
  }
  results.unit = { equivalentDecisions: checked, defaultNoInterception: true, allowOnlyNoInterception: true, narrowBlockFilter: true, snapshotIsolation: true, headerRemoval: true, liveSessionsRefresh: true, privateCleanup: true };
}
async function networkTests() {
  const requests: { path: string; cookie: string }[] = [];
  const server = createServer((req, res) => {
    requests.push({ path: req.url || '/', cookie: req.headers.cookie || '' });
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store', 'set-cookie': 'from_response=received; Path=/; SameSite=Lax' });
    res.end('<!doctype html><head><title>Cookie fixture</title></head><body>Cookie fixture</body>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const ses = session.fromPartition('policy-performance-network');
  const other = session.fromPartition('policy-performance-private');
  const manager = new CookiePolicyManager({ cookiePolicy: 'allow', cookieExceptions: {} });
  manager.attach(ses); manager.attach(other);
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true } });
  const privateWin = new BrowserWindow({ show: false, webPreferences: { session: other, sandbox: true } });
  const cookie = async (target: Session, name: string) => (await target.cookies.get({ url: origin, name })).length > 0;
  try {
    await ses.cookies.set({ url: origin, name: 'send_cookie', value: 'normal' });
    await other.cookies.set({ url: origin, name: 'send_cookie', value: 'private' });
    await win.loadURL(origin + '/allowed');
    await delay(80);
    assert.ok(requests.find(x => x.path === '/allowed')?.cookie.includes('send_cookie=normal'));
    assert.ok(await cookie(ses, 'from_response'));
    await ses.cookies.remove(origin, 'from_response');
    manager.update({ cookiePolicy: 'allow', cookieExceptions: { [origin]: 'block' } });
    await win.loadURL(origin + '/blocked'); await privateWin.loadURL(origin + '/private-blocked'); await delay(80);
    assert.equal(requests.find(x => x.path === '/blocked')?.cookie, '');
    assert.equal(requests.find(x => x.path === '/private-blocked')?.cookie, '');
    assert.equal(await cookie(ses, 'from_response'), false);
    assert.equal(await cookie(other, 'from_response'), false);
    manager.update({ cookiePolicy: 'block-third-party', cookieExceptions: {} });
    await win.loadURL(origin + '/first-party'); await delay(80);
    assert.ok(requests.find(x => x.path === '/first-party')?.cookie.includes('send_cookie=normal'));
    manager.update({ cookiePolicy: 'allow', cookieExceptions: {} });
    await win.loadURL(origin + '/restored'); await privateWin.loadURL(origin + '/private-restored'); await delay(80);
    assert.ok(requests.find(x => x.path === '/restored')?.cookie.includes('send_cookie=normal'));
    assert.ok(requests.find(x => x.path === '/private-restored')?.cookie.includes('send_cookie=private'));
    assert.ok(await cookie(ses, 'from_response'));
    results.network = { defaultSendAndReceive: true, blockSendAndReceive: true, alreadyOpenPrivatePolicy: true, thirdPartyModeKeepsFirstParty: true, allowRestoredWithoutRestart: true, privateCookieIsolation: true };
  } finally {
    manager.detach(ses); manager.detach(other); win.destroy(); privateWin.destroy();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
app.whenReady().then(async () => {
  try { unitTests(); await networkTests(); console.log('NULL_PERFORMANCE_POLICY_QA=' + JSON.stringify({ ok: true, results, profile })); }
  catch (error) { console.error(error); process.exitCode = 1; }
  finally { app.quit(); }
});
