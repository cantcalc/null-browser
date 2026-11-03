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
const results = { layouts: [] };
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
    results.onboarding=await page.evaluate("({themes:document.querySelectorAll('[role=dialog] button[aria-label$=\" 테마\"]').length,accent:document.body.innerText.includes('액센트 컬러'),logo:!!document.querySelector('[role=dialog] [data-null-logo]')})");
    assert(results.onboarding.themes===2&&!results.onboarding.accent&&results.onboarding.logo,'onboarding is not monochrome');
    await screenshot('onboarding');
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

const styles=['core','air','studio','focus','outline'];
const requests=[];
const fixture=http.createServer((req,res)=>{
  requests.push({url:req.url,cookie:req.headers.cookie||''});
  res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
  res.end('<!doctype html><title>Private probe</title><p>Owned test document</p>');
});
let origin;
async function click(selector,client=page) {
  const point=await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  for(const type of ['mousePressed','mouseReleased'])await client.send('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...point});
}
async function appearance(theme,style,home='center') {
  await main.evaluate(`${mainWindow}.focus();${mainWindow}.webContents.focus();true`);
  await click('button[aria-label="브라우저 설정"]');
  await waitFor(()=>page.evaluate('!!document.querySelector("[data-settings-page]")'),'settings open');
  await category('appearance');
  await click('[data-theme-choice="'+theme+'"]');
  await click('.null-style-choice[data-style="'+style+'"]');
  await click('[data-home-choice="'+home+'"]');
  await checkLayout();
  const counts=await page.evaluate(`({themes:document.querySelectorAll('[data-theme-choice]').length,styles:document.querySelectorAll('.null-style-choice[data-style]').length,homes:document.querySelectorAll('[data-home-choice]').length,accent:!!document.querySelector('.null-accent-options')})`);
  assert(counts.themes===2&&counts.styles===5&&counts.homes===5&&!counts.accent,'unexpected appearance controls');
  await click('.null-settings-save-actions .null-primary-button');
  await waitFor(()=>page.evaluate(`window.electronAPI.getSettings().then(s=>s.theme===${JSON.stringify(theme)}&&s.interfaceStyle===${JSON.stringify(style)}&&s.homeStyle===${JSON.stringify(home)})`),'appearance persisted');
  if(style==='studio')await screenshot('settings-'+theme+'-'+home);
  await click('[aria-label="설정 탭 닫기"]');
  await waitFor(()=>page.evaluate('!!document.querySelector(".null-newtab")'),'new tab visible');
}
async function layout(theme,style,w,h,home='center') {
  await main.evaluate(`${mainWindow}.setSize(${w},${h});true`);
  await delay(130);
  const state=await page.evaluate(`(()=>{
    const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2}};
    const area=document.querySelector('.null-newtab'),group=document.querySelector('.new-tab-content'),logo=document.querySelector('.null-newtab-logo'),search=document.querySelector('.null-newtab-search'),input=search.querySelector('input'),s=getComputedStyle(document.documentElement),active=document.querySelector('.null-tab[data-active=true]');
    return{theme:document.documentElement.dataset.theme,style:document.documentElement.dataset.interfaceStyle,home:area.dataset.homeStyle,width:innerWidth,height:innerHeight,area:box(area),group:box(group),logo:box(logo),search:box(search),bodyText:area.innerText.trim(),children:group.children.length,inputBox:box(input),background:s.getPropertyValue('--chrome-bg').trim(),foreground:s.getPropertyValue('--text-primary').trim(),muted:s.getPropertyValue('--text-muted').trim(),accent:s.getPropertyValue('--accent').trim(),overflow:document.documentElement.scrollWidth>innerWidth+1,studioRadius:getComputedStyle(active).borderRadius,placeholder:input.placeholder,autocomplete:input.autocomplete}
  })()`);
  assert(state.theme===theme&&state.style===style&&state.home===home,'theme/style/home drift');
  assert(state.children===2&&!state.bodyText,'new tab contains extra visible UI');
  assert(Math.abs(state.group.cx-state.area.cx)<1,'start group not horizontally centered '+JSON.stringify(state));
  if(home==='elevated')assert(state.group.cy<state.area.cy-10,'elevated layout not above center');
  else if(home==='grounded')assert(state.group.cy>state.area.cy+10,'grounded layout not below center');
  else assert(Math.abs(state.group.cy-state.area.cy)<1,'start group not vertically centered '+JSON.stringify(state));
  if(home==='horizontal'&&w>700)assert(state.logo.x+state.logo.width<state.search.x&&Math.abs(state.logo.cy-state.search.cy)<1,'horizontal alignment');
  else assert(Math.abs(state.logo.cx-state.search.cx)<1,'logo/search alignment');
  assert(!state.overflow,'page overflow');
  for(const key of ['logo','search']) {const b=state[key],a=state.area;assert(b.x>=a.x&&b.y>=a.y&&b.x+b.width<=a.x+a.width+1&&b.y+b.height<=a.y+a.height+1,'home content clipped');}
  assert(!state.placeholder&&state.autocomplete==='off','search explanations/suggestions returned');
  if(style==='studio')assert(state.studioRadius==='10px 10px 0px 0px','Studio tab shape changed');
  for(const key of ['background','foreground','muted','accent'])if(state[key].length===4)state[key]='#'+[...state[key].slice(1)].map(c=>c+c).join('');
  const contrast=(a,b)=>{const lum=c=>{const v=c.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2]};const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
  state.textContrast=contrast(state.foreground,state.background);state.mutedContrast=contrast(state.muted,state.background);
  assert(state.textContrast>=7&&state.mutedContrast>=4.5,'insufficient text contrast');
  for(const color of [state.background,state.foreground,state.accent])assert(/^#([a-f0-9]{2})\1\1$/i.test(color),'non-neutral theme token '+color);
  for(const [x,y] of [[.01,.5],[.99,.5],[.5,.1],[.5,.9]]) {
    await page.evaluate("document.activeElement?.blur();true");
    const point={x:state.search.x+state.search.width*x,y:state.search.y+state.search.height*y};
    for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...point});
    assert(await page.evaluate("document.activeElement===document.querySelector('.null-newtab-search input')"),'search padding has a dead hit area');
  }
  assert(await main.evaluate(`${mainWindow}.contentView.children.every(v=>!v.getVisible())`),'native web view overlaps new tab');
  results.layouts.push(state);
  if(w===1440&&style==='studio')await screenshot(home+'-'+theme);
}
async function privateQA(theme) {
  await appearance(theme,'studio');
  await main.evaluate("process.mainModule.require('electron').session.defaultSession.cookies.set("+JSON.stringify({url:'http://127.0.0.1',name:'account',value:'normal-only'})+").then(()=>true)");
  await click('[aria-label="새 시크릿 창"]');
  let target;
  await waitFor(async()=>{
    const windows=await main.evaluate("process.mainModule.require('electron').BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('incognito=1')).map(w=>({id:w.id,url:w.webContents.getURL()}))");
    if(!windows.length)return false;
    const id=await main.evaluate("process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('incognito=1')).webContents.debugger.isAttached()");
    return !id;
  },'native private window');
  const privateId=await main.evaluate("process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('incognito=1')).id");
  const privateWin=`process.mainModule.require('electron').BrowserWindow.fromId(${privateId})`;
  const privateUrl=await main.evaluate(privateWin+'.webContents.getURL()');
  // The existing connect helper speaks CDP; resolve this window's target via
  // the inspector-owned WebContents instead of assuming tab list ordering.
  const targets=await main.evaluate("(async()=>{const text=await(await fetch('http://127.0.0.1:'+process.argv.find(a=>a.startsWith('--remote-debugging-port=')).split('=')[1]+'/json/list')).text();return JSON.parse(text)})()");
  target=targets.find(t=>t.url===privateUrl);
  const p=await connect(target.webSocketDebuggerUrl);
  await waitFor(()=>p.evaluate(`!!document.querySelector('.null-app[data-private="true"]')&&!!document.querySelector('.null-newtab-logo')&&document.documentElement.dataset.theme===${JSON.stringify(theme)}`),'private new tab and saved-theme hydration');
  const state=await p.evaluate("({theme:document.documentElement.dataset.theme,private:document.querySelector('.null-app').dataset.private,badge:!!document.querySelector('.null-private-badge'),history:await window.electronAPI.getHistory(),search:await window.electronAPI.getSearchHistory()})".replace('({','(async()=>({').replace(/\}\)$/,'}))()'));
  assert(state.theme===theme&&state.private==='true'&&!state.badge&&!state.history.length&&!state.search.length,'private UI/history mismatch '+JSON.stringify(state));
  const controls = await p.evaluate(`(()=>{const tab=document.querySelector('.null-tab'),r=tab.getBoundingClientRect();return{workspace:!!document.querySelector('.null-workspacebar'),settings:!!document.querySelector('[aria-label="브라우저 설정"]'),tabLeft:r.left,barTop:document.querySelector('.null-tabbar').getBoundingClientRect().top,platform:window.electronAPI.platform,privateLogo:!!document.querySelector('[data-null-logo="null-private"]')}})()`);
  assert(!controls.workspace&&!controls.settings&&controls.privateLogo&&controls.barTop===0,'private controls are not minimal '+JSON.stringify(controls));
  if(controls.platform==='darwin') {
    assert(controls.tabLeft>=148,'private tab overlaps native traffic lights');
    assert(await main.evaluate("process.mainModule.require('electron').Menu.getApplicationMenu().getMenuItemById('null-preferences').enabled===false"),'private native preferences remain enabled');
  }
  await p.evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:',',metaKey:true,bubbles:true}));true");
  assert(!await p.evaluate("!!document.querySelector('[data-settings-page]')"),'private settings shortcut opened settings');
  const native=await main.evaluate(`${privateWin}.webContents.session.cookies.get({url:'http://127.0.0.1'}).then(c=>({persistent:${privateWin}.webContents.session.isPersistent(),cookies:c.map(x=>x.name)}))`);
  assert(!native.persistent&&!native.cookies.includes('account'),'private login session leaked');
  const image=await p.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(profile,'private-'+theme+'.png'),Buffer.from(image.data,'base64'));
  await p.evaluate("(()=>{const i=document.querySelector('.null-omnibox input');i.focus();i.select();return true})()");
  await p.send('Input.insertText',{text:origin+'/private-probe'});
  for(const type of ['keyDown','keyUp'])await p.send('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='keyDown'?{text:'\r'}:{})});
  await waitFor(()=>main.evaluate(`${privateWin}.contentView.children.some(v=>v.getVisible()&&v.webContents.getURL()===${JSON.stringify(origin+'/private-probe')}&&!v.webContents.isLoading())`),'private actual browsing');
  assert(!requests.filter(r=>r.url==='/private-probe').at(-1)?.cookie.includes('account'),'normal cookie sent by private view');
  assert(await page.evaluate("window.electronAPI.getHistory().then(h=>h.every(x=>!x.url.includes('/private-probe')))"),'private visit saved in normal history');
  await p.evaluate("document.querySelector('.null-omnibox input').focus();true");
  await p.evaluate("document.querySelector('.null-omnibox input').select();true");
  await p.send('Input.insertText',{text:'null://settings'});
  for(const type of ['keyDown','keyUp'])await p.send('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='keyDown'?{text:'\r'}:{})});
  await waitFor(()=>p.evaluate("!!document.querySelector('[data-null-logo=\"null-private\"]')&&!document.querySelector('[data-settings-page]')"),'private internal settings URL returns home');
  await main.evaluate(`${privateWin}.close();true`);results['private-'+theme]={...state,...native,controls,settingsRoutesBlocked:true};
}
async function run(){
  await new Promise(r=>fixture.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+fixture.address().port;
  fs.writeFileSync(path.join(profile,'browser_store.json'),JSON.stringify({lastExitWasClean:true,settings:{theme:'mist',accentColor:'#f43f5e',interfaceStyle:'studio',firstRunCompleted:false,startupBehavior:'restore',newTabConfig:{showLogo:false,showFavorites:true,showRecentSites:true}},bookmarks:[{id:'kept',title:'Kept bookmark',url:origin+'/saved',createdAt:Date.now()}],history:[],session:{tabs:[{id:'qa-newtab',url:'null://newtab',title:'New Tab',workspaceId:'workspace-default'}],activeTabId:'qa-newtab'}}));
  await launch();
  const settings=await page.evaluate('window.electronAPI.getSettings()');
  assert(settings.theme==='paper'&&!('accentColor'in settings)&&!('newTabConfig'in settings),'legacy theme/accent migration failed');
  assert(await page.evaluate("window.electronAPI.getBookmarks().then(b=>b.some(x=>x.id==='kept'))"),'migration deleted bookmarks');
  results.migration=true;
  if(process.env.NULL_PRIVATE_UI_ONLY==='1') {
    await privateQA('noir');await privateQA('paper');
    fs.writeFileSync(path.join(profile,'private-ui-results.json'),JSON.stringify(results,null,2));
    console.log('NULL_PRIVATE_UI_QA='+JSON.stringify({ok:true,privateDark:!!results['private-noir'],privateWhite:!!results['private-paper'],profile}));return;
  }
  // Avoid broad UI mutations: all choices below use the actual settings and
  // Save buttons; only the test window size is controlled through inspector.
  for(const theme of ['noir','paper'])for(const style of styles)for(const home of ['center','compact','elevated','horizontal','grounded']){
    await appearance(theme,style,home);
    for(const [w,h]of [[800,600],[1280,720],[1440,900]])await layout(theme,style,w,h,home);
    console.log('[appearance QA] '+theme+' / '+style+' / '+home);
  }
  await privateQA('noir');await privateQA('paper');
  await appearance('paper','outline','grounded');
  await click('button[aria-label="브라우저 설정"]');await category('appearance');await click('[data-home-choice="compact"]');
  await click('[aria-label="설정 탭 닫기"]');
  assert(await page.evaluate("window.electronAPI.getSettings().then(s=>s.homeStyle==='grounded'&&s.interfaceStyle==='outline')"),'discard saved the home draft');
  await delay(650);await quit();await launch();
  const restored=await page.evaluate('window.electronAPI.getSettings()');
  assert(restored.theme==='paper'&&restored.interfaceStyle==='outline'&&restored.homeStyle==='grounded','appearance restart persistence');
  assert(await page.evaluate("document.title==='NULL'&&document.querySelector('.null-newtab').dataset.homeStyle==='grounded'"),'brand/home not restored');
  assert(await main.evaluate("process.mainModule.require('electron').app.getName()==='NULL'"),'native app name is not NULL');
  assert(!await main.evaluate("process.mainModule.require('electron').BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().includes('incognito=1'))"),'private window restored');
  results.restartPersistence=true;
  fs.writeFileSync(path.join(profile,'monochrome-results.json'),JSON.stringify(results,null,2));
  console.log('NULL_MONOCHROME_QA='+JSON.stringify({ok:true,layouts:results.layouts.length,privateDark:!!results['private-noir'],privateWhite:!!results['private-paper'],profile}));
}
run().catch(async error=>{console.error(error);if(page){await screenshot('failure').catch(()=>{});console.error(await page.evaluate('document.body.innerText.slice(-2200)').catch(()=>null));}fs.writeFileSync(path.join(profile,'monochrome-failure.json'),JSON.stringify({error:String(error),results},null,2));process.exitCode=1;}).finally(async()=>{await quit();fixture.close();});
