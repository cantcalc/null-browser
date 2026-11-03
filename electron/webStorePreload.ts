import { ipcRenderer, webFrame } from 'electron';

// Give the installation API only to the real store's top-level frame.
// In particular, a look-alike hostname must never receive management APIs.
if (location.origin === 'https://chromewebstore.google.com' && window.top === window) {
  require('electron-chrome-web-store/preload');

  // The store's Google-branded-browser check is separate from its extension
  // installer capability check. Our real bridge can install extensions while
  // the page still advertises downloading Chrome. Upstream then renames that
  // download button to "Install NULL", although it still downloads Chrome.
  // Hide ONLY the two known download promotions, after both the native IPC
  // endpoint and page bridge are ready. Never enable an Add button, rewrite a
  // support verdict, impersonate Chrome's integrity headers, or hide an actual
  // installation/permission error. Exact selectors intentionally fail open if
  // the store changes its markup. CSS also covers SPA navigation without a
  // MutationObserver, polling, or retaining page DOM nodes.
  void ipcRenderer.invoke('chromeWebstore.getFullChromeVersion').then(async version => {
    if (!version || typeof version.version_number !== 'string' || !version.version_number) return;
    const ready = await webFrame.executeJavaScript(`Boolean(
      globalThis.chrome?.webstorePrivate?.beginInstallWithManifest3 &&
      globalThis.chrome?.webstorePrivate?.getExtensionStatus &&
      globalThis.chrome?.management?.getAll
    )`);
    if (!ready) return;
    await webFrame.insertCSS(`
      [jscontroller="h4ilFc"][role="dialog"][aria-labelledby="promo-header"],
      [jscontroller="o2G9me"]:has(button[jscontroller="O626Fe"]) {
        display: none !important;
      }
    `);
  }).catch(error => console.warn('[web-store] Download promotion cleanup skipped:', String(error)));
}
