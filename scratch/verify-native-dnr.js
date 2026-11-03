// Native Electron DNR smoke test. No NULL ad-blocking substitute is involved.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'null-native-dnr-'));
app.setPath('userData',profile);
let requests=0;
const fixture=http.createServer((request,response)=>{if(request.url.includes('null-dnr-block-me'))requests++;response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><title>DNR fixture</title>response');});
app.whenReady().then(async()=>{
  await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${fixture.address().port}`;
  const extensionPath=path.join(profile,'extension');fs.mkdirSync(extensionPath);
  const rule={id:1,priority:1,action:{type:'block'},condition:{urlFilter:'null-dnr-block-me',resourceTypes:['xmlhttprequest']}};
  fs.writeFileSync(path.join(extensionPath,'manifest.json'),JSON.stringify({manifest_version:3,name:'Native DNR verification',version:'1.0.0',permissions:['declarativeNetRequest'],host_permissions:['<all_urls>'],declarative_net_request:{rule_resources:[{id:'qa_rules',enabled:true,path:'rules.json'}]},action:{default_popup:'popup.html'}}));
  fs.writeFileSync(path.join(extensionPath,'rules.json'),JSON.stringify([rule]));
  fs.writeFileSync(path.join(extensionPath,'popup.html'),'<!doctype html><title>DNR API probe</title>');
  const ses=session.defaultSession;
  const extension=await ses.extensions.loadExtension(extensionPath);
  const api=new BrowserWindow({show:false,webPreferences:{session:ses,sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await api.loadURL(`chrome-extension://${extension.id}/popup.html`);
  const probe=await api.webContents.executeJavaScript(`(async()=>{
    const result={enabled:await chrome.declarativeNetRequest.getEnabledRulesets(),before:await chrome.declarativeNetRequest.getDynamicRules()};
    try{await chrome.declarativeNetRequest.updateEnabledRulesets({enableRulesetIds:['qa_rules']});result.staticEnabled=await chrome.declarativeNetRequest.getEnabledRulesets()}catch(error){result.staticError=String(error)}
    try{await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:[2],addRules:[${JSON.stringify({...rule,id:2})}]});result.after=await chrome.declarativeNetRequest.getDynamicRules()}catch(error){result.error=String(error)}return result;
  })()`);
  const site=new BrowserWindow({show:false,webPreferences:{session:ses,sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await site.loadURL(origin);
  const fetchResult=await site.webContents.executeJavaScript("fetch('/null-dnr-block-me').then(r=>({allowed:true,status:r.status}),error=>({allowed:false,error:String(error)}))");
  const result={electron:process.versions.electron,chromium:process.versions.chrome,probe,fetchResult,serverRequests:requests,profile};
  fs.writeFileSync(path.join(profile,'result.json'),JSON.stringify(result,null,2));
  console.log('NULL_NATIVE_DNR_RESULT='+JSON.stringify(result));
  site.destroy();api.destroy();fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));app.quit();
}).catch(error=>{console.error(error);app.exit(1)});
