const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const qa=require('./smoke-installed.cjs'),target=require('../package.json').version;
const binary=path.resolve(process.argv[2]),install=process.argv.includes('--install');
const result={targetVersion:target,platform:process.platform,controlledOlderTestBuild:true,check:false,downloaded:false,install:false,restarted:false};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(check,label,ms=180000){const end=Date.now()+ms;while(Date.now()<end){const r=await check();if(r)return r;await delay(400);}throw Error('Timeout: '+label);}
async function run(){
  let {main,page}=await qa.launch();
  result.baseVersion=await main.evaluate("process.mainModule.require('electron').app.getVersion()");assert.notEqual(result.baseVersion,target);
  await main.evaluate(`(()=>{const e=process.mainModule.require('electron'),f=process.mainModule.require('fs'),p=${JSON.stringify(path.join(qa.profile,'updater-cache'))};f.mkdirSync(p,{recursive:true});e.app.setPath('cache',p);return true})()`);
  await page.evaluate("window.electronAPI.updateSettings({firstRunCompleted:true,saveSearchHistory:false})");
  await page.evaluate("globalThis.__nullUpdateStatuses=[];window.electronAPI.onUpdateStatus(s=>globalThis.__nullUpdateStatuses.push(s));void window.electronAPI.checkForUpdates();true");
  await wait(()=>page.evaluate("globalThis.__nullUpdateStatuses.some(s=>s.state==='available')"),'new GitHub Release discovered');
  const found=await page.evaluate("globalThis.__nullUpdateStatuses.find(s=>s.state==='available')");assert.equal(found.version,target);result.check=true;
  await page.evaluate("void window.electronAPI.downloadUpdate();true");
  const status=await wait(async()=>{const s=await page.evaluate("globalThis.__nullUpdateStatuses.at(-1)");return s&&['downloaded','error','unavailable'].includes(s.state)?s:null;},'update download and native verification');
  result.lastStatus=status;result.progressObserved=await page.evaluate("globalThis.__nullUpdateStatuses.some(s=>s.state==='downloading'&&typeof s.percent==='number')");
  if(status.state!=='downloaded')throw Error('Native updater did not prepare installation: '+status.state);
  result.downloaded=true;
  if(!install){await qa.quit(main);return;}
  assert.equal(process.platform,'win32','Full unattended install test is Windows-only');
  const old=qa.getChild(),exited=new Promise(r=>old.once('exit',r));
  await page.evaluate("window.electronAPI.installUpdate();true").catch(()=>{});
  qa.disconnect();
  await Promise.race([exited,delay(30000)]);assert.notEqual(old.exitCode,null,'Old application did not quit');
  const escaped=binary.replaceAll("'","''");
  const getVersion=()=>execFileSync('powershell',['-NoProfile','-Command',`(Get-Item -LiteralPath '${escaped}').VersionInfo.ProductVersion`],{encoding:'utf8'}).trim();
  await wait(()=>{try{return getVersion()===target;}catch{return false;}},'new EXE installed');result.install=true;
  const processes=()=>JSON.parse(execFileSync('powershell',['-NoProfile','-Command',`ConvertTo-Json -InputObject @((Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${escaped}' }) | Select-Object -ExpandProperty ProcessId) -Compress`],{encoding:'utf8'}).trim()||'[]');
  await wait(()=>processes().length>0,'updated app automatically restarted');result.restarted=true;
  execFileSync('powershell',['-NoProfile','-Command',`Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${escaped}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`]);
  ({main,page}=await qa.launch());assert.equal(await main.evaluate("process.mainModule.require('electron').app.getVersion()"),target);
  assert(await page.evaluate("window.electronAPI.getSettings().then(s=>s.saveSearchHistory===false)"),'QA profile settings lost during update');result.versionAfterRestart=target;result.qaSettingsPreserved=true;
  await qa.quit(main);
}
run().then(()=>{result.ok=true;}).catch(e=>{result.ok=false;result.error=String(e);console.error(e);process.exitCode=1;}).finally(()=>{qa.cleanup();fs.mkdirSync('release',{recursive:true});fs.writeFileSync(`release/update-e2e-${process.platform}.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));});
