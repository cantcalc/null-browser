const { app, BrowserWindow } = require('electron');
const { buildSync } = require('esbuild');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Compile only the real TabManager module. Requiring the bundled main entry
// would also start the application, so the old test never exercised the
// production manager and could report a false positive.
const testRuntimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-tab-test-'));
const compiledManagerPath = path.join(testRuntimeDir, 'TabManager.cjs');
const compiledGuestPreloadPath = path.join(testRuntimeDir, 'guestPreload.js');
buildSync({
  absWorkingDir: path.join(__dirname, '..'),
  entryPoints: ['electron/TabManager.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  outfile: compiledManagerPath,
});
buildSync({
  absWorkingDir: path.join(__dirname, '..'),
  entryPoints: ['electron/guestPreload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  outfile: compiledGuestPreloadPath,
});
const { TabManager } = require(compiledManagerPath);

app.whenReady().then(() => {
  console.log('--- Starting real TabManager 20-tab lifecycle test ---');

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const manager = new TabManager(win);
  manager.setBounds({ x: 0, y: 76, width: 1200, height: 724 });

  for (let i = 1; i <= 20; i++) {
    manager.createTab(`test-tab-${i}`, 'about:blank');
  }
  manager.switchTab('test-tab-1');
  manager.setOverlay(true);
  manager.setOverlay(false);

  if (manager.getTabCount() !== 20) {
    throw new Error(`Expected TabManager to own 20 tabs, got ${manager.getTabCount()}`);
  }
  if (win.contentView.children.length !== 20) {
    throw new Error(`Expected 20 child views, got ${win.contentView.children.length}`);
  }
  console.log('TabManager owns 20 tabs and 20 native child views.');

  for (let i = 2; i <= 20; i++) {
    manager.closeTab(`test-tab-${i}`);
  }
  if (manager.getTabCount() !== 1 || win.contentView.children.length !== 1) {
    throw new Error(
      `Expected one tab/view after cleanup, got ${manager.getTabCount()} tabs and ${win.contentView.children.length} views`
    );
  }

  manager.destroyAll();
  if (manager.getTabCount() !== 0 || win.contentView.children.length !== 0) {
    throw new Error('destroyAll() did not release every WebContentsView');
  }

  console.log('--- TEST PASSED: real TabManager lifecycle and cleanup confirmed ---');
  win.destroy();
  fs.rmSync(testRuntimeDir, { recursive: true, force: true });
  app.quit();
}).catch((error) => {
  console.error(error);
  fs.rmSync(testRuntimeDir, { recursive: true, force: true });
  app.exit(1);
});
