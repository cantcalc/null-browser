const { app, BrowserWindow, session } = require('electron');
const { buildSync } = require('esbuild');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-capture-'));
app.setPath('userData', path.join(dir, 'profile'));

const managerPath = path.join(dir, 'TabManager.cjs');
buildSync({ absWorkingDir: root, entryPoints: ['electron/TabManager.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: managerPath });
const { TabManager } = require(managerPath);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><html><body style="margin:0;background:#f5b544"><h1 style="padding:80px;font:64px sans-serif">CAPTURE TEST</h1></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const win = new BrowserWindow({ show: true, width: 1000, height: 700, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  const manager = new TabManager(win, session.defaultSession);
  manager.setBounds({ x: 0, y: 0, width: 1000, height: 700 });
  manager.createTab('capture', `http://127.0.0.1:${port}/`);
  manager.switchTab('capture');
  await wait(1800);
  const entry = manager.tabs.get('capture');
  const image = await entry.view.webContents.capturePage();
  const png = image.toPNG();
  const jpg = image.toJPEG(82);
  fs.writeFileSync(path.join(dir, 'view.png'), png);
  fs.writeFileSync('/tmp/null-capture-view.jpg', jpg);
  console.log(JSON.stringify({ dir, isEmpty: image.isEmpty(), width: image.getSize().width, height: image.getSize().height, pngBytes: png.length, jpgBytes: jpg.length }));
  manager.destroyAll();
  server.close();
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
