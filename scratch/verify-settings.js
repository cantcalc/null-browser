// Runs the real NULL renderer and main process with an isolated profile.
// CDP/inspector are enabled only on this owned QA process, never in product code.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'null-settings-qa-'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
const results = {};
const packaged = process.env.NULL_SETTINGS_PACKAGED === 'true';
const appBundle = process.env.NULL_SETTINGS_APP_PATH || path.join(root, 'release/mac-arm64/NULL.app');
let appProcess, main, page, sockets = [], output = '';
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
  appProcess = spawn(binary, [...(packaged ? [] : [root]), `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--inspect=0', '--host-resolver-rules=MAP doubleclick.net 127.0.0.1', '--no-proxy-server'], { stdio: ['ignore', 'pipe', 'pipe'] });
  output = '';
  for (const stream of [appProcess.stdout, appProcess.stderr]) stream.on('data', data => {
    output += data.toString();
    inspector ||= output.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/)?.[1];
  });
  await waitFor(() => inspector, 'inspector');
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
async function category(id) {
  await page.evaluate(`document.querySelector('[data-settings-nav="${id}"]').click(); true`);
  await waitFor(() => page.evaluate(`!!document.querySelector('[data-settings-section="${id}"]')`), `category ${id}`);
}
async function screenshot(name) {
  await delay(160);
  const image = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(profile, `${name}.png`), Buffer.from(image.data, 'base64'));
}
async function checkLayout() {
  const result = await page.evaluate(`(()=>{
    const screen=document.querySelector('.null-settings-page'), header=document.querySelector('.null-connected-chrome');
    const r=screen.getBoundingClientRect(), footer=document.querySelector('.null-settings-savebar').getBoundingClientRect();
    const scroll=document.querySelector('.null-settings-scroll');
    const switchIssues=Array.from(screen.querySelectorAll('[role="switch"]')).flatMap(button=>{
      const track=button.getBoundingClientRect(),thumb=button.querySelector('.null-switch-thumb').getBoundingClientRect();
      const text=Array.from(button.parentElement.children).find(child=>child.tagName==='SPAN'&&!child.classList.contains('null-switch-thumb'));
      const tr=text?.getBoundingClientRect();
      const collision=tr&&track.left<tr.right&&track.right>tr.left&&track.top<tr.bottom&&track.bottom>tr.top;
      return track.width!==38||track.height!==22||thumb.left<track.left||thumb.right>track.right||thumb.top<track.top||thumb.bottom>track.bottom||collision||!button.getAttribute('aria-label')?[button.getAttribute('aria-label')]:[];
    });
    return {width:innerWidth,height:innerHeight,top:r.top,chromeBottom:header.getBoundingClientRect().bottom,switchIssues,
      pageOverflow:document.documentElement.scrollWidth>innerWidth+1,contentOverflow:scroll.scrollWidth>scroll.clientWidth+1,
      footerVisible:footer.bottom<=innerHeight+1 && footer.top>=r.top};
  })()`);
  assert(!result.pageOverflow && !result.contentOverflow && result.footerVisible && result.top >= result.chromeBottom - 1, `Invalid layout ${JSON.stringify(result)}`);
  assert(result.switchIssues.length===0,`Switch/label collision: ${JSON.stringify(result)}`);
  return result;
}
const mainWindow = `process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/dist/index.html'))`;
async function fill(selector,text) {
  await page.evaluate(`(()=>{const field=document.querySelector(${JSON.stringify(selector)});field.focus();field.select();return true})()`);
  await page.send('Input.insertText',{text});
}
async function select(selector,value) {
  await page.evaluate(`(()=>{const field=document.querySelector(${JSON.stringify(selector)});field.value=${JSON.stringify(value)};field.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
}
async function verifySitePolish(origin,guest) {
  await main.evaluate(`${mainWindow}.setSize(800,600);true`);
  await page.evaluate(`document.querySelector('button[aria-label="사이트 정보"]').click();true`);
  await waitFor(()=>page.evaluate(`!!document.querySelector('[data-site-inspector]')`),'site inspector');
  await delay(400);
  const panel=await page.evaluate(`(()=>{const panel=document.querySelector('[data-site-inspector]'),r=panel.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:panel.scrollWidth>panel.clientWidth+1}})()`);
  const native=await main.evaluate(`(()=>{const guest=${guest};const view=${mainWindow}.contentView.children.find(view=>view.webContents===guest);return {visible:view.getVisible(),...view.getBounds()}})()`);
  assert(native.visible&&native.x+native.width<=panel.left+1&&!panel.overflow&&panel.right<=panel.width+1&&panel.bottom<=panel.height+1,'inspector overlaps or hides native content: '+JSON.stringify({native,panel}));
  await main.evaluate(`(${guest}).executeJavaScript("document.getElementById('click-test').getBoundingClientRect().toJSON()").then(rect=>{(${guest}).sendInputEvent({type:'mouseDown',x:Math.round(rect.x+5),y:Math.round(rect.y+5),button:'left',clickCount:1});(${guest}).sendInputEvent({type:'mouseUp',x:Math.round(rect.x+5),y:Math.round(rect.y+5),button:'left',clickCount:1});return true})`);
  await waitFor(()=>main.evaluate(`(${guest}).executeJavaScript('window.clickCount===1')`),'page remains clickable with inspector');
  const nativeImage=await main.evaluate(`(${guest}).capturePage().then(image=>image.toPNG().toString('base64'))`);
  fs.writeFileSync(path.join(profile,'native-page-with-inspector.png'),Buffer.from(nativeImage,'base64'));
  results.inspectorReservesSpaceAndPageUsable800 = true;
  await select('[data-site-inspector] select[aria-label="알림 권한"]','allow');
  await waitFor(()=>page.evaluate(`window.electronAPI.getSitePermissions(${JSON.stringify(origin)}).then(p=>p.notifications==='allow')`),'inspector permission persisted');
  const capture=await main.evaluate(`${mainWindow}.capturePage().then(image=>image.toPNG().toString('base64'))`);
  fs.writeFileSync(path.join(profile,'site-inspector-800x600.png'),Buffer.from(capture,'base64'));
  await page.evaluate(`document.querySelector('.null-inspector-settings').click();true`);
  await waitFor(()=>page.evaluate(`!!document.querySelector('[data-site-settings] [aria-expanded="true"]')`),'inspector opens correct settings site');
  assert(await page.evaluate(`!document.querySelector('[data-site-inspector]')`),'inspector overlays settings');
  await checkLayout();
  const selector=`[data-site-origin=${JSON.stringify(origin)}] select[aria-label$=" 알림 권한"]`;
  await select(selector,'deny');
  await waitFor(()=>page.evaluate(`window.electronAPI.getSitePermissions(${JSON.stringify(origin)}).then(p=>p.notifications==='deny')`),'settings permission persisted');
  // A false IPC result must produce a visible error, not success.
  await main.evaluate(`(()=>{const ipc=process.mainModule.require('electron').ipcMain;globalThis.__permissionQaHandler=ipc._invokeHandlers.get('site:setPermission');ipc.removeHandler('site:setPermission');ipc.handle('site:setPermission',()=>false);return true})()`);
  await select(selector,'allow');
  await waitFor(()=>page.evaluate(`!!document.querySelector('[data-site-settings] [role="alert"]')`),'permission rejection surfaced');
  assert(await page.evaluate(`window.electronAPI.getSitePermissions(${JSON.stringify(origin)}).then(p=>p.notifications==='deny')`),'failed permission overwrote saved decision');
  await main.evaluate(`(()=>{const ipc=process.mainModule.require('electron').ipcMain;ipc.removeHandler('site:setPermission');ipc.handle('site:setPermission',globalThis.__permissionQaHandler);return true})()`);
  await page.evaluate(`document.querySelector('[data-site-origin='+CSS.escape(${JSON.stringify(origin)})+'] .null-site-entry-footer button').click();true`);
  await waitFor(()=>page.evaluate(`window.electronAPI.getSitePermissions(${JSON.stringify(origin)}).then(p=>!Object.keys(p).length)`),'permission reset');
  assert(await page.evaluate(`!!document.querySelector('[data-site-settings] [aria-expanded="true"]')`),'reset lost selected site');
  results.sitePermissionSyncFailureAndReset = true;
  await page.evaluate(`document.querySelector('[data-site-section="cookies"]').click();true`);
  await page.evaluate(`document.querySelector('[role="switch"][aria-label="서드파티 쿠키 차단"]').click();true`);
  assert(await page.evaluate(`window.electronAPI.getSettings().then(s=>s.cookiePolicy==='allow')`),'cookie draft unexpectedly persisted');
  await fill('input[aria-label="쿠키 예외 사이트 주소"]','not a website');
  await page.evaluate(`document.querySelector('.null-cookie-form button').click();true`);
  await waitFor(()=>page.evaluate(`document.querySelector('[data-site-settings] [role="alert"]')?.textContent.includes('올바른')`),'invalid cookie URL explained');
  await fill('input[aria-label="쿠키 예외 사이트 주소"]',origin+'/path');
  await page.evaluate(`document.querySelector('.null-cookie-form button').click();true`);
  await page.evaluate(`document.querySelector('.null-settings-save-actions .null-primary-button').click();true`);
  await waitFor(()=>page.evaluate(`window.electronAPI.getSettings().then(s=>s.cookiePolicy==='block-third-party'&&s.cookieExceptions[${JSON.stringify(origin)}]==='allow')`),'cookie policy and normalized exception saved');
  await checkLayout();await screenshot('sites-cookies-800x600');
  results.cookieSwitchDraftValidationAndSave = true;
  await page.evaluate(`document.querySelector('[data-site-section="data"]').click();true`);
  const deleteSelector=`button[aria-label=${JSON.stringify(origin+' 저장 데이터 삭제')}]`;
  await waitFor(()=>page.evaluate(`!!document.querySelector(${JSON.stringify(deleteSelector)})`),'cookie-bearing fixture in site data');
  await main.evaluate(`(${guest}).executeJavaScript("localStorage.setItem('null-polish-test','keep');true")`);
  await page.evaluate(`document.querySelector(${JSON.stringify(deleteSelector)}).click();true`);
  assert(await page.evaluate(`!!document.querySelector('.null-site-confirm')&&!document.querySelector('.null-overlay')`),'data confirmation is obscuring modal');
  await page.evaluate(`Array.from(document.querySelectorAll('.null-site-confirm button')).find(button=>button.textContent==='삭제').click();true`);
  await waitFor(()=>main.evaluate(`(${guest}).executeJavaScript("localStorage.getItem('null-polish-test')===null&&!document.cookie.includes('null_redesign=')")`),'exact origin data cleared');
  results.inlineSiteDataConfirmationAndClear = true;
  await main.evaluate(`${mainWindow}.setSize(1440,900);true`);
  await category('about');await checkLayout();await screenshot('about-unified-logo');
  assert(await page.evaluate(`document.querySelectorAll('[data-null-logo="null-monochrome"]').length>=2&&new Set(Array.from(document.querySelectorAll('[data-null-logo]')).map(img=>img.src)).size===1`),'logos differ inside settings');
  results.unifiedAboutAndSettingsLogo = true;
}
async function verifyRemovedFeatures() {
  const removedApis = ['getAdBlockStats','toggleAdBlock','onAdBlocked','translateText','translateBatch','translateTab','onTranslateActive','onSelectionTranslate'];
  assert(await page.evaluate(`(${JSON.stringify(removedApis)}).every(key=>!(key in window.electronAPI))`), 'removed API is exposed');
  const removedChannels = ['adblock:getStats','adblock:toggle','translate:text','translate:batch','tab:translate'];
  assert(await main.evaluate(`(${JSON.stringify(removedChannels)}).every(key=>!process.mainModule.require('electron').ipcMain._invokeHandlers.has(key))`), 'removed IPC handler remains');
  assert(await main.evaluate(`(()=>{const labels=[];function visit(menu){for(const item of menu.items){labels.push(item.label||'');if(item.submenu)visit(item.submenu)}}visit(process.mainModule.require('electron').Menu.getApplicationMenu());return !labels.some(label=>/번역|팔레트/.test(label))})()`), 'removed native menu remains');
  const count = await page.evaluate(`document.querySelectorAll('[data-tab-id]').length`);
  await page.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true,bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'t',metaKey:true,altKey:true,bubbles:true}));true`);
  assert(await page.evaluate(`!document.querySelector('.command-palette-overlay')&&document.querySelectorAll('[data-tab-id]').length===${count}`), 'removed shortcut still changes browser UI');
  for (const id of ['privacy','shortcuts']) {
    await category(id);
    assert(await page.evaluate(`!(/번역|팔레트|광고 및 추적 호스트 차단/.test(document.querySelector('[data-settings-section]').innerText))`), 'removed settings UI remains');
  }
  results.removedUiApisMenusAndShortcuts = true;

  await page.evaluate(`document.querySelector('button[title="서랍 패널 토글 (메모/다운로드)"]').click();true`);
  await waitFor(()=>page.evaluate(`!!document.querySelector('.null-aside textarea')`),'notes panel');
  assert(await page.evaluate(`!document.querySelector('.null-aside').innerText.includes('번역')`),'translation panel remains');
  await page.evaluate(`Array.from(document.querySelectorAll('.null-aside button')).find(b=>b.textContent.trim()==='다운로드').click();true`);
  assert(await page.evaluate(`document.querySelector('.null-aside').innerText.includes('다운로드 내역')`),'downloads panel lost');
  await page.evaluate(`document.querySelector('button[title="Aside 패널 닫기"]').click();true`);
  results.notesDownloadsPreserved = true;

  const hits = [];
  const fixture = http.createServer((request,response)=>{
    hits.push({host:request.headers.host,path:request.url});
    if (request.url==='/prebid.js'||request.url==='/adserver.js') {
      response.writeHead(200,{'content-type':'text/javascript'});
      response.end(request.url==='/prebid.js'?'window.prebidLoaded=true':'window.adHostLoaded=true');return;
    }
    response.writeHead(200,{'content-type':'text/html;charset=utf-8','cache-control':'no-store','set-cookie':'null_redesign=1; Path=/; SameSite=Lax'});
    response.end(`<!doctype html><html><head><title>Feature removal fixture</title><link rel="icon" href="data:,"></head><body><h1 id="text">Hello world selected text</h1><button id="click-test" onclick="window.clickCount=(window.clickCount||0)+1">Page click test</button><script src="/prebid.js"></script><script src="http://doubleclick.net:${fixture.address().port}/adserver.js"></script></body></html>`);
  });
  await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${fixture.address().port}`;
  const guest=`${mainWindow}.contentView.children.map(view=>view.webContents).find(contents=>contents?.getURL().startsWith(${JSON.stringify(origin)}))`;
  try {
    await page.evaluate(`const field=document.querySelector('input[aria-label="검색 또는 URL"]');field.focus();field.select();true`);
    await page.send('Input.insertText',{text:origin});
    await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});
    await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await waitFor(()=>main.evaluate(`!!(${guest}) && (${guest}).executeJavaScript('window.prebidLoaded===true&&window.adHostLoaded===true')`),'formerly blocked requests',15000);
    assert(hits.some(hit=>hit.path==='/prebid.js')&&hits.some(hit=>hit.host.startsWith('doubleclick.net:')&&hit.path==='/adserver.js'),'ad fixture requests did not reach server');
    results.adHostAndPathRequestsAllowed = true;
    await main.evaluate(`(${guest}).executeJavaScript("(()=>{const range=document.createRange();range.selectNodeContents(document.getElementById('text'));const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:100,clientY:60}));return true})()")`);
    await delay(650);
    assert(await main.evaluate(`(${guest}).executeJavaScript("!document.querySelector('[id*=null][id*=translat]')&&!document.querySelector('[id*=null][id*=selection]')&&window.__nullTranslationState===undefined&&document.getElementById('text').textContent==='Hello world selected text'")`),'selection translation still injects/modifies page');
    results.selectionTranslationRemoved = true;
    // Exercise the actual native context-menu event in this owned process.
    const labels=await main.evaluate(`(()=>{const Menu=process.mainModule.require('electron').Menu;const original=Menu.buildFromTemplate;let labels=[];try{Menu.buildFromTemplate=(items)=>{labels=items.map(item=>item.label||'');return {popup(){}}};(${guest}).emit('context-menu',{}, {x:10,y:10,selectionText:'Hello world',linkURL:${JSON.stringify(origin)}})}finally{Menu.buildFromTemplate=original}return labels})()`);
    assert(!labels.some(label=>/번역/.test(label))&&labels.includes('새 탭에서 링크 열기'),'context menu removal/basic actions incorrect');
    results.nativeContextMenuPreservedWithoutTranslation = true;
    await screenshot('clean-toolbar-feature-removal');
    await verifySitePolish(origin,guest);
  } finally { fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve)); }
}
async function run() {
  await launch();
  await page.evaluate(`document.querySelector('button[aria-label="브라우저 설정"]').click(); true`);
  await waitFor(() => page.evaluate(`!!document.querySelector('[data-settings-page]')`), 'settings tab');
  assert(await page.evaluate(`document.querySelector('input[aria-label="검색 또는 URL"]').value==='null://settings'`), 'not an internal settings tab');
  assert(await page.evaluate(`document.querySelectorAll('[data-settings-nav]').length===11`), 'missing category');
  assert(await page.evaluate(`!document.querySelector('.null-settings-page input[type="search"]') && !document.querySelector('.null-overlay')`), 'settings is still a search/modal overlay');
  const initialCount = await page.evaluate(`document.querySelectorAll('[data-tab-id]').length`);
  await page.evaluate(`document.querySelector('button[aria-label="브라우저 설정"]').click(); true`);
  assert(await page.evaluate(`document.querySelectorAll('[data-tab-id]').length===${initialCount}`), 'duplicate settings tab');
  results.settingsTabAndDirectEntry = true;
  const sections = ['general','appearance','search','privacy','sites','languages','downloads','extensions','shortcuts','backup','about'];
  for (const id of sections) { await category(id); await checkLayout(); }
  results.allCategories = true;
  await category('privacy');
  assert(await page.evaluate(`document.querySelectorAll('.null-settings-page input[type="checkbox"]').length===0`),'native checkbox appearance remains');
  await page.evaluate(`document.querySelector('[role="switch"][aria-label="방문 기록 저장"]').focus();true`);
  await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',text:' ',windowsVirtualKeyCode:32});
  await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await waitFor(()=>page.evaluate(`document.querySelector('[role="switch"][aria-label="방문 기록 저장"]').getAttribute('aria-checked')==='false'`),'keyboard switch');
  assert(await page.evaluate(`window.electronAPI.getSettings().then(s=>s.saveBrowsingHistory===true)`),'keyboard draft persisted early');
  await checkLayout();
  await page.evaluate(`document.querySelector('.null-settings-secondary').click();true`);
  await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const motion=await page.evaluate(`({matches:matchMedia('(prefers-reduced-motion: reduce)').matches,duration:getComputedStyle(document.querySelector('.null-switch-thumb')).transitionDuration})`);
  // Existing global reduced-motion rules use 0.01ms rather than literal zero.
  assert(motion.matches&&motion.duration.split(',').every(value=>parseFloat(value)<=0.00001),'reduced motion switch not respected: '+JSON.stringify(motion));
  await page.send('Emulation.setEmulatedMedia',{features:[]});
  results.switchKeyboardContainmentAndReducedMotion = true;
  await category('search');
  assert(await page.evaluate(`!document.querySelector('[data-settings-section="search"]').innerText.includes('단축어')&&window.electronAPI.getSettings().then(s=>!('searchShortcuts' in s))`),'site search shortcuts remain');
  results.siteSearchShortcutsRemoved = true;
  await category('general');
  await screenshot('general-noir-1360x880');
  await category('search');
  await page.evaluate(`Array.from(document.querySelectorAll('[data-settings-section="search"] button')).find(b=>b.textContent.trim()==='Naver').click(); true`);
  assert(await page.evaluate(`window.electronAPI.getSettings().then(s=>s.searchEngine==='google')`), 'draft unexpectedly persisted');
  await category('downloads'); await category('search');
  assert(await page.evaluate(`Array.from(document.querySelectorAll('[data-settings-section="search"] button')).find(b=>b.textContent.trim()==='Naver').getAttribute('aria-pressed')==='true'`), 'category switch lost draft');
  await page.evaluate(`document.querySelector('.null-settings-save-actions .null-primary-button').click(); true`);
  await waitFor(() => page.evaluate(`window.electronAPI.getSettings().then(s=>s.searchEngine==='naver')`), 'saved search engine');
  assert(await page.evaluate(`!!document.querySelector('[data-settings-page]')`), 'saving closed settings');
  results.draftSaveAndCategoryPersistence = true;
  // Make persistence fail in this owned process only, then verify retry works.
  await category('privacy');
  await main.evaluate(`(()=>{const ipc=process.mainModule.require('electron').ipcMain;globalThis.__settingsQaHandler=ipc._invokeHandlers.get('settings:update');ipc.removeHandler('settings:update');ipc.handle('settings:update',()=>{throw new Error('QA persistence failure')});return true})()`);
  await page.evaluate(`document.querySelector('button[role="switch"][aria-label="검색 기록 저장"]').click(); true`);
  await page.evaluate(`document.querySelector('.null-settings-save-actions .null-primary-button').click(); true`);
  await waitFor(()=>page.evaluate(`document.querySelector('.null-settings-save-error')?.textContent.includes('저장하지 못했습니다')`),'save error surfaced');
  assert(await page.evaluate(`window.electronAPI.getSettings().then(s=>s.saveSearchHistory===true)`),'failed save changed persistent preference');
  assert(await page.evaluate(`!document.querySelector('.null-settings-save-actions .null-primary-button').disabled`),'save cannot be retried');
  await main.evaluate(`(()=>{const ipc=process.mainModule.require('electron').ipcMain;ipc.removeHandler('settings:update');ipc.handle('settings:update',globalThis.__settingsQaHandler);return true})()`);
  await page.evaluate(`document.querySelector('.null-settings-save-actions .null-primary-button').click(); true`);
  await waitFor(()=>page.evaluate(`window.electronAPI.getSettings().then(s=>s.saveSearchHistory===false)`),'save retry');
  results.saveFailureAndRetry = true;
  await category('appearance');
  await page.evaluate(`document.querySelector('button[aria-label="화이트 테마"]').click(); true`);
  await waitFor(() => page.evaluate(`document.documentElement.dataset.theme==='paper'`), 'theme preview');
  await screenshot('appearance-paper-1360x880');
  await page.evaluate(`document.querySelector('.null-settings-secondary').click(); true`);
  assert(await page.evaluate(`document.documentElement.dataset.theme==='noir'`), 'cancel did not roll back theme');
  results.themePreviewCancel = true;
  const themeLabels = await page.evaluate(`Array.from(document.querySelectorAll('button[aria-label$=" 테마"]')).map(button=>button.getAttribute('aria-label'))`);
  assert(themeLabels.length===2, 'missing theme');
  for (const label of themeLabels) {
    await page.evaluate(`document.querySelector('button[aria-label='+CSS.escape(${JSON.stringify(label)})+']').click(); true`);
    await checkLayout();
  }
  await page.evaluate(`document.querySelector('.null-settings-secondary').click(); true`);
  results.twoThemeLayouts = true;
  await page.evaluate(`document.querySelector('button[aria-label="화이트 테마"]').click(); true`);
  await page.evaluate(`document.querySelector('.null-settings-save-actions .null-primary-button').click(); true`);
  await waitFor(() => page.evaluate(`window.electronAPI.getSettings().then(s=>s.theme==='paper')`), 'saved theme');
  await main.evaluate(`${mainWindow}.setSize(800,600); true`);
  await delay(180);
  for (const id of sections) { await category(id); await checkLayout(); }
  await category('general'); await screenshot('general-paper-800x600');
  await page.evaluate(`document.querySelector('button[title="서랍 패널 토글 (메모/다운로드)"]').click();true`);
  await waitFor(()=>page.evaluate(`!!document.querySelector('.null-aside')`),'utility alongside settings');
  for (const id of sections) { await category(id); await checkLayout(); }
  await page.evaluate(`document.querySelector('button[title="Aside 패널 닫기"]').click();true`);
  results.settingsWithUtilityAt800 = true;
  await main.evaluate(`${mainWindow}.setSize(1440,900); true`);
  await delay(150); await category('privacy'); await checkLayout(); await screenshot('privacy-paper-1440x900');
  results.responsive800And1440 = true;
  assert(await main.evaluate(`${mainWindow}.contentView.children.every(view=>!view.getVisible())`), 'native page overlaps settings');
  assert(await page.evaluate(`window.electronAPI.getHistory().then(items=>items.every(i=>!i.url.startsWith('null:')))`), 'internal settings leaked into history');
  results.nativeViewAndHistoryIsolation = true;
  // Address entry exercises the real input parser and renderer/native route.
  await page.evaluate(`const input=document.querySelector('input[aria-label="검색 또는 URL"]'); input.focus(); input.select(); true`);
  await page.send('Input.insertText', { text: 'null://settings/downloads' });
  await waitFor(() => page.evaluate(`document.querySelector('input[aria-label="검색 또는 URL"]').value==='null://settings/downloads'`), 'address text input');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await waitFor(() => page.evaluate(`!!document.querySelector('[data-settings-section="downloads"]')`), 'settings address route');
  results.addressRoute = true;
  await category('general');
  await page.evaluate(`Array.from(document.querySelectorAll('[data-settings-section="general"] button')).find(b=>b.textContent.includes('이전 세션의 모든 탭 복원')).click(); true`);
  await page.evaluate(`document.querySelector('.null-settings-save-actions .null-primary-button').click(); true`);
  await waitFor(() => page.evaluate(`window.electronAPI.getSettings().then(s=>s.startupBehavior==='restore')`), 'restore preference');
  await category('search');
  await delay(600);
  await quit(); await launch();
  await waitFor(() => page.evaluate(`!!document.querySelector('[data-settings-section="search"]')`), 'restored settings route');
  assert(await page.evaluate(`window.electronAPI.getSettings().then(s=>s.searchEngine==='naver'&&s.theme==='paper')`), 'preferences lost after restart');
  results.freshProcessRestore = true;
  await page.evaluate(`document.querySelector('[aria-label="설정 탭 닫기"]').click(); true`);
  await waitFor(() => page.evaluate(`!document.querySelector('[data-settings-page]')`), 'settings close');
  assert(await page.evaluate(`document.querySelectorAll('[data-tab-id]').length===1`), 'closing settings removed wrong tab');
  results.closeReturnsToTab = true;
  await page.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:',',metaKey:true,bubbles:true})); true`);
  await waitFor(()=>page.evaluate(`!!document.querySelector('[data-settings-page]')`),'Cmd comma settings handler');
  await page.evaluate(`document.querySelector('[aria-label="설정 탭 닫기"]').click(); true`);
  await waitFor(()=>page.evaluate(`!document.querySelector('[data-settings-page]')`),'close before menu test');
  await main.evaluate(`(()=>{const e=process.mainModule.require('electron');function find(menu){for(const item of menu.items){if(item.label==='환경설정...')return item;if(item.submenu){const found=find(item.submenu);if(found)return found}}}const item=find(e.Menu.getApplicationMenu());if(!item)throw new Error('Settings native menu missing');item.click();return true})()`);
  await waitFor(()=>page.evaluate(`!!document.querySelector('[data-settings-page]')`),'native menu entry');
  results.keyboardAndNativeMenuEntry = true;
  await verifyRemovedFeatures();
  assert(!/\[Renderer\].*(Uncaught|ReferenceError|TypeError)/.test(output), 'renderer errors found');
  console.log('NULL_SETTINGS_QA_RESULT=' + JSON.stringify({ ok:true, packaged, results, profile }));
}
run().then(quit).catch(async error => {
  console.error(error); console.error('Completed:', results, 'Profile:', profile); console.error(output.slice(-6000));
  if (page) { await screenshot('failure').catch(()=>{}); console.error(await page.evaluate(`({text:document.body.innerText.slice(-1800),theme:document.documentElement.dataset.theme})`).catch(()=>null)); }
  await quit(); process.exitCode = 1;
});
