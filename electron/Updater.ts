import { app, BrowserWindow } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import type { UpdateStatus } from './types';

/**
 * Handles release updates for packaged macOS/Windows builds.
 *
 * electron-builder writes the concrete provider configuration to
 * app-update.yml when a release is packaged. Development builds and builds
 * without that metadata are deliberately reported as unavailable instead of
 * pretending that an update check succeeded.
 */
export class UpdateManager {
  private readonly windows = new Set<BrowserWindow>();
  private initialized = false;
  private checking = false;
  private status: UpdateStatus = {
    state: 'idle',
    currentVersion: app.getVersion(),
  };

  public attachWindow(window: BrowserWindow) {
    this.windows.add(window);
    window.webContents.once('destroyed', () => this.windows.delete(window));
    this.sendTo(window);
  }

  public detachWindow(window: BrowserWindow) {
    this.windows.delete(window);
  }

  public initialize() {
    if (this.initialized) return;
    this.initialized = true;

    if (!app.isPackaged || !['darwin', 'win32'].includes(process.platform)) {
      this.setStatus({
        state: 'unavailable',
        message: app.isPackaged
          ? '현재 운영체제에서는 자동 업데이트를 지원하지 않습니다.'
          : '개발 실행에서는 자동 업데이트를 확인하지 않습니다. 패키징된 앱에서 사용할 수 있습니다.',
      });
      return;
    }

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;

    autoUpdater.on('checking-for-update', () => {
      this.checking = true;
      this.setStatus({ state: 'checking', message: '업데이트를 확인하는 중입니다.' });
    });
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.checking = false;
      this.setStatus({
        state: 'available',
        version: info.version,
        message: `새 버전 ${info.version}을(를) 사용할 수 있습니다.`,
      });
    });
    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.checking = false;
      this.setStatus({
        state: 'not-available',
        version: info.version,
        message: '현재 최신 버전을 사용하고 있습니다.',
      });
    });
    autoUpdater.on('download-progress', (progress) => {
      this.setStatus({
        state: 'downloading',
        percent: Math.round(progress.percent),
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
        message: `업데이트 다운로드 중 ${Math.round(progress.percent)}%`,
      });
    });
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.checking = false;
      this.setStatus({
        state: 'downloaded',
        version: info.version,
        percent: 100,
        message: `업데이트 ${info.version}을(를) 설치할 준비가 되었습니다.`,
      });
    });
    autoUpdater.on('error', (error) => {
      this.checking = false;
      const rawMessage = error instanceof Error ? error.message : String(error);
      const isMissingProvider = /latest\.yml|app-update\.yml|provider|Cannot find/i.test(rawMessage);
      this.setStatus({
        state: isMissingProvider ? 'unavailable' : 'error',
        message: isMissingProvider
          ? '업데이트 저장소가 아직 연결되지 않았습니다.'
          : '업데이트를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      });
      console.warn('[updater]', rawMessage);
    });
  }

  public getStatus(): UpdateStatus {
    return { ...this.status };
  }

  public async checkForUpdates(): Promise<UpdateStatus> {
    if (!this.initialized) this.initialize();
    if (this.status.state === 'unavailable' || !app.isPackaged) {
      return this.getStatus();
    }
    if (this.checking) return this.getStatus();

    this.checking = true;
    this.setStatus({ state: 'checking', message: '업데이트를 확인하는 중입니다.' });
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      // The updater error listener owns the user-facing status.
    }
    return this.getStatus();
  }

  public async downloadUpdate(): Promise<UpdateStatus> {
    if (!this.initialized) this.initialize();
    if (this.status.state !== 'available' || !app.isPackaged) return this.getStatus();
    try {
      this.setStatus({ state: 'downloading', percent: 0, message: '업데이트 다운로드를 준비하는 중입니다.' });
      await autoUpdater.downloadUpdate();
    } catch {
      // The updater error listener owns the user-facing status.
    }
    return this.getStatus();
  }

  public installUpdate() {
    if (this.status.state !== 'downloaded') return;
    autoUpdater.quitAndInstall(false, true);
  }

  private setStatus(update: Partial<UpdateStatus>) {
    this.status = { ...this.status, ...update, currentVersion: app.getVersion() };
    for (const window of this.windows) this.sendTo(window);
  }

  private sendTo(window: BrowserWindow) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('app:update-status', this.status);
    }
  }
}
