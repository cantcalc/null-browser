import { BrowserWindow, DownloadItem, shell } from 'electron';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { DownloadItemInfo } from './types';

export interface DownloadPreferences {
  downloadPath: string;
  askDownloadLocation: boolean;
  onUpdate?: (info: DownloadItemInfo) => void;
}

export class DownloadManager {
  private downloads: Map<string, { item: DownloadItem; info: DownloadItemInfo; session: Electron.Session }> = new Map();

  public handleWillDownload(
    _event: Electron.Event,
    item: DownloadItem,
    webContents: Electron.WebContents,
    mainWindow: BrowserWindow | null,
    preferences: DownloadPreferences
  ) {
    const id = `dl-${randomUUID()}`;
    const filename = path.basename(item.getFilename()) || 'download';
    const defaultPath = path.join(preferences.downloadPath, filename);

    if (preferences.askDownloadLocation) {
      item.setSaveDialogOptions({
        defaultPath,
        buttonLabel: '저장',
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      });
    } else {
      item.setSavePath(defaultPath);
    }

    const info: DownloadItemInfo = {
      id,
      filename,
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      state: 'progressing',
      savePath: item.getSavePath(),
      startTime: Date.now(),
      sourceUrl: item.getURL(),
      sourceHostname: (() => {
        try { return new URL(item.getURL()).hostname; } catch { return ''; }
      })(),
    };

    this.downloads.set(id, { item, info, session: webContents.session });
    this.broadcastUpdate(mainWindow, info);
    preferences.onUpdate?.({ ...info });

    item.on('updated', (_event, state) => {
      info.receivedBytes = item.getReceivedBytes();
      info.totalBytes = item.getTotalBytes();
      info.savePath = item.getSavePath();
      info.state = state === 'progressing' ? 'progressing' : 'interrupted';
      this.broadcastUpdate(mainWindow, info);
      preferences.onUpdate?.({ ...info });
    });

    item.once('done', (_event, state) => {
      info.receivedBytes = item.getReceivedBytes();
      info.totalBytes = item.getTotalBytes();
      info.savePath = item.getSavePath();
      info.state = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted';
      this.broadcastUpdate(mainWindow, info);
      preferences.onUpdate?.({ ...info });
    });
  }

  private broadcastUpdate(mainWindow: BrowserWindow | null, info: DownloadItemInfo) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download:updated', info);
    }
  }

  public getDownloads(targetSession?: Electron.Session, persistentOnly = false): DownloadItemInfo[] {
    return Array.from(this.downloads.values())
      .filter((d) => (!targetSession || d.session === targetSession) && (!persistentOnly || d.session.isPersistent()))
      .map((d) => ({ ...d.info }));
  }

  public clearHistory(targetSession?: Electron.Session, cutoff = 0, persistentOnly = false) {
    for (const [id, entry] of this.downloads) {
      // Never remove an active download from the manager: its progress and
      // cancellation handle must remain reachable until it finishes.
      if (entry.info.state !== 'progressing' && (!targetSession || entry.session === targetSession) && (!persistentOnly || entry.session.isPersistent()) && (!cutoff || entry.info.startTime >= cutoff)) {
        this.downloads.delete(id);
      }
    }
  }

  public cancelDownload(id: string, targetSession?: Electron.Session) {
    const entry = this.downloads.get(id);
    if (entry && (!targetSession || entry.session === targetSession) && entry.info.state === 'progressing') {
      entry.item.cancel();
    }
  }

  public getDownloadSession(id: string): Electron.Session | undefined {
    return this.downloads.get(id)?.session;
  }

  public openDownload(id: string, targetSession?: Electron.Session) {
    const entry = this.downloads.get(id);
    if (entry && (!targetSession || entry.session === targetSession) && entry.info.state === 'completed' && entry.info.savePath) {
      shell.openPath(entry.info.savePath);
    }
  }

  public showInFinder(id: string, targetSession?: Electron.Session) {
    const entry = this.downloads.get(id);
    if (entry && (!targetSession || entry.session === targetSession) && entry.info.savePath) {
      shell.showItemInFolder(entry.info.savePath);
    }
  }

  public removeFromList(id: string, targetSession?: Electron.Session) {
    const entry = this.downloads.get(id);
    if (entry && entry.info.state !== 'progressing' && (!targetSession || entry.session === targetSession)) {
      this.downloads.delete(id);
    }
  }

  public removeSession(targetSession: Electron.Session) {
    for (const [id, entry] of this.downloads) {
      if (entry.session === targetSession) this.downloads.delete(id);
    }
  }
}
