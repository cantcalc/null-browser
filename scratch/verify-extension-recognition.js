// Probe a COPY of an installed extension's static files, never its user data.
const fs=require('node:fs');
const path=require('node:path');
module.exports=async function qa({main,page,profile,origin,mainWindow:win,waitFor,delay,results,assert,requests,connect,debugPort}) {
  const source=process.env.NULL_EXTENSION_PROBE_PATH;
  assert(source&&fs.existsSync(path.join(source,'manifest.json')),'NULL_EXTENSION_PROBE_PATH must name static extension files');
  const copy=path.join(profile,'extension-copy');fs.cpSync(source,copy,{recursive:true});
  if(process.env.NULL_WORKER_PRELOAD_PROBE)await main.evaluate(`process.mainModule.require('electron').session.defaultSession.registerPreloadScript({id:'null-worker-probe',type:'service-worker',filePath:${JSON.stringify(path.join(__dirname,'extension-worker-probe.cjs'))}});true`);
  await main.evaluate(`(()=>{const e=process.mainModule.require('electron');globalThis.__extensionErrors=[];e.session.defaultSession.serviceWorkers.on('console-message',(_event,details)=>globalThis.__extensionErrors.push(details));e.app.on('web-contents-created',(_event,wc)=>wc.on('console-message',event=>{if(event.level==='error'||event.level===3)globalThis.__extensionErrors.push({message:event.message,source:event.sourceId})}));e.dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(copy)}]});return true})()`);
  await page.evaluate(`document.querySelector('[data-tab-id="qa-open-tab"]').click();true`);
  await waitFor(()=>main.evaluate(`${win}.contentView.children.some(v=>v.getVisible()&&v.webContents.getURL()==='${origin}/open-tab')`),'HTTP tab selected');
  const guest=`${win}.contentView.children.find(v=>v.getVisible()).webContents`;
  const adUrl=`http://ads.doubleclick.net:${new URL(origin).port}/extension-ad-probe`;
  const fetchAd=label=>main.evaluate(`${guest}.executeJavaScript(${JSON.stringify(`fetch('${adUrl}?${label}').then(r=>r.text().then(body=>({allowed:true,status:r.status,url:r.url,body})),error=>({allowed:false,error:String(error)}))`)})`);
  const before=await fetchAd('before');assert(before.allowed,'baseline fixture request did not reach server');
  const install=await page.evaluate('window.electronAPI.installExtension()');assert(install.ok,JSON.stringify(install));
  const id=install.extension.id;
  if(process.env.NULL_EXTENSION_RELOAD_AFTER_INSTALL){
    await main.evaluate(`${guest}.reload();true`);
    await waitFor(()=>main.evaluate(`!${guest}.isLoading()`),'content scripts after installation');
    await delay(1500);
  }
  const action=`document.querySelector('browser-action-list')?.shadowRoot?.querySelector('[id="${id}"]')`;
  await waitFor(()=>page.evaluate(`!!(${action})`),'extension toolbar action');
  await main.evaluate(`${win}.show();${win}.moveTop();true`);
  await page.evaluate(`${action}.click();true`);
  const popup=`process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('chrome-extension://${id}/')&&w.getParentWindow()===${win})`;
  try { await waitFor(()=>main.evaluate(`!!(${popup})&&!${popup}.webContents.isLoading()`),'extension popup'); }
  catch(error){
    results.errors=await main.evaluate('globalThis.__extensionErrors');
    results.windows=await main.evaluate(`process.mainModule.require('electron').webContents.getAllWebContents().map(w=>({id:w.id,url:w.getURL(),type:w.getType()}))`);
    fs.writeFileSync(path.join(profile,'recognition-failure.json'),JSON.stringify(results,null,2));
    console.error('[extension popup failure] '+JSON.stringify(results));throw error;
  }
  await delay(1200);
  const probe=`(async()=>{
    const safe=async(fn)=>{try{return await Promise.race([fn(),new Promise(resolve=>setTimeout(()=>resolve({timeout:true}),2000))])}catch(error){return {error:String(error)}}};
    return {location:location.href,body:document.body.innerText.slice(0,1500),text:document.body.textContent.slice(0,1500),hostname:document.querySelector('#hostname')?.textContent,classes:document.body.className,
      apis:Object.fromEntries(['declarativeNetRequest','offscreen','tabCapture','userScripts','alarms','scripting','tabs'].map(k=>[k,typeof chrome[k]])),
      functions:Object.fromEntries(['getDynamicRules','getSessionRules','getEnabledRulesets','updateEnabledRulesets','updateDynamicRules'].map(k=>[k,typeof chrome.declarativeNetRequest?.[k]])),
      browserAlias:{type:typeof globalThis.browser,same:globalThis.browser===chrome,commands:typeof globalThis.browser?.commands,tabsQuery:String(globalThis.browser?.tabs?.query).slice(0,120)},
      languageDetection:{type:typeof chrome.i18n.detectLanguage,tab:typeof chrome.tabs.detectLanguage,result:typeof chrome.i18n.detectLanguage==='function'?await safe(()=>chrome.i18n.detectLanguage('This is an English sentence about a browser. The browser can open websites and search for information.')):null,tabResult:typeof chrome.tabs.detectLanguage==='function'?await safe(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return chrome.tabs.detectLanguage(tab.id)}):null},
      moduleAlias:await safe(()=>import(chrome.runtime.getURL('/js/ext.js')).then(m=>({same:m.browser===chrome,commands:typeof m.browser.commands,query:String(m.browser.tabs.query).slice(0,100)}))),
      active:await safe(()=>chrome.tabs.query({active:true,currentWindow:true})),
      all:await safe(()=>chrome.tabs.query({})),
      rules:await safe(()=>chrome.declarativeNetRequest.getEnabledRulesets()),
      background:await safe(()=>chrome.runtime.sendMessage({what:'popupPanelData',origin:${JSON.stringify(origin)},hostname:'127.0.0.1'})),
      win:await safe(()=>chrome.windows.getCurrent())};
  })()`;
  results.initial=await main.evaluate(`${popup}.webContents.executeJavaScript(${JSON.stringify(probe)})`);
  await main.evaluate(`${popup}.close();true`);await delay(150);
  await page.evaluate(`${action}.click();true`);
  await waitFor(()=>main.evaluate(`!!(${popup})&&!${popup}.webContents.isLoading()`),'reopened extension popup');
  await delay(600);
  results.reopened=await main.evaluate(`${popup}.webContents.executeJavaScript(${JSON.stringify(probe)})`);
  results.security={websiteBridgeAbsent:await main.evaluate(`${guest}.executeJavaScript('typeof window.__nullExtensionCompat==="undefined"')`)};
  const otherTab=await main.evaluate(`${win}.contentView.children.find(v=>v.webContents.session!==${guest}.session)?.webContents.id`);
  if(otherTab){
    results.security.otherWorkspaceLanguageDenied=await main.evaluate(`${popup}.webContents.executeJavaScript(${JSON.stringify(`chrome.tabs.detectLanguage(${otherTab}).then(()=>false,error=>String(error).includes('workspace'))`)})`);
    results.security.otherWorkspaceCaptureDenied=await main.evaluate(`${popup}.webContents.executeJavaScript(${JSON.stringify(`chrome.tabCapture.getMediaStreamId({targetTabId:${otherTab}}).then(()=>false,error=>String(error).includes('workspace'))`)})`);
    assert(results.security.otherWorkspaceLanguageDenied&&results.security.otherWorkspaceCaptureDenied,'extension accessed another workspace');
  }
  assert(results.security.websiteBridgeAbsent,'website received extension-only bridge');
  if(process.env.NULL_EXTENSION_LANGUAGE_QA){
    assert(results.reopened.languageDetection.tabResult==='en','actual page language detection failed');
    const tabId=results.reopened.active[0].id;
    const before=await main.evaluate(`${guest}.executeJavaScript('document.querySelector("h1").textContent')`);
    await main.evaluate(`${popup}.webContents.executeJavaScript("document.querySelector('#selectTargetLanguage').value='ko';document.querySelector('#btnTranslate').click();true",true)`);
    let translated=false;
    try { await waitFor(async()=>{const after=await main.evaluate(`${guest}.executeJavaScript('document.querySelector("h1").textContent')`);return after!==before&&/[가-힣]/.test(after)},'real TWP page translation',12000);translated=true; } catch {}
    const after=await main.evaluate(`${guest}.executeJavaScript('document.querySelector("h1").textContent')`);
    if(translated){
      await main.evaluate(`${popup}.webContents.executeJavaScript(${JSON.stringify(`chrome.tabs.sendMessage(${tabId},{action:'translatePage',targetLanguage:'original'}).catch(()=>{})`)})`);
      await waitFor(()=>main.evaluate(`${guest}.executeJavaScript(${JSON.stringify(`document.querySelector('h1').textContent===${JSON.stringify(before)}`)})`),'TWP restore original');
    }
    results.translation={before,after,translated,restored:translated&&await main.evaluate(`${guest}.executeJavaScript(${JSON.stringify(`document.querySelector('h1').textContent===${JSON.stringify(before)}`)})`)};
  }
  if(process.env.NULL_EXTENSION_VOLUME_QA){
    const tabId=results.reopened.active[0].id;
    const offscreen=`process.mainModule.require('electron').webContents.getAllWebContents().find(w=>w.getURL()==='chrome-extension://${id}/html/offscreen.html')`;
    await waitFor(()=>main.evaluate(`!!(${offscreen})`),'Volume Master offscreen document');
    const workerTarget=(await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(t=>t.type==='service_worker'&&t.url.startsWith('chrome-extension://'+id+'/'));
    const workerClient=process.env.NULL_EXTENSION_WORKER_TRACE&&workerTarget&&await connect(workerTarget.webSocketDebuggerUrl);
    if(workerClient)await workerClient.evaluate(`(()=>{globalThis.__qaTrace=[];chrome.runtime.onMessage.addListener(m=>{__qaTrace.push({received:m.action,target:m.target})});const send=chrome.runtime.sendMessage.bind(chrome.runtime),capture=chrome.tabCapture.getMediaStreamId;chrome.runtime.sendMessage=(...args)=>{__qaTrace.push({send:args[0]?.action,target:args[0]?.target});return send(...args).then(r=>{__qaTrace.push({response:args[0]?.action,value:r});return r})};chrome.tabCapture.getMediaStreamId=(...args)=>{__qaTrace.push({capture:'start'});return capture(...args).then(r=>{__qaTrace.push({capture:'complete'});return r})};return true})()`);
    await main.evaluate(`${offscreen}.executeJavaScript("(()=>{globalThis.__qaGain=[];globalThis.__qaSources=[];globalThis.__qaAnalysers=[];globalThis.__qaStreams=[];const a=AudioContext.prototype.createGain,b=AudioContext.prototype.createAnalyser,c=AudioContext.prototype.createMediaStreamSource;AudioContext.prototype.createGain=function(...args){const node=a.apply(this,args);__qaGain.push(node);return node};AudioContext.prototype.createAnalyser=function(...args){const node=b.apply(this,args);__qaAnalysers.push(node);return node};AudioContext.prototype.createMediaStreamSource=function(stream){__qaStreams.push(stream);const node=c.call(this,stream);__qaSources.push(node);return node};return true})()")`);
    await main.evaluate(`${guest}.executeJavaScript("(()=>{window.__qaAudio=new AudioContext();const o=__qaAudio.createOscillator(),g=__qaAudio.createGain();g.gain.value=0.001;o.connect(g).connect(__qaAudio.destination);o.start();return __qaAudio.resume().then(()=>true)})()",true)`);
    await main.evaluate(`process.mainModule.require('electron').dialog.showMessageBox=async()=>({response:0});true`);
    results.captureCancel=await main.evaluate(`${popup}.webContents.executeJavaScript(${JSON.stringify(`chrome.tabCapture.getMediaStreamId({targetTabId:${tabId}}).then(()=>false,e=>String(e).includes('cancelled'))`)})`);
    assert(results.captureCancel,'tab capture cancel was not respected');
    await main.evaluate(`process.mainModule.require('electron').dialog.showMessageBox=async()=>({response:1});true`);
    await main.evaluate(`${popup}.webContents.executeJavaScript(${JSON.stringify(`chrome.runtime.sendMessage({target:'service-worker',action:'popup-gain-change',tabId:${tabId},volumeValue:200}).catch(()=>{})`)})`);
    try{await waitFor(()=>main.evaluate(`${offscreen}.executeJavaScript('__qaGain.some(n=>n.gain.value===2)&&__qaStreams.some(s=>s.getAudioTracks().some(t=>t.readyState==="live"))')`),'Volume Master real audio gain and stream',10000);}
    catch(error){
      results.volumeFailure={trace:workerClient&&await workerClient.evaluate('globalThis.__qaTrace'),errors:await main.evaluate('globalThis.__extensionErrors.filter(e=>e.level===3||e.message.includes("NULL_MSG_TRACE"))'),graph:await main.evaluate(`${offscreen}.executeJavaScript('({gain:__qaGain.map(n=>n.gain.value),streams:__qaStreams.length,keys:Object.keys(window.audioStates||{})})')`)};
      fs.writeFileSync(path.join(profile,'volume-failure.json'),JSON.stringify(results.volumeFailure,null,2));console.error('[volume failure] '+JSON.stringify(results.volumeFailure));throw error;
    }
    // The extension creates two analysers but leaves them disconnected when
    // its visualizer is disabled. Measure branches of the actual live graph,
    // not those disconnected nodes (which correctly report only zeros).
    await main.evaluate(`${offscreen}.executeJavaScript("(()=>{const ctx=__qaGain[0].context;globalThis.__qaBefore=ctx.createAnalyser();globalThis.__qaAfter=ctx.createAnalyser();__qaSources[0].connect(__qaBefore);__qaGain[0].connect(__qaAfter);return true})()")`);
    await delay(600);
    results.volume=await main.evaluate(`${offscreen}.executeJavaScript("(()=>{const rms=__qaAnalysers.map(a=>{const s=new Float32Array(a.fftSize);a.getFloatTimeDomainData(s);return Math.sqrt(s.reduce((v,n)=>v+n*n,0)/s.length)});return {gain:__qaGain.map(n=>n.gain.value),contexts:__qaGain.map(n=>n.context.state),tracks:__qaStreams.map(s=>s.getAudioTracks().map(t=>({state:t.readyState,muted:t.muted}))),rms}})()")`);
    results.volume.source=await main.evaluate(`(async()=>({audible:${guest}.isCurrentlyAudible(),muted:${guest}.isAudioMuted(),context:await ${guest}.executeJavaScript('__qaAudio.state')}))()`);
    results.volume.measuredBeforeAfter=await main.evaluate(`${offscreen}.executeJavaScript("[__qaBefore,__qaAfter].map(a=>{const s=new Float32Array(a.fftSize);a.getFloatTimeDomainData(s);return Math.sqrt(s.reduce((v,n)=>v+n*n,0)/s.length)})")`);
    console.log('[volume probe] '+JSON.stringify(results.volume));
    const [inputRms,outputRms]=results.volume.measuredBeforeAfter;
    assert(inputRms>0.00001&&outputRms/inputRms>1.8&&outputRms/inputRms<2.2,'actual extension graph did not amplify captured audio 2x');
  }
  await main.evaluate(`(()=>{const w=${popup};if(!w)return false;return w.webContents.capturePage().then(image=>{process.mainModule.require('fs').writeFileSync(${JSON.stringify(path.join(profile,'extension-popup.png'))},image.toPNG());return true})})()`);
  const requestCount=requests.filter(url=>url.startsWith('/extension-ad-probe')).length;
  const after=await fetchAd('after');
  const afterCount=requests.filter(url=>url.startsWith('/extension-ad-probe')).length;
  results.adBlocking={before,after,serverCountBefore:requestCount,serverCountAfter:afterCount};
  if(process.env.NULL_EXTENSION_EXPECT_WORKING){
    assert(results.reopened.browserAlias.same&&results.reopened.hostname==='127.0.0.1','website recognition still broken');
    assert(results.reopened.rules.length>0,'no active filtering rules');
    assert(afterCount===requestCount&&after.body!=='ad probe reached server','advertising request reached server');
  }
  results.workers=await main.evaluate(`process.mainModule.require('electron').session.defaultSession.serviceWorkers.getAllRunning()`);
  results.errors=await main.evaluate('globalThis.__extensionErrors');
  results.native=await main.evaluate(`${win}.contentView.children.map(v=>({id:v.webContents.id,url:v.webContents.getURL(),visible:v.getVisible()}))`);
  results.hosts=await main.evaluate(`process.mainModule.require('electron').webContents.getAllWebContents().filter(w=>w.getURL().startsWith('chrome-extension://${id}/')).map(w=>({id:w.id,url:w.getURL(),type:w.getType(),hasWindow:!!process.mainModule.require('electron').BrowserWindow.fromWebContents(w)}))`);
  fs.writeFileSync(path.join(profile,'recognition.json'),JSON.stringify(results,null,2));
  console.log('[extension-recognition] '+JSON.stringify({profile,security:results.security,language:results.initial.languageDetection,translation:results.translation,volume:results.volume,captureCancel:results.captureCancel,hosts:results.hosts,hostname:results.reopened.hostname,adBlocking:results.adBlocking,errors:results.errors.filter(e=>e.level===3||e.level==='error').slice(-8)}));
  await main.evaluate(`(${popup})?.close();true`);
  await page.evaluate(`window.electronAPI.removeExtension('${id}')`);
};
