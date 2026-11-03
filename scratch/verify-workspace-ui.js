// Invoked by verify-search-inputs.js with NULL_WORKSPACE_QA=true. Real built app,
// disposable profile, loopback pages; never reads personal browser cookies.
const fs = require('node:fs');
const path = require('node:path');
module.exports = async function qa(ctx) {
  const { origin, profile, mainWindow: win, waitFor, delay, results, assert } = ctx;
  const main = expression => ctx.connections().main.evaluate(expression);
  const page = expression => ctx.connections().page.evaluate(expression);
  const guest = suffix => `${win}.contentView.children.find(v=>v.webContents.getURL()===${JSON.stringify(origin+suffix)}).webContents`;
  const sessions = `['/open-tab','/account-b','/account-c'].map(suffix=>${win}.contentView.children.find(v=>v.webContents.getURL()===${JSON.stringify(origin)}+suffix).webContents.session)`;
  async function loadFixtureTabs() {
    // Background restore is intentionally lazy. Explicitly load the three
    // documents before testing their live storage/network behaviour.
    await page(`[['qa-open-tab','/open-tab'],['qa-b','/account-b'],['qa-c','/account-c']].forEach(([id,suffix])=>window.electronAPI.navigateTab(id,${JSON.stringify(origin)}+suffix));true`);
    await waitFor(()=>main(`(()=>{try{return ${sessions}.length===3}catch{return false}})()`),'explicit workspace fixture loads');
  }
  await loadFixtureTabs();
  await waitFor(()=>main(`(()=>{try{return ${sessions}.length===3}catch{return false}})()`),'three workspace pages');
  assert(await main(`(()=>{const s=${sessions};return s[0]===process.mainModule.require('electron').session.defaultSession&&new Set(s).size===3&&s.every(x=>x.isPersistent())})()`),'workspace sessions shared or lost legacy default');
  results.separatePersistentSessionsAndLegacyDefault = true;
  for (const [index, suffix] of ['/open-tab','/account-b','/account-c'].entries()) {
    await main(`(async()=>{const wc=${guest(suffix)};await wc.session.cookies.set({url:${JSON.stringify(origin)},name:'qa_account',value:'account-${index}',expirationDate:Date.now()/1000+86400});await wc.executeJavaScript(
      "localStorage.account='account-${index}';new Promise((resolve,reject)=>{const req=indexedDB.open('accounts',1);req.onupgradeneeded=()=>req.result.createObjectStore('data');req.onsuccess=()=>{const db=req.result,tx=db.transaction('data','readwrite');tx.objectStore('data').put('account-${index}','login');tx.oncomplete=()=>{db.close();resolve(true)}};req.onerror=()=>reject(req.error)})"
    );await wc.session.cookies.flushStore();return true})()`);
  }
  async function checkStorage() {
    for (const [index, suffix] of ['/open-tab','/account-b','/account-c'].entries()) {
      const data = await main(`(async()=>{const wc=${guest(suffix)};return {cookies:await wc.session.cookies.get({url:${JSON.stringify(origin)},name:'qa_account'}),storage:await wc.executeJavaScript("({local:localStorage.account,cookie:document.cookie})"),idb:await wc.executeJavaScript("new Promise(resolve=>{const req=indexedDB.open('accounts',1);req.onsuccess=()=>{const db=req.result,r=db.transaction('data').objectStore('data').get('login');r.onsuccess=()=>{db.close();resolve(r.result)}}})")}})()`);
      assert(data.cookies.length===1&&data.cookies[0].value===`account-${index}`&&data.storage.local===`account-${index}`&&data.idb===`account-${index}`,`storage leaked: ${JSON.stringify(data)}`);
    }
  }
  await checkStorage(); results.cookiesLocalStorageIndexedDbIsolation = true;
  for (const [index,suffix] of ['/open-tab','/account-b','/account-c'].entries()) {
    const cookie = await main(`${guest(suffix)}.executeJavaScript("fetch('/workspace-cookie').then(r=>r.json()).then(r=>r.cookie)")`);
    assert(cookie.includes(`qa_account=account-${index}`)&&![0,1,2].filter(n=>n!==index).some(n=>cookie.includes(`qa_account=account-${n}`)),'outgoing request used wrong account');
    await main(`${guest(suffix)}.executeJavaScript("caches.open('workspace-qa').then(c=>c.put('/account-cache',new Response('account-${index}')))")`);
  }
  for (const [index,suffix] of ['/open-tab','/account-b','/account-c'].entries()) {
    const cached=await main(`${guest(suffix)}.executeJavaScript("caches.open('workspace-qa').then(c=>c.match('/account-cache')).then(r=>r.text())")`);
    assert(cached===`account-${index}`,'CacheStorage leaked');
  }
  results.networkCookiesAndCacheStorageIsolation = true;
  for (const [id,suffix] of [['workspace-account-b','/account-b'],['workspace-account-c','/account-c'],['workspace-default','/open-tab']]) {
    await page(`(()=>{const s=document.querySelector('select[aria-label="워크스페이스 선택"]');s.value='${id}';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    await waitFor(()=>main(`${win}.contentView.children.some(v=>v.getVisible()&&v.webContents.getURL()==='${origin}${suffix}')`),'workspace UI switch');
    assert(await page(`document.querySelector('browser-action-list').getAttribute('partition')==='workspace:${id}'`),'browser action did not follow workspace');
  }
  results.workspaceUiSwitchAndExtensionActionRouting=true;
  // A named OAuth-like popup must inherit the opener, not the UI session.
  await main(`${guest('/account-b')}.executeJavaScript("window.open('${origin}/oauth','null-account-login','width=520,height=600');true",true)`);
  await waitFor(()=>main(`process.mainModule.require('electron').BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().endsWith('/oauth'))`),'auth popup');
  assert(await main(`(()=>{const popup=process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/oauth'));return popup.webContents.session===${guest('/account-b')}.session})()`),'popup escaped workspace');
  await main(`process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/oauth')).close();true`);
  results.popupUsesOpenerSession = true;

  // Shared application data stays outside the partitions.
  await page(`window.electronAPI.switchTab('qa-b');true`);
  assert(await page(`Promise.all([window.electronAPI.getBookmarks(),window.electronAPI.getHistory(),window.electronAPI.getSearchHistory()]).then(([b,h,s])=>b.some(x=>x.id==='qa-bookmark')&&h.some(x=>x.id==='qa-history')&&s.some(x=>x.id==='qa-search'))`),'shared app data missing');
  results.sharedBookmarksHistorySearchHistory = true;
  // Clear only the active workspace through the real Settings IPC.
  await page(`window.electronAPI.clearSiteData(${JSON.stringify(origin)})`);
  assert(await main(`(async()=>{const s=${sessions};return (await s[1].cookies.get({name:'qa_account'})).length===0&&(await s[0].cookies.get({name:'qa_account'})).length===1&&(await s[2].cookies.get({name:'qa_account'})).length===1})()`),'site clear crossed workspace boundary');
  results.siteDataClearTargetsActiveWorkspace = true;
  const downloadDir = path.join(profile, 'downloads'); fs.mkdirSync(downloadDir);
  await page(`window.electronAPI.updateSettings({downloadPath:${JSON.stringify(downloadDir)},askDownloadLocation:false})`);
  await main(`${guest('/account-b')}.downloadURL('${origin}/workspace-file');true`);
  await page(`window.electronAPI.switchTab('qa-c');true`);
  await waitFor(()=>page(`window.electronAPI.getDownloads().then(list=>list.some(d=>d.filename==='workspace-proof.txt'&&d.state==='completed'))`),'download remains reachable across workspace switch');
  await page(`window.electronAPI.getDownloads().then(list=>window.electronAPI.removeDownload(list.find(d=>d.filename==='workspace-proof.txt').id))`);
  await waitFor(()=>page(`window.electronAPI.getDownloads().then(list=>!list.some(d=>d.filename==='workspace-proof.txt'))`),'cross-workspace remove from list');
  assert(fs.existsSync(path.join(downloadDir,'workspace-proof.txt')),'remove from list deleted actual file');
  results.downloadsRemainSharedAndRemovalKeepsFile=true;
  // Re-seed only cleared B so restart can test all three independent stores.
  await main(`(async()=>{const wc=${guest('/account-b')};await wc.session.cookies.set({url:${JSON.stringify(origin)},name:'qa_account',value:'account-1',expirationDate:Date.now()/1000+86400});await wc.executeJavaScript("localStorage.account='account-1';new Promise(resolve=>{const r=indexedDB.open('accounts',1);r.onupgradeneeded=()=>r.result.createObjectStore('data');r.onsuccess=()=>{const db=r.result,t=db.transaction('data','readwrite');t.objectStore('data').put('account-1','login');t.oncomplete=()=>{db.close();resolve(true)}}})");await wc.session.cookies.flushStore();return true})()`);

  await page(`window.electronAPI.switchTab('qa-new-tab');document.querySelector('button[aria-label="브라우저 설정"]').click();true`);
  await waitFor(()=>page(`!!document.querySelector('[data-settings-nav="appearance"]')`),'settings');
  await page(`document.querySelector('[data-settings-nav="appearance"]').click();true`);
  await waitFor(()=>page(`!!document.querySelector('[aria-label="Air 디자인"]')`),'design picker');
  const savedStyleBeforePreview = await page('window.electronAPI.getSettings().then(s=>s.interfaceStyle)');
  const geometry = {};
  for (const style of ['core','air','studio']) {
    await page(`document.querySelector('[data-style="${style}"]').click();true`);
    await waitFor(()=>page(`document.documentElement.dataset.interfaceStyle==='${style}'`),'style preview');
    for (const [width,height] of [[800,600],[1280,720],[1440,900]]) {
      await main(`${win}.setSize(${width},${height});${win}.show();${win}.moveTop();true`); await delay(140);
      const layout = await page(`(()=>{const sc=document.querySelector('.null-settings-scroll'),save=document.querySelector('.null-settings-savebar').getBoundingClientRect(),chrome=document.querySelector('.null-connected-chrome').getBoundingClientRect();return {overflow:sc.scrollWidth>sc.clientWidth+1||document.documentElement.scrollWidth>innerWidth+1,saveVisible:save.bottom<=innerHeight+1,chromeHeight:chrome.height,tabRadius:getComputedStyle(document.querySelector('.null-tab')).borderRadius}})()`);
      assert(!layout.overflow&&layout.saveVisible,`${style} ${width} layout: ${JSON.stringify(layout)}`);
      geometry[`${style}-${width}`]=layout;
    }
    const shot=await ctx.connections().page.send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(profile,`${style}-settings.png`),Buffer.from(shot.data,'base64'));
  }
  assert(new Set(['core','air','studio'].map(s=>geometry[`${s}-1440`].chromeHeight)).size===3,'styles indistinguishable');
  results.threeDistinctStylesAndNineResponsiveLayouts=geometry;
  await page(`document.querySelector('.null-settings-secondary').click();true`);
  assert(await page(`document.documentElement.dataset.interfaceStyle===${JSON.stringify(savedStyleBeforePreview)}`),'cancel failed to restore skin');
  results.designPreviewCancel=true;
  await page(`document.querySelector('[data-style="air"]').click();true`);
  await waitFor(()=>page(`document.querySelector('[data-style="air"]').getAttribute('aria-pressed')==='true'`),'Air draft committed');
  await page(`document.querySelector('.null-settings-save-actions .null-primary-button').click();true`);
  await waitFor(()=>page(`window.electronAPI.getSettings().then(s=>s.interfaceStyle==='air')`),'saved design');
  // Rename is cosmetic, never changes the partition key.
  await page(`window.electronAPI.getWorkspaces().then(s=>window.electronAPI.saveWorkspaces(s.workspaces.map(w=>w.id==='workspace-account-b'?{...w,name:'Renamed B'}:w),'workspace-default'))`);
  // Persist the exact fixture tab set; restarting tests the production restore.
  await page(`window.electronAPI.saveSession([{id:'qa-open-tab',url:'${origin}/open-tab',title:'A',pinned:false,workspaceId:'workspace-default'},{id:'qa-new-tab',url:'null://newtab',title:'New',pinned:false,workspaceId:'workspace-default'},{id:'qa-b',url:'${origin}/account-b',title:'B',pinned:false,workspaceId:'workspace-account-b'},{id:'qa-c',url:'${origin}/account-c',title:'C',pinned:false,workspaceId:'workspace-account-c'}],'qa-new-tab')`);
  await ctx.quit(); await ctx.launch();
  await loadFixtureTabs();
  await waitFor(()=>main(`(()=>{try{return ${sessions}.length===3}catch{return false}})()`),'restored workspace pages');
  await checkStorage();
  assert(await page(`window.electronAPI.getSettings().then(s=>s.interfaceStyle==='air')`),'design lost after restart');
  assert(await page(`window.electronAPI.getWorkspaces().then(s=>s.workspaces.some(w=>w.name==='Renamed B'))`),'rename lost');
  results.restartPreservesThreeAccountsStyleAndRename=true;
  // Actual start pages for each design, saved as screenshots for visual review.
  for (const style of ['core','air','studio']) {
    // Change through real settings UI so React owns the selected preset too.
    await page(`document.querySelector('button[aria-label="브라우저 설정"]').click();true`);
    await waitFor(()=>page(`!!document.querySelector('[data-settings-nav="appearance"]')`),'open appearance');
    await page(`document.querySelector('[data-settings-nav="appearance"]').click();true`);
    await waitFor(()=>page(`!!document.querySelector('[data-style="${style}"]')`),'style option');
    await page(`document.querySelector('[data-style="${style}"]').click();true`);
    await waitFor(()=>page(`document.querySelector('[data-style="${style}"]').getAttribute('aria-pressed')==='true'`),'style draft committed');
    await page(`document.querySelector('.null-settings-save-actions .null-primary-button').click();true`);
    await waitFor(()=>page(`window.electronAPI.getSettings().then(s=>s.interfaceStyle==='${style}')`),'save start style');
    await page(`document.querySelector('.null-settings-close').click();true`);
    await waitFor(()=>page(`!!document.querySelector('.null-newtab-search')`),'start screen');
    const shot=await ctx.connections().page.send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(profile,`${style}-start.png`),Buffer.from(shot.data,'base64'));
  }
  results.startScreensCaptured=true;
  await main(`globalThis.__workspaceQaIds=new Set(${win}.contentView.children.map(v=>v.webContents.id));true`);
  await page(`document.querySelector('[aria-label="워크스페이스 추가"]').click();true`);
  await waitFor(()=>page(`!!document.querySelector('[aria-label="워크스페이스 이름"]')`),'workspace creation form');
  await page(`document.querySelector('[aria-label="워크스페이스 이름"]').closest('form').requestSubmit();true`);
  await waitFor(()=>page(`document.querySelector('select[aria-label="워크스페이스 선택"]').options.length===4`),'workspace created');
  await waitFor(()=>main(`${win}.contentView.children.some(v=>!globalThis.__workspaceQaIds.has(v.webContents.id)&&v.webContents.session!==process.mainModule.require('electron').session.defaultSession)`),'new workspace receives isolated session without creation race');
  assert(await main(`(async()=>{const view=${win}.contentView.children.find(v=>!globalThis.__workspaceQaIds.has(v.webContents.id));return (await view.webContents.session.cookies.get({name:'qa_account'})).length===0})()`),'new workspace inherited a login');
  results.workspaceUiCreationDoesNotInheritCookies=true;
};
