// Real NULL toolbar -> real extension action -> native popup bounds.
const fs = require('node:fs');
const path = require('node:path');
module.exports = async function qa({main,page,profile,mainWindow:win,waitFor,delay,results,assert}) {
  const extensionPath=path.join(profile,'popup-fixture');fs.mkdirSync(extensionPath);
  fs.writeFileSync(path.join(extensionPath,'manifest.json'),JSON.stringify({manifest_version:3,name:'NULL Popup Bounds QA',version:'1.0.0',action:{default_popup:'popup.html'}}));
  fs.writeFileSync(path.join(extensionPath,'popup.html'),'<!doctype html><html><body style="margin:0;width:550px;height:450px;background:#202228;color:white;font:16px system-ui"><h1 style="padding:20px">Contained extension popup</h1><p style="padding:20px">Native bounds verification</p></body></html>');
  await main.evaluate(`process.mainModule.require('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(extensionPath)}]});true`);
  const installed=await page.evaluate('window.electronAPI.installExtension()');
  assert(installed.ok,'could not install QA extension');
  const id=installed.extension.id;
  const action=`document.querySelector('browser-action-list')?.shadowRoot?.querySelector('[id="${id}"]')`;
  const popup=`process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.getParentWindow()===${win}&&w.webContents.getURL().startsWith('chrome-extension://${id}/'))`;
  await waitFor(()=>page.evaluate(`!!(${action})`),'real toolbar action');
  assert(await page.evaluate(`document.querySelector('browser-action-list').getAttribute('alignment')==='bottom left'`),'toolbar uses outward alignment');
  const cases=[];
  for(const style of ['core','air','studio'])for(const [width,height] of [[800,600],[1280,720]]) {
    await page.evaluate(`document.documentElement.dataset.interfaceStyle='${style}';true`);
    await main.evaluate(`${win}.setBounds({x:50,y:60,width:${width},height:${height}});${win}.show();${win}.moveTop();true`);
    await delay(100);
    await page.evaluate(`${action}.click();true`);
    await waitFor(()=>main.evaluate(`(()=>{const w=${popup};return !!w&&!w.webContents.isLoading()&&w.isVisible()})()`),'visible popup');
    const bounds=await main.evaluate(`(()=>{const e=process.mainModule.require('electron'),p=${popup};return {popup:p.getBounds(),content:${win}.getContentBounds(),area:e.screen.getDisplayMatching(${win}.getBounds()).workArea}})()`);
    for(const region of [bounds.content,bounds.area]) {
      const p=bounds.popup;
      assert(p.x>=region.x&&p.y>=region.y&&p.x+p.width<=region.x+region.width&&p.y+p.height<=region.y+region.height,`popup overflow: ${JSON.stringify({style,width,height,...bounds})}`);
    }
    cases.push({style,width,height,...bounds});
    await main.evaluate(`${popup}.close();true`); await delay(40);
  }
  results.threeStylesTwoSizes=cases;
  // Use another workspace, and a browser partly past the monitor's right edge.
  await page.evaluate(`(()=>{const s=document.querySelector('[aria-label="워크스페이스 선택"]');s.value='workspace-account-b';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await waitFor(()=>page.evaluate(`document.querySelector('browser-action-list').getAttribute('partition')==='workspace:workspace-account-b'&&!!(${action})`),'second workspace action');
  await main.evaluate(`(()=>{const area=process.mainModule.require('electron').screen.getDisplayMatching(${win}.getBounds()).workArea;${win}.setBounds({x:area.x+area.width-600,y:area.y+50,width:800,height:600});return true})()`);
  await delay(100);await page.evaluate(`${action}.click();true`);
  await waitFor(()=>main.evaluate(`!!(${popup})&&${popup}.isVisible()`),'workspace popup');
  const edge=await main.evaluate(`(()=>{const e=process.mainModule.require('electron'),p=${popup},owner=${win},tab=owner.contentView.children.find(v=>v.getVisible());return {popup:p.getBounds(),content:owner.getContentBounds(),area:e.screen.getDisplayMatching(owner.getBounds()).workArea,sessionMatches:tab?.webContents.session===p.webContents.session}})()`);
  for(const r of [edge.content,edge.area])assert(edge.popup.x>=r.x&&edge.popup.y>=r.y&&edge.popup.x+edge.popup.width<=r.x+r.width&&edge.popup.y+edge.popup.height<=r.y+r.height,'workspace edge popup overflow');
  assert(edge.sessionMatches,'popup escaped selected workspace');
  results.workspaceAndDisplayEdge=edge;
  await main.evaluate(`${popup}.close();true`);
  assert(await page.evaluate(`window.electronAPI.removeExtension('${id}')`),'fixture removal failed');
};
