// Runs the packaged application with an isolated profile. Inspector/CDP are
// enabled only on this owned test process; no production debug hook is added.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const binary = path.join(root, 'release/mac-arm64/NULL.app/Contents/MacOS/NULL');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'null-packaged-extension-qa-'));
const extensionId = 'eimadpbcbfnmbkopoojfekhnkhdbieeh';
const sockets = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function waitFor(check, name, timeout = 30000) {
  const start = Date.now();
  while (Date.now()-start < timeout) {
    const value = await check();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out: ${name}`);
}
async function port() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const chosen = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return chosen;
}
async function connect(url) {
  const socket = new WebSocket(url);
  sockets.push(socket);
  await new Promise((resolve,reject) => { socket.addEventListener('open',resolve,{once:true}); socket.addEventListener('error',reject,{once:true}); });
  let sequence=0;
  const pending=new Map();
  socket.addEventListener('message', event => {
    const message=JSON.parse(event.data);
    const task=pending.get(message.id);
    if (task) { clearTimeout(task.timer); pending.delete(message.id); message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result); }
  });
  function send(method, params={}) {
    const id=++sequence;
    return new Promise((resolve,reject) => {
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Protocol timed out: ${method}`));},45000);
      pending.set(id,{resolve,reject,timer});
      socket.send(JSON.stringify({id,method,params}));
    });
  }
  async function evaluate(expression) {
    const response=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
    if(response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  }
  return {send,evaluate};
}

let child;
let main;
let chrome;
let store;
let siteServer;
let siteUrl;
let stderr='';
const results={};
async function run() {
  // A controlled light-only document avoids interpreting a site's own dark
  // theme detection/updates as failed extension injection.
  siteServer=http.createServer((_request,response)=>{
    response.writeHead(200,{'content-type':'text/html'});
    response.end('<!doctype html><html><head><title>NULL Extension QA</title><link rel="icon" href="data:,"><style>body{background:#fff;color:#111;font:18px system-ui;margin:48px}</style></head><body><h1>NULL Extension QA</h1><p>Controlled light document for extension execution verification.</p></body></html>');
  });
  await new Promise(resolve=>siteServer.listen(0,'127.0.0.1',resolve));
  siteUrl=`http://127.0.0.1:${siteServer.address().port}/`;
  const cdpPort=await port();
  let inspector;
  child=spawn(binary,[`--user-data-dir=${path.join(work,'profile')}`,`--remote-debugging-port=${cdpPort}`,'--remote-debugging-address=127.0.0.1','--inspect=0'],{stdio:['ignore','pipe','pipe']});
  child.stderr.on('data',data=>{
    stderr+=data.toString();
    inspector ||= stderr.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1];
  });
  child.stdout.on('data',data=>{if(String(data).includes('Failed to') || String(data).includes('Error')) process.stdout.write(data);});
  child.on('error',error=>console.error(error));
  const targets=async()=>{try{return await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();}catch{return []}};
  await waitFor(()=>inspector,'main inspector');
  main=await connect(inspector);
  await waitFor(()=>main.evaluate("!!process.mainModule"),'main module initialized');
  await main.evaluate(`globalThis.__nullQaConfirmations=0;
    process.mainModule.require('electron').dialog.showMessageBox=async()=>{globalThis.__nullQaConfirmations++;return {response:1,checkboxChecked:false}};
    process.mainModule.require('electron').app.on('web-contents-created',(_event,wc)=>wc.on('console-message',event=>{if(event.level==='error')console.log('[site Error]',event.message)})); true`);
  const chromeTarget=await waitFor(async()=> (await targets()).find(target=>target.type==='page'&&target.url.includes('/dist/index.html')),'packaged chrome');
  chrome=await connect(chromeTarget.webSocketDebuggerUrl);
  await waitFor(()=>chrome.evaluate("!!document.querySelector('button[aria-label=\"확장 프로그램 스토어\"]')"),'store toolbar button');
  if (!await chrome.evaluate('window.electronAPI.getSettings().then(settings=>settings.firstRunCompleted)')) {
    await waitFor(()=>chrome.evaluate(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='건너뛰기')`),'first run ready');
    await chrome.evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='건너뛰기').click(); true`);
    await waitFor(()=>chrome.evaluate(`!Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='건너뛰기')`),'first run dismissed');
  }
  await delay(200);
  await chrome.evaluate(`document.querySelector('button[aria-label="확장 프로그램 스토어"]').click(); true`);
  const storeTarget=await waitFor(async()=> (await targets()).find(target=>target.url.startsWith('https://chromewebstore.google.com/')),'store opened by button');
  results.storeOpensFromToolbar=true;
  console.log('[packaged QA] store opened');
  store=await connect(storeTarget.webSocketDebuggerUrl);
  await waitFor(()=>store.evaluate(`document.readyState==='complete' && !!document.body?.innerText && typeof chrome.webstorePrivate?.beginInstallWithManifest3==='function'`),'store homepage fully initialized',60000);
  // Navigate within the opened store to a deterministic public extension page.
  // Installation itself is initiated by the real page's normal Add button.
  await store.send('Page.navigate',{url:`https://chromewebstore.google.com/detail/dark-reader/${extensionId}`});
  await waitFor(()=>store.evaluate(`Array.from(document.querySelectorAll('button')).some(button=>!button.disabled && /Add to|추가/.test(button.textContent))`),'store add button',60000);
  await store.evaluate(`Array.from(document.querySelectorAll('button')).find(button=>!button.disabled && /Add to|추가/.test(button.textContent)).click(); true`);
  await waitFor(()=>chrome.evaluate(`window.electronAPI.listExtensions().then(items=>items.some(item=>item.id==='${extensionId}'))`),'packaged store install',90000);
  assert(await main.evaluate('globalThis.__nullQaConfirmations > 0'),'no install confirmation requested');
  results.storeButtonInstallation=true;
  console.log('[packaged QA] Dark Reader installed');
  await waitFor(()=>chrome.evaluate(`!!document.querySelector('browser-action-list')?.shadowRoot?.querySelector('[id="${extensionId}"]')`),'packaged action icon');
  results.toolbarIcon=true;
  await chrome.evaluate(`document.querySelector('browser-action-list').shadowRoot.querySelector('[id="${extensionId}"]').click(); true`);
  const popupTarget=await waitFor(async()=> (await targets()).find(target=>target.type==='page'&&target.url.startsWith(`chrome-extension://${extensionId}/`)&&target.url.includes('popup')),'packaged extension popup');
  const popup=await connect(popupTarget.webSocketDebuggerUrl);
  await waitFor(()=>popup.evaluate('document.body?.innerText.length > 10'),'popup body');
  results.popup=true;
  console.log('[packaged QA] popup loaded');
  const workerTarget=await waitFor(async()=> (await targets()).find(target=>target.type==='service_worker'&&target.url.startsWith(`chrome-extension://${extensionId}/`)),'extension service worker');
  const worker=await connect(workerTarget.webSocketDebuggerUrl);
  const originalCount=await chrome.evaluate("document.querySelectorAll('[data-tab-id]').length");
  await chrome.evaluate(`globalThis.__nullExtensionEvents=[]; window.electronAPI.onExtensionTabSelected(id=>globalThis.__nullExtensionEvents.push({type:'selected',id})); window.electronAPI.onExtensionTabCreated(data=>globalThis.__nullExtensionEvents.push({type:'created',...data})); true`);
  const created=await worker.evaluate(`chrome.tabs.create({url:${JSON.stringify(siteUrl)},active:false})`);
  await waitFor(()=>chrome.evaluate(`document.querySelectorAll('[data-tab-id]').length===${originalCount+1}`),'extension tab in React model');
  results.extensionCreatesManagedTab=true;
  console.log('[packaged QA] managed tab created');
  const adopted=await chrome.evaluate('globalThis.__nullExtensionEvents.find(event=>event.type==="created")');
  assert(adopted?.id && adopted.active===false,'background extension tab was not adopted');
  assert(await chrome.evaluate(`document.querySelector('[data-tab-id][data-active="true"]')?.dataset.tabId!==${JSON.stringify(adopted.id)}`),'background creation unexpectedly selected tab');
  results.backgroundTabPreservesSelection=true;
  await chrome.evaluate(`document.querySelector('button[aria-label="워크스페이스 추가"]').click(); true`);
  await waitFor(()=>chrome.evaluate(`!!document.querySelector('input[aria-label="워크스페이스 이름"]')`),'new workspace dialog');
  await chrome.evaluate(`document.querySelector('input[aria-label="워크스페이스 이름"]').closest('form').requestSubmit(); true`);
  await waitFor(()=>chrome.evaluate(`document.querySelector('select[aria-label="워크스페이스 선택"]').value!=='workspace-default'`),'second workspace active');
  await worker.evaluate(`chrome.tabs.update(${created.id},{active:true})`);
  console.log('[packaged QA] selection requested',created.id);
  await waitFor(()=>chrome.evaluate(`document.querySelector('[data-tab-id][data-active="true"]')?.dataset.tabId===${JSON.stringify(adopted.id)}`),'extension tab selection');
  results.extensionSelectsManagedTab=true;
  assert(await chrome.evaluate(`document.querySelector('select[aria-label="워크스페이스 선택"]').value==='workspace-default'`),'extension activation did not select the tab workspace');
  results.extensionSelectsOtherWorkspace=true;
  const siteTarget=await waitFor(async()=> (await targets()).find(target=>target.url===siteUrl),'controlled document tab');
  const site=await connect(siteTarget.webSocketDebuggerUrl);
  await waitFor(()=>site.evaluate("!!document.querySelector('style.darkreader') || !!document.documentElement?.dataset.darkreaderMode"),'packaged Dark Reader execution');
  results.contentScript=true;
  const nativeScreenshot=await site.send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(work,'extension-page.png'),Buffer.from(nativeScreenshot.data,'base64'));
  // Return to the popup and remove the created native tab through its API.
  await worker.evaluate(`chrome.tabs.remove(${created.id})`);
  await waitFor(()=>chrome.evaluate(`document.querySelectorAll('[data-tab-id]').length===${originalCount}`),'extension tab removal');
  results.extensionClosesManagedTab=true;
  await waitFor(()=>main.evaluate(`(()=>{const e=process.mainModule.require('electron');const win=e.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/dist/index.html'));return win.contentView.children.some(view=>view.webContents?.getURL().startsWith('https://chromewebstore.google.com/') && view.getVisible() && view.getBounds().height>0)})()`),'native page visible after extension closes active tab');
  results.closeRestoresVisiblePage=true;
  const immediate=await worker.evaluate(`chrome.tabs.create({url:${JSON.stringify(siteUrl)},active:false}).then(async tab=>{await chrome.tabs.update(tab.id,{active:true});return tab})`);
  const immediateAdopted=await waitFor(()=>chrome.evaluate(`globalThis.__nullExtensionEvents.filter(event=>event.type==='created').at(-1)?.id!==${JSON.stringify(adopted.id)} && globalThis.__nullExtensionEvents.filter(event=>event.type==='created').at(-1)`),'immediate tab adopted');
  await waitFor(()=>chrome.evaluate(`document.querySelector('[data-tab-id][data-active="true"]')?.dataset.tabId===${JSON.stringify(immediateAdopted.id)}`),'immediate extension create/select synchronization');
  results.immediateCreateSelect=true;
  await worker.evaluate(`chrome.tabs.remove(${immediate.id})`);
  await waitFor(()=>chrome.evaluate(`document.querySelectorAll('[data-tab-id]').length===${originalCount}`),'immediate test tab removal');
  const screenshot=await main.evaluate(`process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/dist/index.html')).capturePage().then(image=>image.toPNG().toString('base64'))`);
  fs.writeFileSync(path.join(work,'packaged-app.png'),Buffer.from(screenshot,'base64'));
  console.log('NULL_PACKAGED_EXTENSION_QA_RESULT='+JSON.stringify({ok:true,results,profile:work}));
}

run().then(async()=>{
  await main?.evaluate("setTimeout(()=>process.mainModule.require('electron').app.quit(),100); true").catch(()=>{});
  for(const socket of sockets) socket.close();
  siteServer?.close();
}).catch(async error=>{
  console.error(error);
  console.error('Completed packaged checks:',results);
  if(store) console.error('Store page state:',await store.evaluate(`({text:document.body?.innerText.slice(0,2200),buttons:[...document.querySelectorAll('button')].map(b=>({text:b.textContent,disabled:b.disabled})).slice(0,25),api:typeof chrome.webstorePrivate?.beginInstallWithManifest3})`).catch(()=>null));
  if(chrome) console.error('Chrome tab state:',await chrome.evaluate(`Array.from(document.querySelectorAll('[data-tab-id]')).map(node=>({id:node.dataset.tabId,active:node.dataset.active,title:node.textContent}))`).catch(()=>null));
  if(main) console.error('Native tab state:',await main.evaluate(`process.mainModule.require('electron').webContents.getAllWebContents().map(wc=>({id:wc.id,url:wc.getURL(),title:wc.getTitle()}))`).catch(()=>null));
  if(main) console.error('Test document:',await main.evaluate(`process.mainModule.require('electron').webContents.getAllWebContents().find(wc=>wc.getURL()===${JSON.stringify(siteUrl)})?.executeJavaScript('document.documentElement.outerHTML.slice(0,4000)')`).catch(()=>null));
  console.error(stderr.slice(-7000));
  await main?.evaluate("setTimeout(()=>process.mainModule.require('electron').app.quit(),100); true").catch(()=>{});
  for(const socket of sockets) socket.close();
  siteServer?.close();
  if(child && child.exitCode===null) child.kill('SIGTERM');
  process.exitCode=1;
});
