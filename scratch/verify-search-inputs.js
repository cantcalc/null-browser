// Real renderer/native-view regression QA. Only an isolated temporary profile
// and a loopback search provider are used; no personal profile is opened.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'null-search-input-qa-'));
const packaged = process.env.NULL_SEARCH_PACKAGED === 'true';
const appPath = process.env.NULL_SEARCH_APP_PATH;
const results = {};
const requests = [];
const cookieRequests = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
const address = '.null-omnibox input';
const newTab = '.null-newtab-search input';
const mainWindow = `process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/dist/index.html')&&!w.webContents.getURL().includes('incognito=1'))`;
let processHandle, main, page, origin, debugPort, output = '', sockets = [];
const fixture = http.createServer((request, response) => {
  requests.push(request.url);
  if (request.url === '/workspace-cookie') {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ cookie: request.headers.cookie || '' })); return;
  }
  if (request.url === '/workspace-file') {
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="workspace-proof.txt"' });
    response.end('workspace download proof'); return;
  }
  if (request.url.startsWith('/extension-ad-probe')) {
    response.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    response.end('ad probe reached server'); return;
  }
  const cookieFixture=request.url.startsWith('/cookie-');
  if(cookieFixture)cookieRequests.push({path:request.url,cookie:request.headers.cookie||''});
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',...(cookieFixture?{'set-cookie':'qa_response=received; Path=/; SameSite=Lax'}:{}) });
  response.end('<!doctype html><html><head><title>nullqa open tab</title><link rel="icon" href="data:,"></head><body style="margin:0;min-height:2200px;background:#fafafa;color:#202226;font:16px sans-serif"><h1 style="padding:24px">Search input QA page</h1><div id="horizontal" style="margin:24px;width:240px;overflow-x:auto"><div style="width:1200px;height:70px;background:#dce2eb">Horizontal gallery</div></div><div id="rtl" dir="rtl" style="margin:24px;width:240px;overflow-x:auto"><div style="width:1200px;height:70px;background:#e9e1d8">RTL gallery</div></div><button id="page-button" onclick="window.pageClicks=(window.pageClicks||0)+1">Page action</button></body></html>');
});
async function waitFor(check, message, timeout = 20000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return;
    await delay(60);
  }
  throw new Error(`Timed out: ${message}`);
}
async function connect(url) {
  const socket = new WebSocket(url); sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
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
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  return { send, evaluate, socket };
}
async function launch() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  debugPort = port;
  await new Promise(resolve => socket.close(resolve));
  let inspector;
  assert(!packaged || appPath, 'Set NULL_SEARCH_APP_PATH for packaged QA');
  const binary = packaged ? path.join(appPath, 'Contents/MacOS', fs.existsSync(path.join(appPath, 'Contents/MacOS/NULL')) ? 'NULL' : 'NULL Browser') : require('electron');
  output = '';
  processHandle = spawn(binary, [...(packaged ? [] : [root]), `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--inspect=0', '--no-proxy-server', ...(process.env.NULL_EXTENSION_RECOGNITION_QA ? ['--host-resolver-rules=MAP *.doubleclick.net 127.0.0.1'] : [])], { stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [processHandle.stdout, processHandle.stderr]) stream.on('data', data => {
    output += data.toString();
    inspector ||= output.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/)?.[1];
  });
  await waitFor(() => inspector, 'main inspector');
  main = await connect(inspector);
  await waitFor(() => main.evaluate('!!process.mainModule'), 'main process loaded');
  let target;
  await waitFor(async () => {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes('/dist/index.html')); return target; }
    catch { return false; }
  }, 'NULL renderer');
  page = await connect(target.webSocketDebuggerUrl);
  await waitFor(() => page.evaluate(`!!document.querySelector(${JSON.stringify(address)}) && document.querySelectorAll('[data-tab-id]').length===${process.env.NULL_STARTUP_QA ? 20 : 2}`), 'restored QA tabs');
}
async function quit() {
  const closed = processHandle && new Promise(resolve => processHandle.once('exit', resolve));
  await main?.evaluate("setTimeout(()=>process.mainModule.require('electron').app.quit(),50);true").catch(() => {});
  for (const socket of sockets) socket.close(); sockets = [];
  if (closed) await Promise.race([closed, delay(4000)]);
  if (processHandle && processHandle.exitCode === null) processHandle.kill('SIGTERM');
  main = page = null;
}
async function key(key, code, keyCode, text) {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, ...(text ? { text } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
}
async function fill(selector, value) {
  // A real click on browser chrome focuses the parent WebContents, not the
  // native page view that previously owned keyboard input.
  await main.evaluate(`${mainWindow}.focus();${mainWindow}.webContents.focus();true`);
  const point = await page.evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});input.blur();const r=input.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
  await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  if (selector === address) await waitFor(() => page.evaluate(`document.querySelector('.null-omnibox').dataset.focused==='true'`), 'focused full URL rendered');
  // Select after React has replaced the compact display with the editable URL.
  await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).select();true`);
  if (value) await page.send('Input.insertText', { text: value });
  else await key('Backspace', 'Backspace', 8);
  try {
    await waitFor(() => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(value)}`), 'typed input');
  } catch (error) {
    throw new Error(`${error.message}: ${JSON.stringify(await page.evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});return {value:input.value,focused:document.activeElement===input,chromeFocused:document.hasFocus()}})()`))}`);
  }
}
async function noRecommendations(selector) {
  for (const query of ['', 'a', 'nullqa']) {
    await fill(selector, query);
    await delay(250);
    const state = await page.evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)}),area=input.closest('form').parentElement;return {
      suggestions:area.querySelectorAll('.null-popover,.null-list-row,[role="listbox"],[role="option"]').length,
      autocomplete:input.autocomplete,spellcheck:input.spellcheck,autocorrect:input.getAttribute('autocorrect'),value:input.value};})()`);
    assert(state.suggestions === 0, `${selector}: recommendations remain for ${query}`);
    assert(state.autocomplete === 'off' && !state.spellcheck && state.autocorrect === 'off', `${selector}: native completion remains enabled`);
    await key('ArrowDown', 'ArrowDown', 40);
    const afterArrow = await page.evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});return {value:input.value,focused:document.activeElement===input,chromeFocused:document.hasFocus()}})()`);
    assert(afterArrow.value === query, `${selector}: ArrowDown changed ${JSON.stringify(query)}: ${JSON.stringify(afterArrow)}`);
  }
}
async function loaded(url) {
  await waitFor(() => main.evaluate(`${mainWindow}.contentView.children.some(view=>view.getVisible()&&view.getBounds().width>200&&view.getBounds().height>100&&view.webContents.getURL()===${JSON.stringify(url)}&&!view.webContents.isLoading())`), `native view loaded with usable viewport ${url}`);
  const compact = new URL(url).hostname + new URL(url).pathname;
  await waitFor(() => page.evaluate(`document.querySelector(${JSON.stringify(address)}).value===${JSON.stringify(compact)}`), 'renderer address status hydrated');
}
async function interactionProbe() {
  const hitAreas = {};
  for (const selector of ['.null-newtab-search', '.null-omnibox']) {
    const box = await page.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
    const points = [[0.5,0.12],[0.5,0.5],[0.5,0.88],[0.04,0.5],[0.96,0.5]];
    hitAreas[selector] = [];
    for (const [x,y] of points) {
      await main.evaluate(`${mainWindow}.focus();${mainWindow}.webContents.focus();true`);
      await page.evaluate(`document.activeElement?.blur();true`);
      await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:box.x+box.width*x,y:box.y+box.height*y});
      await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:box.x+box.width*x,y:box.y+box.height*y});
      hitAreas[selector].push(await page.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selector+' input')})`));
    }
  }
  await page.evaluate(`document.querySelector('[data-tab-id="qa-open-tab"]').click();true`);
  await loaded(`${origin}/open-tab`);
  await page.evaluate(`(()=>{for(let i=0;i<18;i++)window.electronAPI.createTab('qa-perf-'+i,'null://newtab');return true})()`);
  await waitFor(()=>main.evaluate(`${mainWindow}.contentView.children.length===20`),'20 native views');
  await main.evaluate(`(()=>{const e=process.mainModule.require('electron');globalThis.__interactionCounts={boundsIpc:0,setBounds:0,setVisible:0};e.ipcMain.on('tab:setBounds',()=>globalThis.__interactionCounts.boundsIpc++);for(const view of ${mainWindow}.contentView.children){const setBounds=view.setBounds.bind(view),setVisible=view.setVisible.bind(view);view.setBounds=(...args)=>{globalThis.__interactionCounts.setBounds++;return setBounds(...args)};view.setVisible=(...args)=>{globalThis.__interactionCounts.setVisible++;return setVisible(...args)}}return true})()`);
  await delay(3000);
  const idle = await main.evaluate('globalThis.__interactionCounts');
  await main.evaluate(`(()=>{const ipc=process.mainModule.require('electron').ipcMain;globalThis.__statusCounts={permissionReads:0,sessionSaves:0};const handler=ipc._invokeHandlers.get('site:getPermissions');ipc.removeHandler('site:getPermissions');ipc.handle('site:getPermissions',(...args)=>{globalThis.__statusCounts.permissionReads++;return handler(...args)});ipc.on('session:save',()=>globalThis.__statusCounts.sessionSaves++);return true})()`);
  for(let i=0;i<20;i++){
    await main.evaluate(`${mainWindow}.webContents.send('tab:status-updated',{id:'qa-open-tab',isLoading:${i%2===0}});true`);
    await delay(35);
  }
  await delay(150);
  const status=await main.evaluate('globalThis.__statusCounts');
  const result = {stage:process.env.NULL_INTERACTION_PROBE,hitAreas,idleOver3000ms20Views:idle,ipcFor20LoadingOnlyUpdates:status,profile};
  fs.writeFileSync(path.join(profile,'interaction-probe.json'),JSON.stringify(result,null,2));
  console.log('NULL_INTERACTION_PROBE='+JSON.stringify(result));
}
async function duckDuckGoProbe() {
  await main.evaluate(`(()=>{globalThis.__ddgErrors=[];for(const v of ${mainWindow}.contentView.children)v.webContents.on('did-fail-load',(_e,code,description,url,isMainFrame)=>{if(isMainFrame)globalThis.__ddgErrors.push({code,description,url})});return true})()`);
  await fill(newTab,'null browser test');await key('Enter','Enter',13,'\r');
  const started=Date.now();
  while(Date.now()-started<35000){
    const state=await main.evaluate(`(()=>{const view=${mainWindow}.contentView.children.find(v=>v.getVisible());return view?{url:view.webContents.getURL(),loading:view.webContents.isLoading()}:null})()`);
    if(state&&!state.loading&&state.url.startsWith('https://'))break;
    await delay(500);
  }
  const views=await main.evaluate(`Promise.all(${mainWindow}.contentView.children.map(async view=>({url:view.webContents.getURL(),loading:view.webContents.isLoading(),visible:view.getVisible(),text:await view.webContents.executeJavaScript('document.body?.innerText?.slice(0,1200)').catch(()=>null)})))`);
  const result={elapsedMs:Date.now()-started,views,errors:await main.evaluate('globalThis.__ddgErrors'),ui:await page.evaluate('document.body.innerText.slice(-1800)'),profile};
  fs.writeFileSync(path.join(profile,'duckduckgo-probe.json'),JSON.stringify(result,null,2));
  console.log('NULL_DUCKDUCKGO_PROBE='+JSON.stringify(result));
}
async function interactionQA() {
  const checked = results.interactions = new Proxy({}, {set(target,key,value){target[key]=value;console.log('[interaction] '+String(key));return true;}});
  // Test real pointer hits, not programmatic input.focus().
  for (const selector of ['.null-newtab-search','.null-omnibox']) {
    const box=await page.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
    for(const [x,y] of [[0.5,0.12],[0.5,0.88],[0.04,0.5],[0.96,0.5]]){
      await main.evaluate(`${mainWindow}.focus();${mainWindow}.webContents.focus();true`);
      await page.evaluate('document.activeElement?.blur();true');
      const point={x:box.x+box.width*x,y:box.y+box.height*y};
      await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
      await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
      assert(await page.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selector+' input')})`),`dead search area: ${selector} ${x},${y}`);
    }
  }
  checked.fullSearchHitAreas=true;
  const navigate=async path=>{await fill(address,origin+path);await key('Enter','Enter',13,'\r');await loaded(origin+path);};
  await navigate('/zero');await navigate('/one');await navigate('/two');
  const guestId=await main.evaluate(`${mainWindow}.contentView.children.find(v=>v.getVisible()).webContents.id`);
  const guest=`process.mainModule.require('electron').webContents.fromId(${guestId})`;
  const target=(await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(item=>item.url===origin+'/two');
  assert(target,'native guest CDP target missing');
  const guestClient=await connect(target.webSocketDebuggerUrl);
  const evaluate=expression=>guestClient.evaluate(expression);
  const waitPath=path=>waitFor(()=>main.evaluate(`${guest}.getURL()===${JSON.stringify(origin)}+${JSON.stringify(path)}&&!${guest}.isLoading()`),'native gesture navigation '+path);
  // Real CDP input is trusted in the guest, unlike dispatchEvent from site JS.
  const send=(method,params)=>guestClient.send(method,params);
  await main.evaluate(`process.mainModule.require('electron').app.focus({steal:true});${mainWindow}.show();${mainWindow}.moveTop();${mainWindow}.focus();${guest}.focus();true`);
  await send('Page.bringToFront',{});
  const nativeLayout=await main.evaluate(`(()=>{const w=${mainWindow},v=w.contentView.children.find(v=>v.webContents.id===${guestId});return {windowFocused:w.isFocused(),guestFocused:v.webContents.isFocused(),visible:v.getVisible(),bounds:v.getBounds()}})()`);
  const docLayout=await evaluate(`({width:innerWidth,height:innerHeight,visible:document.visibilityState,focus:document.hasFocus(),ready:document.readyState})`);
  console.log('[interaction] input target '+JSON.stringify({nativeLayout,docLayout}));
  assert(nativeLayout.bounds.width>200&&nativeLayout.bounds.height>100&&docLayout.width>200&&docLayout.height>100,'native viewport stayed zero-sized after New Tab navigation');
  checked.nonZeroNativeViewportAfterNewTab=true;
  await waitFor(()=>evaluate(`document.visibilityState==='visible'`),'guest visible before native input');
  const contexts=[];
  const recordContext=event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.executionContextCreated')contexts.push(message.params.context);};
  guestClient.socket.addEventListener('message',recordContext);
  await send('Runtime.enable');
  await waitFor(()=>contexts.some(context=>context.name==='Electron Isolated Context'),'preload execution context');
  guestClient.socket.removeEventListener('message',recordContext);
  const isolated=contexts.find(context=>context.name==='Electron Isolated Context');
  const isolatedWindow=await send('Runtime.evaluate',{expression:'window',contextId:isolated.id});
  const {listeners}=await send('DOMDebugger.getEventListeners',{objectId:isolatedWindow.result.objectId});
  assert(listeners.some(listener=>listener.type==='wheel')&&listeners.filter(listener=>listener.type==='wheel').every(listener=>listener.passive),'NULL still blocks compositor scrolling with a non-passive wheel listener');
  checked.passiveGuestWheel=true;
  await main.evaluate(`(()=>{const w=${mainWindow},send=w.webContents.send.bind(w.webContents);globalThis.__gestureUiRelays=0;w.webContents.send=(channel,...args)=>{if(channel==='tab:gesture')globalThis.__gestureUiRelays++;return send(channel,...args)};return true})()`);
  const wheel=async(dx,dy=0,x=480,y=250,modifiers=0)=>{
    // CDP cannot deliver native input to an occluded/background macOS view.
    // Re-establish the same visible/focused precondition as a real user, rather
    // than counting an unanswered command to a hidden widget as app latency.
    await main.evaluate(`process.mainModule.require('electron').app.focus({steal:true});${mainWindow}.show();${mainWindow}.moveTop();${mainWindow}.focus();${guest}.focus();true`);
    await send('Page.bringToFront',{});
    // Wheel/hover input does not require keyboard focus (inactive-window
    // scrolling is valid), but its native target must be visible.
    await waitFor(()=>evaluate(`document.visibilityState==='visible'`),'visible guest before wheel');
    try { await send('Input.dispatchMouseEvent',{type:'mouseWheel',x,y,deltaX:dx,deltaY:dy,modifiers}); }
    catch(error){
      console.error('[interaction] wheel diagnostic '+JSON.stringify({dx,dy,page:await evaluate(`({path:location.pathname,visibility:document.visibilityState,focus:document.hasFocus(),hud:document.getElementById('__null_history_gesture')?.dataset.state})`),native:await main.evaluate(`({windowFocused:${mainWindow}.isFocused(),guestFocused:${guest}.isFocused(),url:${guest}.getURL(),loading:${guest}.isLoading(),bounds:${mainWindow}.contentView.children.find(v=>v.webContents.id===${guestId}).getBounds(),visible:${mainWindow}.contentView.children.find(v=>v.webContents.id===${guestId}).getVisible()})`)}));
      throw error;
    }
  };
  await delay(120);
  await wheel(-24);
  await waitFor(()=>evaluate(`document.getElementById('__null_history_gesture')?.dataset.state==='tracking'`),'back gesture preview');
  assert(await evaluate(`(()=>{const h=document.getElementById('__null_history_gesture');return h.dataset.action==='back'&&+h.dataset.progress>0&&+h.dataset.progress<1&&getComputedStyle(h).pointerEvents==='none'&&getComputedStyle(document.body).transform==='none'&&getComputedStyle(document.body).opacity==='1'})()`),'gesture preview modifies/obscures whole page');
  const image=await main.evaluate(`${guest}.capturePage().then(i=>i.toPNG().toString('base64'))`);
  fs.writeFileSync(path.join(profile,'gesture-back-preview.png'),Buffer.from(image,'base64'));
  checked.edgePreviewAndNoPageFlash=true;
  // capturePage can outlast the gesture's idle boundary; begin a full
  // trusted swipe instead of relying on time spent taking a screenshot.
  await wheel(-64);
  await waitPath('/one');
  assert(await main.evaluate('globalThis.__gestureUiRelays===0'),'history gesture still waits for the browser renderer round trip');
  checked.gestureNavigatesWithoutUiRoundTrip=true;
  await wheel(-64);await delay(100);
  assert(await evaluate(`location.pathname==='/one'`),'post-navigation momentum skipped another page');
  checked.momentumDoesNotSkipPages=true;
  await delay(750);await wheel(24);await wheel(40);
  await waitPath('/two');
  checked.backAndForwardGestures=true;
  // Smaller motion is recognized across the page, not only an edge strip.
  // Trusted native input also exercises the recognizer's actual DOM wiring.
  const viewport=await evaluate(`({width:innerWidth,height:innerHeight})`);
  for (const x of [16,viewport.width/2,viewport.width-16]) {
    const y=Math.min(viewport.height-20,400);
    await delay(750);await wheel(-40,0,x,y);await waitPath('/one');
    await delay(750);await wheel(40,0,x,y);await waitPath('/two');
  }
  checked.shortSwipeAcrossPage=true;
  await delay(750);await wheel(-14);await delay(220);await wheel(-14);await delay(220);await wheel(-14);
  await waitPath('/one');
  checked.slowSwipeRecognized=true;
  await delay(750);await wheel(22);await wheel(-2,1);await wheel(20);
  await waitPath('/two');
  checked.directionTremorTolerated=true;
  await delay(750);await wheel(-20,19);await wheel(-20,19);await waitPath('/one');
  await delay(750);await wheel(40);await waitPath('/two');
  checked.diagonalSwipeRecognized=true;
  await delay(750);await wheel(64);
  await waitFor(()=>evaluate(`document.getElementById('__null_history_gesture')?.dataset.state==='unavailable'`),'unavailable forward indication');
  assert(await evaluate(`location.pathname==='/two'`),'unavailable forward navigated');
  await delay(500);
  assert(await evaluate(`document.getElementById('__null_history_gesture')?.dataset.state==='hidden'`),'gesture badge did not dismiss');
  checked.unavailableAndAutoDismiss=true;
  const bounds=await evaluate(`(()=>{const r=document.getElementById('horizontal').getBoundingClientRect();return {x:r.x+100,y:r.y+30}})()`);
  await wheel(100,0,bounds.x,bounds.y);
  await waitFor(()=>evaluate(`document.getElementById('horizontal').scrollLeft>0`),'nested horizontal scroll');
  assert(await evaluate(`location.pathname==='/two'&&document.getElementById('__null_history_gesture')?.dataset.state==='hidden'`),'gallery wheel became navigation');
  const rtlBounds=await evaluate(`(()=>{const r=document.getElementById('rtl').getBoundingClientRect();return {x:r.x+100,y:r.y+30}})()`);
  await wheel(-100,0,rtlBounds.x,rtlBounds.y);
  await waitFor(()=>evaluate(`document.getElementById('rtl').scrollLeft<0`),'RTL horizontal scroll');
  assert(await evaluate(`location.pathname==='/two'`),'RTL gallery triggered history');
  checked.nestedAndRtlScrollPreserved=true;
  await wheel(0,300);
  await waitFor(()=>evaluate(`scrollY>0`),'ordinary vertical scroll');
  assert(await evaluate(`location.pathname==='/two'`),'vertical scroll triggered history');
  checked.verticalScrollPreserved=true;
  await evaluate(`dispatchEvent(new WheelEvent('wheel',{deltaX:-200,bubbles:true,cancelable:true}));true`);
  assert(await evaluate(`location.pathname==='/two'`),'site-script synthetic gesture navigated');
  checked.syntheticGestureIgnored=true;
  await delay(200);
  await main.evaluate(`${mainWindow}.focus();${guest}.focus();globalThis.__sideButtonQa=[];process.mainModule.require('electron').ipcMain.on('tab:guest-gesture',(_e,action,source)=>globalThis.__sideButtonQa.push({action,source}));true`);
  await evaluate(`window.__qaSideEvents=[];for(const type of ['pointerdown','mousedown','mouseup','auxclick'])window.addEventListener(type,e=>window.__qaSideEvents.push({type,button:e.button,buttons:e.buttons,trusted:e.isTrusted}),true);true`);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:480,y:250,button:'back',buttons:8,clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:480,y:250,button:'back',buttons:0,clickCount:1});
  try { await waitPath('/one'); }
  catch(error){throw new Error(error.message+' '+JSON.stringify({ipc:await main.evaluate('globalThis.__sideButtonQa'),guest:await evaluate(`({events:window.__qaSideEvents,hud:document.getElementById('__null_history_gesture')?.dataset.action,state:document.getElementById('__null_history_gesture')?.dataset.state})`),canBack:await main.evaluate(`${guest}.navigationHistory.canGoBack()`)}));}
  await delay(200);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:480,y:250,button:'forward',buttons:16,clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:480,y:250,button:'forward',buttons:0,clickCount:1});
  await waitPath('/two');
  checked.mouseSideButtons=true;
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert(await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`),'reduced motion emulation failed');
  await delay(750);await wheel(-24);
  assert(await evaluate(`getComputedStyle(document.body).transform==='none'`),'reduced motion transforms page');
  checked.reducedMotionNoPageTransform=true;
  // Navigate the visible secondary pane without moving the primary pane.
  await page.evaluate(`window.electronAPI.navigateTab('qa-open-tab',${JSON.stringify(origin+'/secondary-one')});true`);
  const secondary=`${mainWindow}.contentView.children.map(v=>v.webContents).find(w=>w.id!==${guestId})`;
  await waitFor(()=>main.evaluate(`(${secondary}).getURL()===${JSON.stringify(origin+'/secondary-one')}&&!(${secondary}).isLoading()`),'secondary first page');
  await page.evaluate(`window.electronAPI.navigateTab('qa-open-tab',${JSON.stringify(origin+'/secondary-two')});window.electronAPI.setSplitView(true,'qa-open-tab',0.5);true`);
  await waitFor(()=>main.evaluate(`(${secondary}).getURL()===${JSON.stringify(origin+'/secondary-two')}&&!(${secondary}).isLoading()`),'secondary history ready');
  const secondaryTarget=(await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(item=>item.url===origin+'/secondary-two');
  const secondaryClient=await connect(secondaryTarget.webSocketDebuggerUrl);
  // Do not use Page.bringToFront on a split pane: that browser-tab command can
  // alter selection rather than merely target the already displayed pane.
  assert(await main.evaluate(`${mainWindow}.contentView.children.some(v=>v.webContents===(${secondary})&&v.getVisible()&&v.getBounds().width>0)`),'secondary native pane is not displayed');
  await secondaryClient.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:400,y:300,deltaX:-64,deltaY:0});
  await waitFor(()=>main.evaluate(`(${secondary}).getURL()===${JSON.stringify(origin+'/secondary-one')}`),'secondary gesture targeted correctly');
  assert(await evaluate(`location.pathname==='/two'`),'secondary gesture moved primary');
  await page.evaluate(`window.electronAPI.setSplitView(false);true`);
  checked.splitGestureTargetsSourcePane=true;
  // Reproduce the failure -> stop-loading event order that used to erase errors.
  await main.evaluate(`${guest}.emit('did-fail-load',{},-118,'ERR_CONNECTION_TIMED_OUT',${JSON.stringify(origin+'/two')},true);${guest}.emit('did-stop-loading');true`);
  await waitFor(()=>page.evaluate(`document.body.innerText.includes('응답 시간이 초과')&&document.body.innerText.includes('오류 코드: -118')`),'timeout error retained after stop loading');
  checked.timeoutDoesNotBecomeBlankPage=true;
  await page.evaluate(`document.querySelector('button[title="홈으로 이동"]').click();true`);
  await waitFor(()=>page.evaluate(`!!document.querySelector(${JSON.stringify(newTab)})&&!document.body.innerText.includes('오류 코드: -118')`),'error recovery to new tab');
  checked.errorRecovery=true;
  console.log('NULL_INTERACTION_QA_RESULT='+JSON.stringify({ok:true,packaged,checked,profile}));
}
async function sideButtonProbe() {
  for(const path of ['/zero','/one','/two']){await fill(address,origin+path);await key('Enter','Enter',13,'\r');await loaded(origin+path);}
  const id=await main.evaluate(`${mainWindow}.contentView.children.find(v=>v.getVisible()).webContents.id`);
  const guest=`process.mainModule.require('electron').webContents.fromId(${id})`;
  await main.evaluate(`(()=>{const ipc=process.mainModule.require('electron').ipcMain;globalThis.__sideProbeIpc=[];const handler=ipc.listeners('tab:guest-gesture')[0];ipc.removeListener('tab:guest-gesture',handler);ipc.on('tab:guest-gesture',(_e,action,source)=>globalThis.__sideProbeIpc.push({action,source}));process.mainModule.require('electron').app.focus({steal:true});${mainWindow}.focus();${guest}.focus();return true})()`);
  const target=(await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(item=>item.url===origin+'/two');
  const client=await connect(target.webSocketDebuggerUrl);
  await client.send('Input.dispatchMouseEvent',{type:'mousePressed',x:480,y:250,button:'back',buttons:8,clickCount:1});
  await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:480,y:250,button:'back',buttons:0,clickCount:1});
  await delay(600);
  console.log('NULL_SIDE_BUTTON_PROBE='+JSON.stringify({manualNavigationHandlerRemoved:true,url:await main.evaluate(`${guest}.getURL()`),ipc:await main.evaluate('globalThis.__sideProbeIpc'),profile}));
}
async function cookiePolicyQA() {
  const session=`process.mainModule.require('electron').session.defaultSession`;
  const navigate=async path=>{
    await page.evaluate(`window.electronAPI.navigateTab('qa-open-tab',${JSON.stringify(origin)}+${JSON.stringify(path)});window.electronAPI.switchTab('qa-open-tab');true`);
    await waitFor(()=>main.evaluate(`${mainWindow}.contentView.children.some(v=>v.webContents.getURL()===${JSON.stringify(origin+path)}&&!v.webContents.isLoading())`),'cookie page '+path);
  };
  await page.evaluate(`window.electronAPI.updateSettings({cookiePolicy:'allow',cookieExceptions:{}})`);
  await main.evaluate(`${session}.cookies.set({url:${JSON.stringify(origin)},name:'qa_outgoing',value:'normal'})`);
  await navigate('/cookie-default');
  assert(cookieRequests.find(r=>r.path==='/cookie-default')?.cookie.includes('qa_outgoing=normal'),'default IPC policy blocked cookie send');
  assert(await main.evaluate(`${session}.cookies.get({url:${JSON.stringify(origin)},name:'qa_response'}).then(items=>items.length===1)`),'default IPC policy blocked Set-Cookie');
  await main.evaluate(`${session}.cookies.remove(${JSON.stringify(origin)},'qa_response')`);
  await page.evaluate(`window.electronAPI.updateSettings({cookieExceptions:{[${JSON.stringify(origin)}]:'block'}})`);
  await navigate('/cookie-blocked');
  assert(cookieRequests.find(r=>r.path==='/cookie-blocked')?.cookie==='','live IPC block did not strip outgoing Cookie');
  assert(await main.evaluate(`${session}.cookies.get({url:${JSON.stringify(origin)},name:'qa_response'}).then(items=>items.length===0)`),'live IPC block did not strip Set-Cookie');
  await page.evaluate(`window.electronAPI.newPrivateWindow(${JSON.stringify(origin+'/cookie-private-blocked')});true`);
  const privateWin=`process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w!==${mainWindow})`;
  const privateSession=`${privateWin}.webContents.session`;
  await waitFor(()=>main.evaluate(`!!(${privateWin})&&${privateWin}.contentView.children.some(v=>v.webContents.getURL()===${JSON.stringify(origin+'/cookie-private-blocked')}&&!v.webContents.isLoading())`),'private cookie policy');
  assert(await main.evaluate(`${privateSession}.cookies.get({url:${JSON.stringify(origin)},name:'qa_response'}).then(items=>items.length===0)`),'new private session did not inherit cookie block');
  await page.evaluate(`window.electronAPI.updateSettings({cookiePolicy:'allow',cookieExceptions:{}})`);
  await main.evaluate(`${privateWin}.contentView.children[0].webContents.loadURL(${JSON.stringify(origin+'/cookie-private-allowed')})`);
  assert(await main.evaluate(`${privateSession}.cookies.get({url:${JSON.stringify(origin)},name:'qa_response'}).then(items=>items.length===1)`),'already-open private session did not refresh');
  assert(await main.evaluate(`${privateSession}.cookies.get({url:${JSON.stringify(origin)},name:'qa_outgoing'}).then(items=>items.length===0)`),'normal Cookie leaked to private session');
  await main.evaluate(`${privateWin}.close();true`);
  await waitFor(()=>main.evaluate(`process.mainModule.require('electron').BrowserWindow.getAllWindows().length===1`),'private close cleanup');
  await page.evaluate(`window.electronAPI.getSettings().then(settings=>window.electronAPI.importSettingsJson(JSON.stringify({settings:{...settings,cookieExceptions:{[${JSON.stringify(origin)}]:'block'}}})))`);
  await navigate('/cookie-import-blocked');
  assert(cookieRequests.find(r=>r.path==='/cookie-import-blocked')?.cookie==='','import did not refresh cookie filters');
  await page.evaluate(`window.electronAPI.resetSettings()`);
  await navigate('/cookie-reset-allowed');
  assert(cookieRequests.find(r=>r.path==='/cookie-reset-allowed')?.cookie.includes('qa_outgoing=normal'),'reset did not remove old blocking filters');
  results.policy={defaultAllow:true,liveBlockSendAndReceive:true,newPrivateInherits:true,openPrivateRefreshes:true,privateIsolation:true,importRefreshes:true,resetRestores:true};
  console.log('NULL_POLICY_IPC_QA='+JSON.stringify({ok:true,packaged,results,profile}));
}
async function run() {
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${fixture.address().port}`;
  const now = Date.now();
  const seed = {
    settings: { firstRunCompleted: true, searchEngine: process.env.NULL_DDG_PROBE ? 'duckduckgo' : 'custom', customSearchUrl: `${origin}/search?q=%s`, startupBehavior: 'restore', newTabConfig: { showLogo: true, showFavorites: false, showRecentSites: false } },
    workspaces: [{ id: 'workspace-default', name: 'work', color: '#3b82f6' }], activeWorkspaceId: 'workspace-default', lastExitWasClean: true,
    bookmarks: [{ id: 'qa-bookmark', title: 'nullqa bookmark', url: `${origin}/bookmark`, createdAt: now }],
    history: [{ id: 'qa-history', title: 'nullqa history', url: `${origin}/visited`, visitedAt: now }],
    searchHistory: [{ id: 'qa-search', query: 'nullqa saved query', engineId: 'custom', searchedAt: now }],
    session: { tabs: [
      { id: 'qa-open-tab', url: `${origin}/open-tab`, title: 'nullqa open tab', pinned: false, workspaceId: 'workspace-default' },
      { id: 'qa-new-tab', url: 'null://newtab', title: '새 탭', pinned: false, workspaceId: 'workspace-default' },
    ], activeTabId: 'qa-new-tab' },
  };
  if (process.env.NULL_WORKSPACE_QA || process.env.NULL_POPUP_QA || (process.env.NULL_EXTENSION_RECOGNITION_QA && !process.env.NULL_EXTENSION_SINGLE_SESSION)) {
    seed.workspaces = [{ id: 'workspace-default', name: 'work', color: '#3b82f6' }, { id: 'workspace-account-b', name: 'Account B', color: '#10b981' }, { id: 'workspace-account-c', name: 'Account C', color: '#8b5cf6' }];
    seed.activeWorkspaceId = 'workspace-default';
    seed.session.tabs.push({ id: 'qa-b', url: `${origin}/account-b`, title: 'B', workspaceId: 'workspace-account-b' }, { id: 'qa-c', url: `${origin}/account-c`, title: 'C', workspaceId: 'workspace-account-c' });
  }
  fs.writeFileSync(path.join(profile, 'browser_store.json'), JSON.stringify(seed));
  if (process.env.NULL_STARTUP_QA) {
    seed.session = { tabs: Array.from({length:20},(_,i)=>({id:`startup-${i}`,url:`${origin}/startup-${i}`,title:`Restored ${i}`,pinned:false,workspaceId:'workspace-default'})), activeTabId:'startup-0' };
    fs.writeFileSync(path.join(profile, 'browser_store.json'), JSON.stringify(seed));
  }
  await launch();
  if (process.env.NULL_STARTUP_QA) {
    await require('./verify-startup-ui')({main,page,profile,origin,mainWindow,waitFor,delay,requests,results,assert});
    console.log('NULL_STARTUP_UI_QA='+JSON.stringify({ok:true,packaged,results,profile})); return;
  }
  if(process.env.NULL_DAILY_QA){
    await require('./verify-daily-journey')({main,page,profile,origin,mainWindow,waitFor,delay,results,assert,fill,key,loaded,address});
    console.log('NULL_DAILY_QA='+JSON.stringify({results,profile,packaged}));return;
  }
  await waitFor(() => page.evaluate(`!!document.querySelector(${JSON.stringify(newTab)})`), 'new tab search');
  await waitFor(() => page.evaluate(`Array.from(document.querySelectorAll('[data-tab-id]')).some(tab=>tab.textContent.includes('nullqa open tab'))`), 'open tab title hydrated');
  if(process.env.NULL_EXTENSION_RECOGNITION_QA){
    await require('./verify-extension-recognition')({main,page,profile,origin,mainWindow,waitFor,delay,results,assert,requests,connect,debugPort});
    console.log('NULL_EXTENSION_RECOGNITION_QA='+JSON.stringify({ok:true,packaged,profile}));return;
  }
  if(process.env.NULL_POPUP_QA){
    await require('./verify-popup-ui')({main,page,profile,mainWindow,waitFor,delay,results,assert});
    console.log('NULL_POPUP_UI_QA_RESULT='+JSON.stringify({ok:true,packaged,results,profile}));return;
  }
  if(process.env.NULL_WORKSPACE_QA){
    await require('./verify-workspace-ui')({ connections:()=>({main,page}), origin, profile, mainWindow, waitFor, delay, quit, launch, results, assert });
    console.log('NULL_WORKSPACE_UI_QA_RESULT='+JSON.stringify({ok:true,results,profile}));return;
  }
  if(process.env.NULL_POLICY_QA){await cookiePolicyQA();return;}
  if(process.env.NULL_INTERACTION_PROBE){await interactionProbe();return;}
  if(process.env.NULL_DDG_PROBE){await duckDuckGoProbe();return;}
  if(process.env.NULL_SIDE_PROBE){await sideButtonProbe();return;}
  if(process.env.NULL_INTERACTION_QA){await interactionQA();return;}
  assert(await page.evaluate(`Promise.all([window.electronAPI.getBookmarks(),window.electronAPI.getHistory(),window.electronAPI.getSearchHistory()]).then(([b,h,s])=>b.some(i=>i.id==='qa-bookmark')&&h.some(i=>i.id==='qa-history')&&s.some(i=>i.id==='qa-search'))`), 'fixture sources missing');
  const beforeTyping = requests.filter(url => url.startsWith('/search')).length;
  await noRecommendations(newTab); await noRecommendations(address);
  assert(requests.filter(url => url.startsWith('/search')).length === beforeTyping, 'typing triggered search requests');
  assert(await page.evaluate(`window.electronAPI.getSearchHistory().then(items=>items.length===1)`), 'typing saved history without Enter');
  results.noRecommendationsWithMatchingBookmarksHistoryAndTabs = true;
  results.typingDoesNotSearchOrSaveHistory = true;
  await fill(address, ''); await key('Enter', 'Enter', 13, '\r');
  assert(await page.evaluate(`!!document.querySelector(${JSON.stringify(newTab)})`), 'blank address navigated');
  await fill(newTab, ''); await key('Enter', 'Enter', 13, '\r');
  assert(await page.evaluate(`!!document.querySelector(${JSON.stringify(newTab)})`), 'blank search navigated');
  results.emptySubmitDoesNothing = true;
  const query = 'nullqa 한글 & exact query';
  await fill(newTab, query); await key('Enter', 'Enter', 13, '\r');
  const searchUrl = `${origin}/search?q=${encodeURIComponent(query)}`;
  await loaded(searchUrl);
  assert(requests.some(url => new URL(url, origin).searchParams.get('q') === query), 'new tab search query changed');
  await waitFor(() => page.evaluate(`window.electronAPI.getSearchHistory().then(items=>items.some(i=>i.query===${JSON.stringify(query)}))`), 'submitted search recorded');
  results.newTabEnterSearchAndHistoryPreserved = true;
  await page.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'l',metaKey:true,bubbles:true}));true`);
  assert(await page.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(address)})`), 'Cmd+L did not focus address');
  await noRecommendations(address);
  await fill(address, 'discard this text'); await key('Escape', 'Escape', 27);
  const compactUrl = new URL(searchUrl).hostname + new URL(searchUrl).pathname;
  assert(await page.evaluate(`document.activeElement!==document.querySelector(${JSON.stringify(address)})&&document.querySelector(${JSON.stringify(address)}).value===${JSON.stringify(compactUrl)}`), 'Escape failed to restore displayed URL');
  await page.evaluate(`document.querySelector(${JSON.stringify(address)}).focus();true`);
  assert(await page.evaluate(`document.querySelector(${JSON.stringify(address)}).value===${JSON.stringify(searchUrl)}`), 'full URL lost after Escape/refocus');
  results.cmdLAndEscapePreserved = true;
  const addressQuery = 'nullqa address search';
  await fill(address, addressQuery); await key('Enter', 'Enter', 13, '\r');
  await loaded(`${origin}/search?q=${encodeURIComponent(addressQuery)}`);
  results.addressEnterSearchPreserved = true;
  await fill(address, `${origin}/bookmark`); await key('Enter', 'Enter', 13, '\r');
  await loaded(`${origin}/bookmark`);
  assert(await page.evaluate(`!!document.querySelector('button[title="북마크에서 제거"]')`), 'existing bookmark state lost');
  results.directUrlAndBookmarkButtonPreserved = true;
  await quit(); await launch();
  await noRecommendations(address);
  await page.evaluate(`document.querySelector('button[title="홈으로 이동"]').click();true`);
  await waitFor(() => page.evaluate(`!!document.querySelector(${JSON.stringify(newTab)})`), 'new tab after restart');
  await noRecommendations(newTab);
  assert(await page.evaluate(`Promise.all([window.electronAPI.getBookmarks(),window.electronAPI.getHistory(),window.electronAPI.getSearchHistory()]).then(([b,h,s])=>b.some(i=>i.id==='qa-bookmark')&&h.some(i=>i.id==='qa-history')&&s.some(i=>i.id==='qa-search'))`), 'existing stored data deleted');
  results.freshProcessStillNoRecommendationsAndDataPreserved = true;
  assert(!/\[Renderer\].*(Uncaught|ReferenceError|TypeError)/.test(output), 'renderer error during QA');
  console.log('NULL_SEARCH_INPUT_QA_RESULT=' + JSON.stringify({ ok: true, packaged, results, profile }));
}
run().catch(error => { console.error(error, '\nCompleted:', JSON.stringify(results), '\nProfile:', profile, '\n', output.slice(-6000)); process.exitCode = 1; }).finally(async () => {
  await quit(); fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
});
