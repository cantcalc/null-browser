import { app, session, dialog, webContents } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import { ElectronChromeExtensions, type ChromeExtensionOptions } from 'electron-chrome-extensions';
import { installChromeWebStore, uninstallExtension } from 'electron-chrome-web-store';
import type { InstalledExtension } from './types';
import { constrainExtensionPopup } from './ExtensionPopupBounds';
import { registerExtensionCompatibility } from './ExtensionCompatibility';

interface StoredExtension {
  path: string;
}

const STORE_FILE = 'extensions.json';

/**
 * Chrome Web Store installs, browser APIs, action popups and legacy unpacked
 * installs share a catalog across normal workspace sessions. Execution and
 * storage stay session-local. Private sessions remain extension-free.
 */
export class ExtensionManager {
  constructor(private ownsTab: (contents: Electron.WebContents) => boolean = () => false) {}
  private initializations = new Map<Electron.Session, Promise<void>>();
  private activeSessions = new Set<Electron.Session>();
  private expectedEvents = new WeakMap<Electron.Session, Set<string>>();
  private syncQueue = Promise.resolve();
  private extensionPaths = new Set<string>();
  private bridge: ElectronChromeExtensions | undefined;
  private listeners = new Set<() => void>();

  public get runtime(): ElectronChromeExtensions | undefined {
    return this.bridge;
  }

  private get managedPath(): string {
    return path.join(app.getPath('userData'), 'Extensions');
  }

  public onChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyChanged() {
    for (const listener of this.listeners) listener();
  }

  private isManaged(extensionPath: string): boolean {
    const relative = path.relative(this.managedPath, extensionPath);
    return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
  }

  private get storePath(): string {
    return path.join(app.getPath('userData'), STORE_FILE);
  }

  private normalizePath(extensionPath: string): string {
    return path.resolve(extensionPath.trim());
  }

  private toInfo(extension: Electron.Extension): InstalledExtension {
    const manifest = extension.manifest || {};
    return {
      id: extension.id,
      name: extension.name || String(manifest.name || extension.id),
      version: extension.version || String(manifest.version || 'unknown'),
      path: extension.path,
      description: typeof manifest.description === 'string' ? manifest.description : undefined,
      manifestVersion: typeof manifest.manifest_version === 'number' ? manifest.manifest_version : undefined,
      source: this.isManaged(extension.path) ? 'webstore' : 'unpacked',
    };
  }

  private async saveStoredPaths(): Promise<void> {
    const payload: StoredExtension[] = Array.from(this.extensionPaths)
      .sort((a, b) => a.localeCompare(b))
      .map((extensionPath) => ({ path: extensionPath }));
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    await fs.writeFile(this.storePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  private async readStoredPaths(): Promise<string[]> {
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((entry): entry is StoredExtension => Boolean(entry && typeof entry === 'object' && typeof (entry as StoredExtension).path === 'string'))
        .map((entry) => this.normalizePath(entry.path));
    } catch {
      return [];
    }
  }

  private async validateExtensionDirectory(extensionPath: string): Promise<void> {
    const stats = await fs.stat(extensionPath);
    if (!stats.isDirectory()) {
      throw new Error('확장 프로그램 폴더를 선택해 주세요.');
    }

    const manifestPath = path.join(extensionPath, 'manifest.json');
    const rawManifest = await fs.readFile(manifestPath, 'utf8');
    const manifest: unknown = JSON.parse(rawManifest);
    if (!manifest || typeof manifest !== 'object') {
      throw new Error('manifest.json 형식이 올바르지 않습니다.');
    }
    const typedManifest = manifest as { name?: unknown; version?: unknown; manifest_version?: unknown };
    if (typeof typedManifest.name !== 'string' || typeof typedManifest.version !== 'string') {
      throw new Error('manifest.json에 name과 version이 필요합니다.');
    }
    if (typedManifest.manifest_version !== 2 && typedManifest.manifest_version !== 3) {
      throw new Error('Manifest V2 또는 V3 확장 프로그램만 지원합니다.');
    }
  }

  initialize(impl: Omit<ChromeExtensionOptions, 'session' | 'modulePath'> = {}, ses = session.defaultSession): Promise<void> {
    let initialization = this.initializations.get(ses);
    if (!initialization) {
      initialization = this.initializeSession(impl, ses);
      this.initializations.set(ses, initialization);
    }
    return initialization;
  }

  private async initializeSession(impl: Omit<ChromeExtensionOptions, 'session' | 'modulePath'>, ses: Electron.Session): Promise<void> {
    await app.whenReady();
    const runtime = new ElectronChromeExtensions({ session: ses, ...impl });
    registerExtensionCompatibility(ses, this.ownsTab);
    runtime.on('browser-action-popup-created', constrainExtensionPopup);
    // Register after the bridge and before loading any extension/worker.
    for (const type of ['frame', 'service-worker'] as const) {
      ses.registerPreloadScript({
        id: `null-extension-compat-${type}`,
        type,
        matches: ['chrome-extension://*/*'],
        filePath: path.join(__dirname, 'extensionCompatPreload.js'),
      });
    }
    if (ses === session.defaultSession) this.bridge = runtime;
    ElectronChromeExtensions.handleCRXProtocol(ses);
    const catalogChanged = (kind: 'loaded' | 'unloaded', extension: Electron.Extension) => {
      this.notifyChanged();
      // Electron can emit unload after removeExtension() has returned. Track
      // the exact expected event, not an async-duration suppression flag.
      if (this.expectedEvents.get(ses)?.delete(`${kind}:${extension.id}`)) return;
      if (!this.activeSessions.has(ses)) return;
      // Installation choices are common. Extension storage/workers remain in
      // the originating browser session, never sharing Google login cookies.
      const catalog = ses.extensions.getAllExtensions().filter(item => item.id !== extension.id);
      if (kind === 'loaded') catalog.push(extension);
      this.syncQueue = this.syncQueue.then(async () => {
        for (const other of this.activeSessions) {
          if (other === ses) continue;
          const expected = this.expectedEvents.get(other) || new Set<string>();
          this.expectedEvents.set(other, expected);
          for (const extension of other.extensions.getAllExtensions()) {
            if (!catalog.some(item => item.id === extension.id)) {
              expected.add(`unloaded:${extension.id}`);
              other.extensions.removeExtension(extension.id);
            }
          }
          for (const extension of catalog) {
            const current = other.extensions.getExtension(extension.id);
            if (current?.version === extension.version && current.path === extension.path) continue;
            if (current) {
              expected.add(`unloaded:${current.id}`);
              other.extensions.removeExtension(current.id);
            }
            expected.add(`loaded:${extension.id}`);
            try { await other.extensions.loadExtension(extension.path, { allowFileAccess: true }); }
            catch (error) { expected.delete(`loaded:${extension.id}`); throw error; }
          }
        }
      }).catch(error => console.error('[extensions] Workspace catalog sync failed:', error));
    };
    ses.extensions.on('extension-loaded', (_event, extension) => catalogChanged('loaded', extension));
    ses.extensions.on('extension-unloaded', (_event, extension) => catalogChanged('unloaded', extension));

    await installChromeWebStore({
      session: ses,
      extensionsPath: this.managedPath,
      minimumManifestVersion: 3,
      // The upstream updater reloads packages without consulting beforeInstall.
      // Do not silently grant added host/API permissions on a later version.
      autoUpdate: false,
      beforeInstall: async (details) => {
        // The store bridge is deliberately restricted to the real top-level
        // store, even if a page imitates its origin or calls its IPC directly.
        if (details.frame.isDestroyed() || details.frame.parent ||
            new URL(details.frame.url).origin !== 'https://chromewebstore.google.com' ||
            !/^[a-p]{32}$/.test(details.id) || details.manifest.manifest_version !== 3) {
          return { action: 'deny' };
        }
        const owner = webContents.fromFrame(details.frame);
        if (!owner || owner.session !== ses) return { action: 'deny' };
        const permissions = [
          ...(details.manifest.permissions || []),
          ...(details.manifest.host_permissions || []),
        ].filter((value): value is string => typeof value === 'string');
        const { response } = await dialog.showMessageBox({
          type: 'question',
          title: '확장 프로그램 추가',
          message: `${details.localizedName || details.manifest.name}을(를) NULL에 추가할까요?`,
          detail: permissions.length > 0
            ? `요청 권한\n${permissions.map((permission) => `• ${permission}`).join('\n')}`
            : '이 확장 프로그램은 추가 사이트 권한을 요청하지 않습니다.',
          buttons: ['취소', '확장 프로그램 추가'],
          defaultId: 1,
          cancelId: 0,
          noLink: true,
          ...(details.icon.isEmpty() ? {} : { icon: details.icon }),
        });
        return { action: response === 1 ? 'allow' : 'deny' };
      },
    });
    const storePreload = ses.getPreloadScripts().find((preload) => preload.id === 'electron-chrome-web-store');
    if (storePreload) ses.unregisterPreloadScript(storePreload.id);
    ses.registerPreloadScript({
      id: 'null-chrome-web-store',
      type: 'frame',
      matches: ['https://chromewebstore.google.com/*'],
      filePath: path.join(__dirname, 'webStorePreload.js'),
    });

    const storedPaths = await this.readStoredPaths();
    const uniquePaths = Array.from(new Set(storedPaths));
    let changed = uniquePaths.length !== storedPaths.length;

    for (const extensionPath of uniquePaths) {
      try {
        await this.validateExtensionDirectory(extensionPath);
        // Store extensions are discovered by the store loader above. Keep the
        // old extensions.json migration limited to user-selected directories.
        if (this.isManaged(extensionPath)) { changed = true; continue; }
        const extension = await ses.extensions.loadExtension(extensionPath, { allowFileAccess: true });
        this.extensionPaths.add(extension.path);
      } catch (error) {
        changed = true;
        console.warn(`[extensions] Could not restore ${extensionPath}:`, error instanceof Error ? error.message : error);
      }
    }

    if (ses === session.defaultSession && (changed || this.extensionPaths.size !== uniquePaths.length)) {
      await this.saveStoredPaths();
    }
    await this.syncQueue;
    this.activeSessions.add(ses);
    this.notifyChanged();
  }

  async list(ses = session.defaultSession): Promise<InstalledExtension[]> {
    await this.initialize({}, ses);
    return ses.extensions.getAllExtensions().map((extension) => this.toInfo(extension));
  }

  async install(extensionPath: string): Promise<InstalledExtension> {
    await this.initialize();
    await this.syncQueue;
    const normalizedPath = this.normalizePath(extensionPath);
    await this.validateExtensionDirectory(normalizedPath);

    const alreadyLoaded = session.defaultSession.extensions.getAllExtensions().find((extension) => path.resolve(extension.path) === normalizedPath);
    if (alreadyLoaded) return this.toInfo(alreadyLoaded);

    const extension = await session.defaultSession.extensions.loadExtension(normalizedPath, { allowFileAccess: true });
    this.extensionPaths.add(extension.path);
    await this.saveStoredPaths();
    await this.syncQueue;
    return this.toInfo(extension);
  }

  async remove(extensionId: string): Promise<boolean> {
    await this.initialize();
    await this.syncQueue;
    if (!/^[a-p]{32}$/.test(extensionId)) return false;
    const extension = session.defaultSession.extensions.getAllExtensions().find((item) => item.id === extensionId);
    if (!extension) return false;

    if (this.isManaged(extension.path)) {
      // Remove the store package as well as unloading it, or it would return
      // on restart. User-selected extension directories are never deleted.
      await uninstallExtension(extensionId, { session: session.defaultSession, extensionsPath: this.managedPath });
    } else {
      session.defaultSession.extensions.removeExtension(extensionId);
    }
    this.extensionPaths.delete(extension.path);
    await this.saveStoredPaths();
    await this.syncQueue;
    return true;
  }
}
