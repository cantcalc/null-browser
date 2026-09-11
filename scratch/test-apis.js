const { app, WebContentsView, BaseWindow, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  console.log('WebContentsView:', typeof WebContentsView);
  console.log('BaseWindow:', typeof BaseWindow);
  console.log('BrowserWindow:', typeof BrowserWindow);
  const win = new BrowserWindow({ width: 800, height: 600, show: false });
  console.log('win.contentView:', typeof win.contentView);
  if (win.contentView) {
    console.log('addChildView:', typeof win.contentView.addChildView);
    console.log('removeChildView:', typeof win.contentView.removeChildView);
  }
  const view = new WebContentsView();
  console.log('view.webContents:', typeof view.webContents);
  console.log('view.setBounds:', typeof view.setBounds);
  console.log('view.setVisible:', typeof view.setVisible);
  app.quit();
});
