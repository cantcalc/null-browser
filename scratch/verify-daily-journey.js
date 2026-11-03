const fs=require('node:fs'),path=require('node:path');
module.exports=async function({main,page,profile,origin,mainWindow:initialWindow,waitFor,delay,results,assert,fill,key,loaded,address}){
  const windowId=await main.evaluate(`${initialWindow}.id`);
  const win=`process.mainModule.require('electron').BrowserWindow.fromId(${windowId})`;
  const checks=results.checks=[];
  const check=async(name,fn)=>{try{const detail=await fn();checks.push({name,ok:true,detail});}catch(e){checks.push({name,ok:false,error:String(e)});}console.log('[daily] '+JSON.stringify(checks.at(-1)));};
  const guest=`${win}.contentView.children.find(v=>v.getVisible()).webContents`;
  const count=()=>page.evaluate(`document.querySelectorAll('[data-tab-id]').length`);
  const click=selector=>page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click();true`);
  const menu=accelerator=>main.evaluate(`(()=>{const walk=m=>m.items.flatMap(i=>[i,...(i.submenu?walk(i.submenu):[])]);const item=walk(process.mainModule.require('electron').Menu.getApplicationMenu()).find(i=>i.accelerator===${JSON.stringify(accelerator)});if(!item)throw Error('menu missing');item.click();return true})()`);
  const navigate=async url=>{await fill(address,url);await key('Enter','Enter',13,'\r');await loaded(url);};
  await check('new tab button',async()=>{const n=await count();await click('button[title^="새 탭 열기"]');await waitFor(async()=>await count()===n+1,'new tab');});
  await check('address/back/forward/reload buttons',async()=>{
    await navigate(origin+'/journey-a');await navigate(origin+'/journey-b');
    await click('button[title^="뒤로 가기"]');await loaded(origin+'/journey-a');
    await click('button[title^="앞으로 가기"]');await loaded(origin+'/journey-b');
    await click('button[title^="새로고침"]');await loaded(origin+'/journey-b');
  });
  await check('bookmark star add/remove',async()=>{
    await click('button[title="현재 페이지 북마크 추가"]');
    await waitFor(()=>page.evaluate(`window.electronAPI.getBookmarks().then(b=>b.some(x=>x.url==='${origin}/journey-b'))`),'bookmark added');
    await click('button[title="북마크에서 제거"]');
    await waitFor(()=>page.evaluate(`window.electronAPI.getBookmarks().then(b=>!b.some(x=>x.url==='${origin}/journey-b'))`),'bookmark removed');
  });
  await check('zoom menu and reset',async()=>{
    await menu('CmdOrCtrl+=');await waitFor(()=>main.evaluate(`${guest}.getZoomFactor()>1`),'zoom in');
    await menu('CmdOrCtrl+0');await waitFor(()=>main.evaluate(`${guest}.getZoomFactor()===1`),'zoom reset');
  });
  await check('find text / clearing search clears native highlight',async()=>{
    await main.evaluate(`(()=>{const g=${guest},stop=g.stopFindInPage.bind(g);globalThis.__findClears=0;g.stopFindInPage=(...args)=>{globalThis.__findClears++;return stop(...args)};${win}.webContents.send('menu:open-find');return true})()`);
    await waitFor(()=>page.evaluate(`!!document.querySelector('.find-bar input')`),'find bar');
    await waitFor(()=>main.evaluate(`!!${win}.contentView.children.find(v=>v.getVisible())`),'page stays visible while finding');
    const findBottom=await page.evaluate(`document.querySelector('.null-find-row').getBoundingClientRect().bottom`);
    assert(await main.evaluate(`${win}.contentView.children.find(v=>v.getVisible()).getBounds().y>=${findBottom-1}`),'Find bar overlaps native webpage');
    await fill('.find-bar input','Search');
    await waitFor(()=>page.evaluate(`document.querySelector('.find-bar').innerText.includes('/1')`),'find result');
    const before=await main.evaluate('globalThis.__findClears');
    await fill('.find-bar input','');await delay(150);
    const after=await main.evaluate('globalThis.__findClears');
    await click('.find-bar button[title="닫기 (ESC)"]');
    assert(after>before,'empty Find query leaves the old native highlight active');
  });
  await check('close/reopen tab native menu',async()=>{
    const n=await count();await menu('CmdOrCtrl+W');await waitFor(async()=>await count()===n-1,'close tab');
    await menu('CmdOrCtrl+Shift+T');await waitFor(async()=>await count()===n,'reopen tab');await loaded(origin+'/journey-b');
  });
  await check('tab context menu duplicate/pin/mute',async()=>{
    const tabId=await page.evaluate(`document.querySelector('[data-tab-id][data-active="true"]').dataset.tabId`);
    const openMenu=()=>page.evaluate(`(()=>{const t=document.querySelector('[data-tab-id="${tabId}"]');const r=t.getBoundingClientRect();t.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.x+30,clientY:r.y+15}));return true})()`);
    const action=text=>page.evaluate(`Array.from(document.querySelectorAll('.null-popover button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click();true`);
    await openMenu();await action('사이트 음소거');await waitFor(()=>main.evaluate(`${guest}.isAudioMuted()`),'mute');
    await openMenu();await action('사이트 음소거 해제');await waitFor(()=>main.evaluate(`!${guest}.isAudioMuted()`),'unmute');
    await openMenu();await action('탭 고정');await openMenu();
    assert(await page.evaluate(`Array.from(document.querySelectorAll('.null-popover button')).some(b=>b.textContent.trim()==='탭 고정 해제')`),'pin missing');
    await action('탭 고정 해제');
    const n=await count();await openMenu();await action('탭 복제');await waitFor(async()=>await count()===n+1,'duplicate tab');
    await loaded(origin+'/journey-b');
  });
  await check('devtools open/close',async()=>{
    await click('button[title^="크롬 개발자 도구"]');await waitFor(()=>main.evaluate(`${guest}.isDevToolsOpened()`),'devtools open');
    await click('button[title^="크롬 개발자 도구"]');await waitFor(()=>main.evaluate(`!${guest}.isDevToolsOpened()`),'devtools close');
  });
  await check('context link opens in background / external URL activates',async()=>{
    const beforeId=await main.evaluate(`${guest}.id`),n=await count();
    await main.evaluate(`(()=>{const e=process.mainModule.require('electron'),original=e.Menu.buildFromTemplate;e.Menu.buildFromTemplate=items=>{globalThis.__qaLinkItems=items;return {popup(){}}};try{${guest}.emit('context-menu',{}, {x:20,y:20,linkURL:'${origin}/context-background',selectionText:''})}finally{e.Menu.buildFromTemplate=original}__qaLinkItems.find(i=>i.label==='새 탭에서 링크 열기').click();return true})()`);
    await waitFor(async()=>await count()===n+1,'background link tab');
    assert(await main.evaluate(`${guest}.id===${beforeId}`),'context-menu background link stole the active tab');
    await main.evaluate(`process.mainModule.require('electron').app.emit('open-url',{preventDefault(){}},'${origin}/external-link');true`);
    await loaded(origin+'/external-link');
    assert(await main.evaluate(`${guest}.id!==${beforeId}`),'external URL did not activate its new tab');
    await navigate(origin+'/journey-b');
  });
  await check('screenshot / source / PDF file',async()=>{
    assert(await page.evaluate(`window.electronAPI.captureVisiblePage().then(image=>!!image&&image.startsWith('data:image/'))`),'screenshot failed');
    const tabId=await page.evaluate(`window.electronAPI.getSession().then(s=>s.activeTabId)`);
    assert(await page.evaluate(`window.electronAPI.getPageSource(${JSON.stringify(tabId)}).then(s=>!!s&&s.includes('Search input QA page'))`),'page source failed');
    const pdf=path.join(profile,'journey.pdf');
    await main.evaluate(`process.mainModule.require('electron').dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(pdf)}});true`);
    assert(await page.evaluate(`window.electronAPI.savePageAsPdf(${JSON.stringify(tabId)})`),'save PDF failed');
    assert(fs.readFileSync(pdf).subarray(0,4).toString()==='%PDF','invalid PDF');
    return {pdfBytes:fs.statSync(pdf).size};
  });
  await check('private/new window lifecycle',async()=>{
    await page.evaluate(`window.electronAPI.newPrivateWindow();true`);
    const privateWin=`process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('incognito=1'))`;
    await waitFor(()=>main.evaluate(`!!(${privateWin})&&${privateWin}.contentView.children.length>0`),'private window');
    assert(await main.evaluate(`${privateWin}.contentView.children.every(v=>!v.webContents.session.isPersistent())`),'private persistent session');
    await main.evaluate(`${privateWin}.close();true`);
    await waitFor(()=>main.evaluate(`!(${privateWin})`),'private window closed');
    const before=await main.evaluate(`process.mainModule.require('electron').BrowserWindow.getAllWindows().length`);
    await page.evaluate(`window.electronAPI.newWindow();true`);
    await waitFor(()=>main.evaluate(`process.mainModule.require('electron').BrowserWindow.getAllWindows().length===${before+1}`),'normal new window');
    await main.evaluate(`process.mainModule.require('electron').BrowserWindow.getAllWindows().filter(w=>w!==${win}).forEach(w=>w.close());true`);
  });
  await check('updater check / dev disabled',async()=>{const state=await page.evaluate('window.electronAPI.checkForUpdates()');if(process.env.NULL_SEARCH_PACKAGED==='true')assert(['not-available','available','error'].includes(state.state),JSON.stringify(state));else assert(state.state==='unavailable'&&state.message.includes('개발'),JSON.stringify(state));return state.state;});
  results.sites=[];
  if(process.env.NULL_DAILY_EXTERNAL){
    for(const [name,url] of [['Google','https://www.google.com/'],['YouTube','https://www.youtube.com/'],['GitHub','https://github.com/'],['ChatGPT','https://chatgpt.com/'],['MDN','https://developer.mozilla.org/en-US/'],['News','https://news.ycombinator.com/']]){
      const start=Date.now();
      try{
        await fill(address,url);await key('Enter','Enter',13,'\r');
        await waitFor(()=>main.evaluate(`(()=>{const g=${guest};return !g.isLoading()&&g.getURL().startsWith(${JSON.stringify(url)})})()`),'external site '+name,18000);
        try{await waitFor(()=>main.evaluate(`${guest}.executeJavaScript('(document.body?.innerText.length||0)>10')`),'SPA content '+name,12000);}catch{}
        const state=await main.evaluate(`${guest}.executeJavaScript('({title:document.title,ready:document.readyState,textLength:document.body?.innerText.length||0})')`);
        const chrome=await page.evaluate(`({error:!!document.querySelector('.null-error'),background:getComputedStyle(document.querySelector('.null-connected-chrome')).backgroundColor})`);
        results.sites.push({name,ok:state.textLength>10&&!chrome.error,...state,...chrome,ms:Date.now()-start});
      }catch(e){results.sites.push({name,ok:false,error:String(e),ms:Date.now()-start});await main.evaluate(`${guest}.stop();true`).catch(()=>{});}
      console.log('[site] '+JSON.stringify(results.sites.at(-1)));
    }
  }
  fs.writeFileSync(path.join(profile,'daily-result.json'),JSON.stringify(results,null,2));
};
