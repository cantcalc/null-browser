// Runs only a supplied QA executable with a fresh, owned profile. Does not
// attach to an existing user process or weaken sandbox/TLS/signature checks.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const http = require('node:http'), net = require('node:net');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const expected = require('../package.json').version;
const binary = path.resolve(process.argv[2]);
const profile = fs.mkdtempSync(path.join(os.tmpdir(),'null-release-smoke-'));
const delay = ms => new Promise(r=>setTimeout(r,ms));
let child, clients = [], output = '';
async function wait(check,label) { for(let i=0;i<600;i++){const r=await check();if(r)return r;await delay(80);}throw Error('Timeout: '+label); }
async function connect(url) {
  const ws=new WebSocket(url);clients.push(ws);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
  let id=0;const tasks=new Map();
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data),t=tasks.get(m.id);if(t){clearTimeout(t.timer);tasks.delete(m.id);m.error?t.reject(Error(JSON.stringify(m.error))):t.resolve(m.result);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>reject(Error('CDP '+method)),30000);tasks.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  return {send,evaluate};
}
async function launch() {
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  let endpoint;output='';child=spawn(binary,[`--user-data-dir=${profile}`,`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1','--inspect=0'],{stdio:['ignore','pipe','pipe']});
  child.on('error',e=>{output+=String(e);});
  for(const stream of [child.stdout,child.stderr])stream.on('data',d=>{output+=d.toString();endpoint ||= output.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/)?.[1];});
  await wait(()=>endpoint,'owned main inspector');const main=await connect(endpoint);
  await wait(()=>main.evaluate("!!process.mainModule&&process.mainModule.require('electron').app.isReady()"),'app ready');
  const target=await wait(async()=>{try{return(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page'&&t.url.includes('/dist/index.html'));}catch{return null;}},'packaged UI');
  const page=await connect(target.webSocketDebuggerUrl);await wait(()=>page.evaluate('!!window.electronAPI'),'preload API');
  return {main,page};
}
async function quit(main){const done=new Promise(r=>child.once('exit',r));await main.evaluate("setTimeout(()=>process.mainModule.require('electron').app.quit(),30);true");for(const c of clients)c.close();clients=[];await Promise.race([done,delay(10000)]);assert.notEqual(child.exitCode,null,'App did not exit');}
const fixture=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><title>NULL owned release smoke</title><p>Owned local document</p>');});
async function run(){
  assert(fs.existsSync(binary),'Missing executable');await new Promise(r=>fixture.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${fixture.address().port}`;
  let {main,page}=await launch();
  const info=await main.evaluate("(()=>{const e=process.mainModule.require('electron');return{version:e.app.getVersion(),name:e.app.getName(),profile:e.app.getPath('userData')}})()");
  assert.equal(info.version,expected);assert.equal(info.name,'NULL');assert.equal(path.resolve(info.profile),profile);
  await page.evaluate("window.electronAPI.updateSettings({firstRunCompleted:true,searchEngine:'bing'})");
  await wait(()=>page.evaluate("!!document.querySelector('.null-newtab-search input')"),'home screen');
  assert(await page.evaluate("document.title==='NULL'&&document.querySelectorAll('.null-newtab-logo').length===1"));
  await page.evaluate("document.querySelector('.null-omnibox input').focus();document.querySelector('.null-omnibox input').select();true");
  await page.send('Input.insertText',{text:origin});
  for(const type of ['keyDown','keyUp'])await page.send('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='keyDown'?{text:'\r'}:{})});
  await wait(()=>main.evaluate("process.mainModule.require('electron').BrowserWindow.getAllWindows().some(w=>w.contentView.children.some(v=>v.webContents.getTitle()==='NULL owned release smoke'&&!v.webContents.isLoading()))"),'actual native page load');
  await quit(main);({main,page}=await launch());
  assert(await page.evaluate("window.electronAPI.getSettings().then(s=>s.searchEngine==='bing'&&s.firstRunCompleted)"),'Settings did not survive restart');
  await quit(main);
  const result={ok:true,platform:process.platform,arch:process.arch,version:expected,firstLaunch:true,homeLogo:true,nativePageLoad:true,exitAndRelaunch:true,settingsPersistence:true,isolatedProfile:true,profile};
  fs.mkdirSync('release',{recursive:true});fs.writeFileSync(`release/smoke-${process.platform}.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
run().catch(e=>{console.error(e);console.error(output.slice(-4000));process.exitCode=1;}).finally(()=>{for(const ws of clients)ws.close();if(child?.exitCode===null)child.kill();fixture.close();});
