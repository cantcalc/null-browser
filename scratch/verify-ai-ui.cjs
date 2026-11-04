// Runs the real NULL renderer and main process with an isolated profile.
// CDP/inspector are enabled only on this owned QA process, never in product code.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'null-ai-ui-qa-'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
const results = {};
const packaged = process.env.NULL_AI_PACKAGED === 'true';
const launchServices = packaged && process.platform === 'darwin' && process.env.NULL_AI_DIRECT_EXECUTABLE !== 'true';
const mockOSStorage = !launchServices;
const appBundle = process.env.NULL_AI_APP_PATH || path.join(root, 'release/mac-arm64/NULL.app');
fs.mkdirSync(path.join(root,'tmp/ai-qa'),{recursive:true});
if(packaged) require('esbuild').buildSync({absWorkingDir:root,entryPoints:['electron/ai/Vault.ts'],outfile:path.join(root,'tmp/ai-qa/vault-probe.cjs'),bundle:true,platform:'node',format:'cjs',external:['electron']});
let appProcess, main, page, sockets = [], output = '', launches = 0;
async function waitFor(check, message, timeout = 20000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const result = await check();
    if (result) return result;
    await delay(60);
  }
  throw new Error(`Timed out: ${message}`);
}
async function connect(url) {
  const socket = new WebSocket(url); sockets.push(socket);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), task = pending.get(message.id);
    if (!task) return;
    clearTimeout(task.timer); pending.delete(message.id);
    message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result);
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 25000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const data = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (data.exceptionDetails) throw new Error(data.exceptionDetails.exception?.description || data.exceptionDetails.text);
    return data.result.value;
  }
  return { send, evaluate };
}
async function launch() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  let inspector;
  const binary = packaged ? path.join(appBundle, 'Contents/MacOS', fs.existsSync(path.join(appBundle, 'Contents/MacOS/NULL')) ? 'NULL' : 'NULL Browser') : require('electron');
  const flags = [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--inspect=0', '--host-resolver-rules=MAP doubleclick.net 127.0.0.1', '--no-proxy-server'];
  const logfile = path.join(profile, `launch-${++launches}.log`);
  // LaunchServices matches a user's normal macOS launch/security context.
  // Directly spawning an ad-hoc binary from another app can deny Keychain.
  appProcess = launchServices
    ? spawn('/usr/bin/open', ['-n','-W','--stdout',logfile,'--stderr',logfile,appBundle,'--args',...flags], { stdio: ['ignore','pipe','pipe'] })
    : spawn(binary, [...(packaged ? [] : [root]), ...flags], { stdio: ['ignore', 'pipe', 'pipe'] });
  output = '';
  for (const stream of [appProcess.stdout, appProcess.stderr]) stream.on('data', data => {
    output += data.toString();
    inspector ||= output.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/)?.[1];
  });
  await waitFor(() => {
    if(launchServices) { try { output=fs.readFileSync(logfile,'utf8'); inspector ||= output.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/)?.[1]; } catch {} }
    return inspector;
  }, 'inspector');
  main = await connect(inspector);
  await waitFor(() => main.evaluate('!!process.mainModule'), 'main module');
  const target = await waitFor(async () => {
    try { return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes('/dist/index.html')); } catch { return null; }
  }, 'NULL UI');
  page = await connect(target.webSocketDebuggerUrl);
  await waitFor(() => page.evaluate(`!!document.querySelector('button[aria-label="브라우저 설정"]')`), 'toolbar settings button');
  if (!await page.evaluate('window.electronAPI.getSettings().then(s=>s.firstRunCompleted)')) {
    await waitFor(() => page.evaluate(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='건너뛰기')`), 'first run hydrated');
    await page.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='건너뛰기').click(); true`);
    await waitFor(() => page.evaluate(`!Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='건너뛰기')`), 'first run dismissed');
  }
}
async function quit() {
  const closed = appProcess && new Promise(resolve => appProcess.once('exit', resolve));
  await main?.evaluate("setTimeout(()=>process.mainModule.require('electron').app.quit(),50); true").catch(() => {});
  for (const socket of sockets) socket.close(); sockets = [];
  if (closed) await Promise.race([closed, delay(4000)]);
  if (appProcess && appProcess.exitCode === null) appProcess.kill('SIGTERM');
}
const mainWindow = `process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('incognito=1'))`;
const fixture = http.createServer((_req,res) => { res.setHeader('content-type','text/html'); res.end('<!doctype html><title>NULL AI UI fixture</title><h1>Owned article</h1><p>Body text for native view bounds.</p>'); });
async function click(selector) { return page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click();true`); }
async function bounds() {
  const chrome = await page.evaluate(`(()=>{const panel=document.querySelector('[data-ai-sidebar]'),r=panel.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:innerHeight,screenWidth:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,panelOverflow:panel.scrollWidth>panel.clientWidth+1}})()`);
  const native = await main.evaluate(`(()=>{const win=${mainWindow},view=win.contentView.children.find(v=>v.getVisible());return view?view.getBounds():null})()`);
  assert(!chrome.overflow&&!chrome.panelOverflow&&chrome.left>=0&&chrome.right<=chrome.screenWidth+1&&chrome.bottom<=chrome.height+1,'AI panel overflow: '+JSON.stringify(chrome));
  if(native) assert(native.x+native.width<=chrome.left+1||native.x>=chrome.right-1,'AI/native view overlap: '+JSON.stringify({native,chrome}));
  return {chrome,native};
}
async function run() {
  await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${fixture.address().port}`;
  await launch();
  if(packaged) results.realPackagedKeychain=await main.evaluate(`process.mainModule.require(${JSON.stringify(path.join(root,'scratch/probe-ai-vault.cjs'))}).run(${JSON.stringify(path.join(root,'tmp/ai-qa/vault-probe.cjs'))})`);
  if(launchServices) assert(results.realPackagedKeychain?.ok,'Normal macOS launch could not use the actual OS vault');
  await main.evaluate(`process.mainModule.require(${JSON.stringify(path.join(root,'scratch/ai-network-fixture.cjs'))}).install({mockOSStorage:${mockOSStorage}})`);
  const memorySample=()=>main.evaluate("process.mainModule.require('electron').app.getAppMetrics().map(p=>({type:p.type,workingSetKB:p.memory.workingSetSize}))");
  await delay(500); results.memoryBeforeAI=await memorySample();
  assert(await page.evaluate('!document.querySelector("[data-ai-sidebar]")'),'AI not lazy mounted');
  await click('button[aria-label="NULL AI 열기"]');
  await waitFor(()=>page.evaluate('!!document.querySelector("[data-ai-sidebar][data-open=true]")'),'AI open');
  const initial=await page.evaluate('window.electronAPI.aiCommand({op:"state"})');
  assert(initial.ok&&!initial.state.settings.enabled&&initial.state.messages.length===0,'fresh AI is disabled');
  await delay(250); results.memoryAfterAI=await memorySample();
  assert(await page.evaluate('!!Array.from(document.querySelectorAll("[data-ai-sidebar] button")).find(b=>b.textContent==="연결 설정")'),'connection setup entry');
  await page.evaluate(`window.electronAPI.createTab('ai-layout',${JSON.stringify(origin)},false,'workspace-default');window.electronAPI.switchTab('ai-layout');true`);
  await page.evaluate(`window.electronAPI.aiCommand({op:'settings',updates:{enabled:true,dataConsent:true,position:'right',width:360}})`);
  await waitFor(()=>main.evaluate(`${mainWindow}.contentView.children.some(v=>v.webContents.getTitle()==='NULL AI UI fixture'&&!v.webContents.isLoading())`),'native fixture');
  // Direct tab creation does not mutate the renderer's React tabs; use the
  // existing external-open event to make the real App adopt the current page.
  await main.evaluate(`${mainWindow}.webContents.send('tab:open-external',${JSON.stringify(origin)});true`);
  await waitFor(()=>page.evaluate(`document.querySelector('.null-omnibox input').value.includes('127.0.0.1')`),'adopt fixture');
  results.guestBridgeIsolated=await main.evaluate(`${mainWindow}.contentView.children.filter(v=>v.webContents.getURL().startsWith('http')).slice(0,1)[0].webContents.executeJavaScript('typeof window.electronAPI===\"undefined\"')`);
  assert(results.guestBridgeIsolated,'website got privileged chrome API');
  results.layouts=[];
  for(const [width,height] of [[800,600],[1280,720],[1440,900]]) {
    await main.evaluate(`${mainWindow}.setSize(${width},${height});true`);
    for(const position of ['right','left']) {
      await page.evaluate(`window.electronAPI.aiCommand({op:'settings',updates:{position:${JSON.stringify(position)},width:360}})`);
      await delay(220); results.layouts.push({width,height,position,...await bounds()});
    }
  }
  await page.evaluate(`document.querySelector('[role="separator"][aria-label="AI 사이드바 크기 조절"]').focus();true`);
  for(const type of ['keyDown','keyUp'])await page.send('Input.dispatchKeyEvent',{type,key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  await waitFor(()=>page.evaluate('window.electronAPI.aiCommand({op:"state"}).then(r=>r.state.settings.width===380)'),'keyboard resize');
  await click('button[aria-label="AI 사이드바 닫기"]');
  assert(await page.evaluate('getComputedStyle(document.querySelector("[data-ai-sidebar]")).display==="none"'),'close AI');
  await click('button[aria-label="NULL AI 열기"]');
  assert(await page.evaluate('getComputedStyle(document.querySelector("[data-ai-sidebar]")).display!=="none"'),'reopen AI');
  await click('button[aria-label="AI 설정"]');
  await waitFor(()=>page.evaluate('!!document.querySelector("[data-settings-section=ai]")'),'AI settings route');
  assert(await page.evaluate('document.querySelectorAll("[data-settings-section=ai] input[type=password]").length===3'),'provider key forms');
  assert(await page.evaluate('document.querySelectorAll("[data-settings-section=ai] [role=switch]").length>=8'),'switch-based settings');
  assert(await page.evaluate('Array.from(document.querySelectorAll("[data-settings-section=ai] input[type=password]")).every(i=>!i.value&&i.autocomplete==="off")'),'no key reads/fill');
  await main.evaluate(`${mainWindow}.setSize(800,600);true`); await delay(150);
  assert(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'settings overflow at 800');
  const image=await page.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'tmp/ai-qa/ui-settings-dark.png'),Buffer.from(image.data,'base64'));
  await page.evaluate(`window.electronAPI.updateSettings({theme:'paper'})`);
  // Reopen the settings route after React settings are refreshed on restart.
  // Exercise actual UI -> preload -> guarded IPC -> encrypted vault ->
  // provider adapter -> SSE -> delta IPC -> Markdown, with a mock transport.
  const keyField='[data-settings-section=ai] input[aria-label="Groq API 키"]';
  await page.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(keyField)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'null-ui-qa-dummy-key-not-a-real-credential');el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await click('button[aria-label="Groq 무료 요금제 확인"]');
  await page.evaluate(`(()=>{const form=document.querySelector(${JSON.stringify(keyField)}).closest('form');form.requestSubmit();return true})()`);
  await waitFor(()=>page.evaluate(`window.electronAPI.aiCommand({op:'state'}).then(r=>r.state.connections.some(c=>c.provider==='groq'&&c.status==='ready'))`),'UI provider connect');
  assert(await page.evaluate(`!document.querySelector(${JSON.stringify(keyField)}).value`),'API key not cleared after submission');
  const afterConnect=await page.evaluate(`window.electronAPI.aiCommand({op:'state'})`);
  assert(!JSON.stringify(afterConnect).includes('null-ui-qa-dummy-key'),'API key returned to renderer');
  const vaultFile = path.join(profile,'null-ai-vault.json');
  assert(!fs.readFileSync(vaultFile,'utf8').includes('null-ui-qa-dummy-key'),'API key stored in plaintext');
  assert((fs.statSync(vaultFile).mode&0o777)===0o600,'Vault permissions are not private');
  await click('button[aria-label="NULL AI 열기"]');
  await waitFor(()=>page.evaluate('!!document.querySelector("[data-ai-sidebar][data-open=true]")'),'open connected sidebar');
  const message=async value=>{await page.evaluate(`(()=>{const el=document.querySelector('textarea[aria-label="AI 메시지"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);await click('button[aria-label="AI 메시지 전송"]');};
  await message('UI streaming fixture');
  await waitFor(()=>page.evaluate(`!!document.querySelector('[data-ai-task="running"]')`),'UI streaming starts');
  await click('button[aria-label="AI 사이드바 닫기"]');
  await delay(500);await click('button[aria-label="NULL AI 열기"]');
  await waitFor(()=>page.evaluate(`!!document.querySelector('[data-ai-task="done"]')`),'response survived close/reopen');
  assert(await page.evaluate('!!document.querySelector("[data-ai-sidebar] pre code")'),'Markdown code block');
  assert(await page.evaluate('typeof window.__nullAIXSS==="undefined"&&!document.querySelector("[data-ai-sidebar] a[href^=javascript]")'),'AI Markdown XSS');
  await message('slow-fixture');
  await waitFor(()=>page.evaluate(`!!document.querySelector('[data-ai-task="running"]')`),'cancellable UI request');
  await click('button[aria-label="진행 중인 AI 작업 모두 중지"]');
  await waitFor(()=>page.evaluate(`!!document.querySelector('[data-ai-task="cancelled"]')`),'UI stop');
  results.mockUIRoundtrip=await main.evaluate('global.__nullAIQAMetrics()');
  assert(results.mockUIRoundtrip.requests>=2&&results.mockUIRoundtrip.cancelled>=1,'UI request not actually aborted');
  results.markdownSafe=true;results.encryptedKeyForm=true;results.settingsUI=true; results.noStoredConversation=true;
  results.idleMetrics=await main.evaluate("process.mainModule.require('electron').app.getAppMetrics().map(p=>({type:p.type,workingSetKB:p.memory.workingSetSize,cpuPercent:p.cpu.percentCPUUsage}))");
  await page.evaluate('window.electronAPI.newPrivateWindow();true');
  await waitFor(()=>main.evaluate("process.mainModule.require('electron').BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().includes('incognito=1'))"),'private window');
  const privateResult=await main.evaluate(`(async()=>{const e=process.mainModule.require('electron'),w=e.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('incognito=1'));for(let i=0;i<100;i++){try {const r=await w.webContents.executeJavaScript("window.electronAPI&&window.electronAPI.aiCommand({op:'state'})");if(r)return {blocked:!r.ok,button:await w.webContents.executeJavaScript(\"!!document.querySelector('button[aria-label=\\\"NULL AI 열기\\\"]')\")};}catch{}await new Promise(r=>setTimeout(r,30));}return null})()`);
  assert(privateResult?.blocked&&!privateResult.button,'private AI capability leaked');results.privateBlocked=true;
  await quit(); await launch();
  await main.evaluate(`process.mainModule.require(${JSON.stringify(path.join(root,'scratch/ai-network-fixture.cjs'))}).install({mockOSStorage:${mockOSStorage}})`);
  const restored=await page.evaluate('window.electronAPI.aiCommand({op:"state"})');
  assert(restored.state.settings.position==='left'&&restored.state.settings.width===380&&restored.state.settings.enabled,'AI settings persistence');
  assert(restored.state.messages.length===0&&restored.state.tasks.length===0,'conversation persisted across restart');
  const refreshed=await page.evaluate('window.electronAPI.aiCommand({op:"refresh",provider:"groq"})');
  assert(refreshed.ok&&refreshed.state.connections.some(c=>c.provider==='groq'&&c.status==='ready'),'Encrypted API credential did not decrypt after actual process restart');
  results.vaultPersistence={encryptedFile:true,mode:'0600',decryptedAfterRestart:true,realOSStorage:!mockOSStorage};
  await click('button[aria-label="NULL AI 열기"]');
  await waitFor(()=>page.evaluate('!!document.querySelector("[data-ai-sidebar][data-open=true]")'),'AI reopened after restart');
  assert(await page.evaluate('document.documentElement.getAttribute("data-theme")==="paper"'),'light theme');
  const light=await page.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'tmp/ai-qa/ui-light.png'),Buffer.from(light.data,'base64'));
  results.restartPersistence=true;results.ok=true;results.liveAPIKeys=false;results.packaged=packaged;results.profile=profile;results.runtimeLaunch=launchServices?'macOS LaunchServices':'direct executable';
  fs.writeFileSync(path.join(root,`tmp/ai-qa/ui-${packaged?'packaged':'source'}-result.json`),JSON.stringify(results,null,2));
  console.log('AI UI QA passed:',JSON.stringify({layouts:results.layouts.length,privateBlocked:true,restartPersistence:true,packaged,runtimeLaunch:results.runtimeLaunch,mockTransport:true,mockOSStorage,realPackagedKeychain:results.realPackagedKeychain?.ok??'not-probed'}));
}
run().catch(error=>{console.error(String(error));console.error(output.slice(-1800));process.exitCode=1;}).finally(async()=>{await quit();fixture.close();});
