// Runs the real NULL renderer and main process with an isolated profile.
// CDP/inspector are enabled only on this owned QA process, never in product code.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'null-downloads-ui-qa-'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
const results = {};
const packaged = process.env.NULL_DOWNLOADS_PACKAGED === 'true';
const launchServices = packaged && process.platform === 'darwin' && process.env.NULL_AI_DIRECT_EXECUTABLE !== 'true';
const mockOSStorage = !launchServices;
const appBundle = process.env.NULL_AI_APP_PATH || path.join(root, 'release/mac-arm64/NULL.app');
fs.mkdirSync(path.join(root,'tmp/ai-qa'),{recursive:true});

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

const downloadDir=path.join(profile,'download-fixtures'); fs.mkdirSync(downloadDir);
const fixture=http.createServer((req,res)=>{
  const kind=new URL(req.url,'http://fixture').pathname;
  if(kind==='/') {res.setHeader('content-type','text/html');res.end('<title>Download fixture</title><h1>Download fixture</h1><a id="complete" href="/complete" download>Complete</a><a id="slow" href="/slow" download>Slow</a><a id="broken" href="/broken" download>Broken</a>');return;}
  res.setHeader('content-type','application/octet-stream');res.setHeader('content-disposition',`attachment; filename="qa-${kind.slice(1)}.bin"`);
  if(kind==='/complete'){res.setHeader('content-length',131072);res.end(Buffer.alloc(131072,42));return;}
  res.setHeader('content-length',4*1024*1024); let sent=0;
  const timer=setInterval(()=>{res.write(Buffer.alloc(32768,17));sent+=32768;if(kind==='/broken'&&sent>=65536){clearInterval(timer);res.destroy();}else if(sent>=4*1024*1024){clearInterval(timer);res.end();}},100);
  res.on('close',()=>clearInterval(timer));
});
async function click(selector){return page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click();true`);}
const guest=`${mainWindow}.contentView.children.find(v=>v.webContents.getTitle()==='Download fixture').webContents`;
async function download(kind){await main.evaluate(`${guest}.executeJavaScript(${JSON.stringify(`document.querySelector('#${kind}').click();true`)},true)`);}
async function downloads(){return page.evaluate('window.electronAPI.getDownloads()');}
async function record(name,state){return waitFor(async()=>{const items=await downloads();return items.find(i=>i.filename===name&&i.state===state);},`${name} ${state}`);}
async function interceptOS(){await main.evaluate(`(()=>{const e=process.mainModule.require('electron');global.__nullDownloadCalls=[];e.shell.openPath=async path=>{global.__nullDownloadCalls.push(['open',path]);return ''};e.shell.showItemInFolder=path=>global.__nullDownloadCalls.push(['finder',path]);return true})()`);}
async function run(){
  await new Promise(r=>fixture.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${fixture.address().port}`;
  await launch();await page.evaluate(`window.electronAPI.updateSettings({downloadPath:${JSON.stringify(downloadDir)},askDownloadLocation:false,startupMode:'restore'})`);
  await main.evaluate(`${mainWindow}.webContents.send('tab:open-external',${JSON.stringify(origin)});true`);
  await waitFor(()=>main.evaluate(`${mainWindow}.contentView.children.some(v=>v.webContents.getTitle()==='Download fixture'&&!v.webContents.isLoading())`),'fixture native view');
  await download('slow');await record('qa-slow.bin','progressing');
  await waitFor(()=>page.evaluate(`document.querySelector('button[aria-label="다운로드 기록"]').dataset.downloadState==='progressing'`),'toolbar activity');
  await click('button[aria-label="다운로드 기록"]');
  await waitFor(()=>page.evaluate(`!!document.querySelector('aside[data-aside-mode="downloads"] [role="progressbar"]')`),'progress display');
  await waitFor(()=>page.evaluate(`Number(document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'))>0`),'nonzero progress');
  results.realProgress=true;results.layouts=[];
  for(const theme of ['noir','paper']){
    await page.evaluate(`window.electronAPI.updateSettings({theme:${JSON.stringify(theme)}})`);
    // Theme updates are broadcast by the main process to the live renderer.
    for(const [width,height] of [[800,600],[1280,720]]){
      await main.evaluate(`${mainWindow}.setSize(${width},${height});true`);
      await waitFor(()=>page.evaluate(`innerWidth===${width}&&innerHeight===${height}`),'actual download viewport resize');await delay(150);
      const bounds=await page.evaluate(`(()=>{const panel=document.querySelector('aside[data-aside-mode="downloads"]'),r=panel.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1,panelOverflow:panel.scrollWidth>panel.clientWidth+1}})()`);
      const view=await main.evaluate(`${mainWindow}.contentView.children.find(v=>v.getVisible())?.getBounds()`);
      assert(!bounds.overflow&&!bounds.panelOverflow&&bounds.right<=bounds.width+1&&bounds.bottom<=bounds.height+1,'Download panel overflow');
      assert(view&&view.x+view.width<=bounds.left+1,'Download panel covers webpage');results.layouts.push({theme,width,height,bounds,view});
    }
  }
  await page.evaluate(`Array.from(document.querySelectorAll('aside button')).find(b=>b.textContent.trim()==='취소').click();true`);
  await record('qa-slow.bin','cancelled');results.cancel=true;
  await download('complete');const complete=await record('qa-complete.bin','completed');
  assert(fs.readFileSync(complete.savePath).equals(Buffer.alloc(131072,42)),'Downloaded bytes mismatch');
  await waitFor(()=>page.evaluate(`Array.from(document.querySelectorAll('[data-download-id]')).some(r=>r.textContent.includes('qa-complete.bin')&&r.textContent.includes('완료'))`),'complete row');
  results.completeBytes=true;
  await download('broken');await record('qa-broken.bin','interrupted');results.interrupted=true;
  await click('button[aria-label="유틸리티 패널 닫기"]');
  await page.evaluate('window.electronAPI.newPrivateWindow();true');
  const privateWin=`process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('incognito=1'))`;
  await waitFor(()=>main.evaluate(`${privateWin}?.webContents.executeJavaScript('Boolean(window.electronAPI)').catch(()=>false)`),'private renderer');
  const privateDownloads=await main.evaluate(`${privateWin}.webContents.executeJavaScript('window.electronAPI.getDownloads()')`);assert(privateDownloads.length===0,'Normal download history leaked into private');
  await interceptOS();await main.evaluate(`${privateWin}.webContents.executeJavaScript(${JSON.stringify(`window.electronAPI.openDownload(${JSON.stringify(complete.id)});window.electronAPI.showInFinder(${JSON.stringify(complete.id)});true`)})`);
  await delay(200);assert((await main.evaluate('global.__nullDownloadCalls')).length===0,'Private opened normal download');results.privateIsolation=true;
  await quit();await launch();
  const restored=await downloads();assert(restored.some(i=>i.id===complete.id&&i.state==='completed'),'History lost after restart');results.restartHistory=true;
  await click('button[aria-label="다운로드 기록"]');await interceptOS();
  await page.evaluate(`(()=>{const row=document.querySelector('[data-download-id=${JSON.stringify(complete.id)}]');Array.from(row.querySelectorAll('button')).find(b=>b.textContent.trim()==='열기').click();Array.from(row.querySelectorAll('button')).find(b=>b.textContent.includes('Finder')).click();return true})()`);
  await waitFor(async()=> (await main.evaluate('global.__nullDownloadCalls')).length===2,'persisted file actions');
  const calls=await main.evaluate('global.__nullDownloadCalls');assert(calls.every(call=>call[1]===complete.savePath),'Restored file path not resolved from saved history');results.restoredOpenFinder=true;
  await click(`button[aria-label="qa-complete.bin 다운로드 기록 삭제"]`);
  await waitFor(async()=>!(await downloads()).some(i=>i.id===complete.id),'remove record');assert(fs.existsSync(complete.savePath),'Removing record deleted actual file');results.removeKeepsFile=true;
  const image=await page.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'tmp/ai-qa/downloads-ui.png'),Buffer.from(image.data,'base64'));
  await quit();await launch();assert(!(await downloads()).some(i=>i.id===complete.id),'Removed history reappeared after restart');results.removalPersists=true;
  results.ok=true;results.packaged=packaged;results.shellActionsIntercepted=true;
  fs.writeFileSync(path.join(root,`tmp/ai-qa/downloads-${packaged?'packaged':'source'}-result.json`),JSON.stringify(results,null,2));console.log('DOWNLOAD UI QA PASS',JSON.stringify(results));
}
run().catch(error=>{console.error(String(error));console.error(output.slice(-1800));process.exitCode=1;}).finally(async()=>{await quit();fixture.closeAllConnections();fixture.close();});
