// Three identical pages, same app/window/view count. Only Session partitioning
// differs. Run each mode in fresh processes; working-set sums aren't PSS.
const { app, BrowserWindow, WebContentsView, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(root, 'tmp', 'workspace-memory-'));
app.setPath('userData', profile);
const isolated = process.env.NULL_WORKSPACE_BENCH === 'isolated';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = http.createServer((_req,res) => {
  res.writeHead(200, {'content-type':'text/html'});
  res.end('<!doctype html><body style="background:#fafafa"><h1>Workspace session cost</h1>'+Array.from({length:200},(_,i)=>`<p>Deterministic fixture row ${i}</p>`).join('')+'</body>');
});
app.whenReady().then(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  const win = new BrowserWindow({show:false,width:1000,height:700});
  const views=[];
  for(let i=0;i<3;i++){
    const ses=isolated&&i>0?session.fromPartition(`persist:benchmark-${i}`):session.defaultSession;
    const view=new WebContentsView({webPreferences:{session:ses,sandbox:true,contextIsolation:true,nodeIntegration:false}});
    win.contentView.addChildView(view);view.setBounds({x:0,y:0,width:1000,height:700});view.setVisible(i===0);views.push(view);
    await view.webContents.loadURL(url);
  }
  await delay(1000);
  const samples=[];
  for(let i=0;i<5;i++){
    const metrics=app.getAppMetrics();
    samples.push({processes:metrics.length,renderers:metrics.filter(p=>p.type==='Tab').length,workingSetMiB:metrics.reduce((sum,p)=>sum+p.memory.workingSetSize,0)/1024});
    await delay(150);
  }
  for(const ses of new Set(views.map(v=>v.webContents.session)))await ses.cookies.flushStore();
  const diskSize=dir=>fs.readdirSync(dir,{withFileTypes:true}).reduce((n,item)=>{const p=path.join(dir,item.name);try{return n+(item.isDirectory()?diskSize(p):fs.statSync(p).size)}catch{return n}},0);
  const result={isolated,views:views.length,windows:BrowserWindow.getAllWindows().length,samples,profileBytes:diskSize(profile),electron:process.versions.electron};
  fs.writeFileSync(path.join(profile,'result.json'),JSON.stringify(result,null,2));
  console.log('NULL_WORKSPACE_MEMORY='+JSON.stringify({...result,profile}));
  for(const view of views)view.webContents.close({waitForBeforeUnload:false});win.destroy();
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));app.quit();
}).catch(e=>{console.error(e);app.exit(1)});
