import { dialog, ipcMain, webContents } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const CHANNEL = 'null:extension-compat';
const sessions = new WeakMap<Electron.Session, (contents: Electron.WebContents) => boolean>();
const workers = new WeakSet<Electron.ServiceWorkerMain>();
let listening = false;
const captureGrants = new WeakMap<Electron.WebContents, { until: number; extensionId: string; sourceUrl?: string; consumerId: number }>();

export function hasExtensionCaptureGrant(contents: Electron.WebContents | null, permission: string, securityOrigin?: string): boolean {
  if (!contents || contents.isDestroyed() || permission !== 'display-capture') return false;
  const grant = captureGrants.get(contents);
  if (!grant || grant.until < performance.now() || !contents.session.extensions.getExtension(grant.extensionId)) return false;
  try {
    const consumer = webContents.fromId(grant.consumerId);
    if (!consumer || consumer.isDestroyed() || consumer.session !== contents.session) return false;
    const consumerUrl = new URL(consumer.getURL());
    if (consumerUrl.protocol !== 'chrome-extension:' || consumerUrl.hostname !== grant.extensionId) return false;
    if (!grant.sourceUrl) return consumer === contents;
    // Electron may send the capture permission against the SOURCE tab rather
    // than the offscreen consumer. Its native securityOrigin still identifies
    // the requesting extension. A website's own capture request never matches.
    const requester = new URL(securityOrigin || '');
    return contents.getURL() === grant.sourceUrl && requester.protocol === 'chrome-extension:' && requester.hostname === grant.extensionId;
  } catch { return false; }
}

// This endpoint can read a bounded body sample, so a tabs permission alone is
// deliberately insufficient. The extension must have matching host access.
export function hasExtensionHostAccess(manifest: Record<string, any>, rawUrl: string): boolean {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return false; }
  if (!/^https?:$/.test(url.protocol)) return false;
  const patterns = [...(manifest.host_permissions || []), ...(manifest.manifest_version === 2 ? manifest.permissions || [] : [])];
  return patterns.some((pattern: unknown) => {
    if (typeof pattern !== 'string') return false;
    if (pattern === '<all_urls>') return true;
    const match = /^(\*|https?):\/\/(\*|\*\.[^/]+|[^/]+)\/(.*)$/.exec(pattern);
    if (!match || (match[1] !== '*' && `${match[1]}:` !== url.protocol)) return false;
    const host = match[2].toLowerCase();
    return host === '*' || url.hostname === host ||
      (host.startsWith('*.') && (url.hostname === host.slice(2) || url.hostname.endsWith(host.slice(1))));
  });
}

async function request(ses: Electron.Session, senderUrl: string, method: string, argument: unknown) {
  const url = new URL(senderUrl);
  if (url.protocol !== 'chrome-extension:' || !/^[a-p]{32}$/.test(url.hostname)) throw new Error('Not an extension context');
  const extension = ses.extensions.getExtension(url.hostname);
  if (!extension || (method !== 'page-text' && method !== 'capture-tab')) throw new Error('Invalid extension request');
  const options = argument && typeof argument === 'object' ? argument as { targetTabId?: unknown; consumerTabId?: unknown } : {};
  const tabId = method === 'capture-tab' ? options.targetTabId : argument;
  if (!Number.isInteger(tabId)) throw new Error('Invalid tab');
  const target = webContents.fromId(tabId as number);
  if (!target || target.isDestroyed() || target.session !== ses || !sessions.get(ses)?.(target)) throw new Error('Tab is not in this workspace');
  if (method === 'capture-tab') {
    // Electron filters unknown Chrome permissions out of getManifest(). The
    // installed package is the source shown to the user at installation.
    const declared = JSON.parse(await readFile(join(extension.path, 'manifest.json'), 'utf8'));
    if (!Array.isArray(declared.permissions) || !declared.permissions.includes('tabCapture')) throw new Error('tabCapture permission is required');
    if (options.consumerTabId !== undefined) throw new Error('consumerTabId is not supported');
    // MV3 workers hand the id to their own offscreen document. Never register
    // a stream for a website, another extension, or a different workspace.
    const consumers = webContents.getAllWebContents().filter(contents => {
      if (contents.isDestroyed() || contents.session !== ses || contents.getType() !== 'remote') return false;
      try { const at = new URL(contents.getURL()); return at.protocol === 'chrome-extension:' && at.hostname === extension.id; } catch { return false; }
    });
    if (consumers.length !== 1 || !/^https?:/.test(target.getURL())) throw new Error('An offscreen extension document and a website tab are required');
    const consumer = consumers[0];
    const originalUrl = target.getURL();
    const { response } = await dialog.showMessageBox({
      type: 'question', title: '확장 프로그램 탭 캡처',
      message: `${extension.name}에 이 탭의 화면·오디오 접근을 허용할까요?`,
      detail: `${target.getTitle() || new URL(originalUrl).hostname}\n${new URL(originalUrl).origin}\n\n음량·오디오 확장은 이 접근을 사용해 탭 소리를 처리합니다. 다른 탭이나 데스크톱 전체에 대한 허용은 아닙니다.`,
      buttons: ['취소', '이 탭 허용'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (response !== 1) throw new Error('Tab capture was cancelled');
    if (target.isDestroyed() || consumer.isDestroyed() || target.getURL() !== originalUrl || !ses.extensions.getExtension(extension.id)) throw new Error('The tab or extension changed');
    const sourceId = target.getMediaSourceId(consumer);
    const until = performance.now() + 10000;
    captureGrants.set(consumer, { until, extensionId: extension.id, consumerId: consumer.id });
    captureGrants.set(target, { until, extensionId: extension.id, consumerId: consumer.id, sourceUrl: originalUrl });
    return sourceId;
  }
  if (!hasExtensionHostAccess(extension.manifest, target.getURL())) throw new Error('Extension has no host access to this tab');
  // No extension-supplied JavaScript is evaluated. CLD runs locally in the
  // caller through the real chrome.i18n.detectLanguage API.
  return target.executeJavaScript('document.body?.innerText.slice(0, 20000) || ""');
}

export function registerExtensionCompatibility(ses: Electron.Session, ownsTab: (contents: Electron.WebContents) => boolean) {
  sessions.set(ses, ownsTab);
  if (!listening) {
    listening = true;
    ipcMain.handle(CHANNEL, (event, method: string, tabId: unknown) => {
      if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !sessions.has(event.sender.session)) throw new Error('Not an extension host');
      return request(event.sender.session, event.senderFrame.url, method, tabId);
    });
  }
  ses.serviceWorkers.on('running-status-changed', ({ runningStatus, versionId }) => {
    if (runningStatus !== 'starting') return;
    const worker = ses.serviceWorkers.getWorkerFromVersionID(versionId);
    if (!worker || !worker.scope.startsWith('chrome-extension://') || workers.has(worker)) return;
    workers.add(worker);
    worker.ipc.handle(CHANNEL, async (_event, method: string, tabId: unknown) => {
      const task = worker.startTask();
      try { return await request(ses, worker.scope, method, tabId); }
      finally { task.end(); }
    });
  });
}
