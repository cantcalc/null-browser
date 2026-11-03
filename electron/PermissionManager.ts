import { DataManager } from './DataManager';
import { randomUUID } from 'crypto';
import { PermissionPrompt } from './types';

type PermissionDecision = 'allow' | 'deny' | 'once';

interface PendingPermission {
  webContents: Electron.WebContents;
  callback: (permissionGranted: boolean) => void;
  session: Electron.Session;
  origin: string;
  permission: string;
  timer: NodeJS.Timeout;
}

export class PermissionManager {
  private dataManager: DataManager;
  private sessionDecisions = new WeakMap<Electron.Session, Map<string, 'allow' | 'deny'>>();
  private pending = new Map<string, PendingPermission>();
  private destructionListeners = new Map<Electron.WebContents, () => void>();

  constructor(dataManager: DataManager) {
    this.dataManager = dataManager;
  }

  public handlePermissionRequest(
    webContents: Electron.WebContents,
    permission: string,
    callback: (permissionGranted: boolean) => void,
    details?: Electron.PermissionRequest,
    onPrompt?: (prompt: PermissionPrompt) => void,
  ) {
    const url = details?.requestingUrl || webContents.getURL();
    if (!url) {
      return callback(false);
    }

    try {
      const origin = new URL(url).origin;
      const savedDecision = this.getDecision(webContents.session, origin, permission);

      if (savedDecision === 'allow') {
        return callback(true);
      } else if (savedDecision === 'deny') {
        return callback(false);
      }

      if (!onPrompt || webContents.isDestroyed()) return callback(false);

      const requestId = randomUUID();
      const timer = setTimeout(() => {
        this.resolveRequest(requestId, 'deny', webContents);
      }, 30_000);
      this.pending.set(requestId, {
        webContents,
        callback,
        session: webContents.session,
        origin,
        permission,
        timer,
      });
      if (!this.destructionListeners.has(webContents)) {
        const listener = () => this.cancelForWebContents(webContents);
        this.destructionListeners.set(webContents, listener);
        webContents.once('destroyed', listener);
      }
      try { onPrompt({ requestId, origin, permission, requestingUrl: url }); }
      catch { this.resolveRequest(requestId, 'deny', webContents); }
    } catch {
      callback(false);
    }
  }

  public handlePermissionCheck(
    _webContents: Electron.WebContents | null,
    permission: string,
    requestingOrigin: string,
    _details?: Electron.PermissionCheckHandlerHandlerDetails
  ): boolean {
    if (!requestingOrigin) return false;
    try {
      const origin = new URL(requestingOrigin).origin;
      const savedDecision = this.getDecision(_webContents?.session, origin, permission);
      if (savedDecision === 'allow') return true;
      if (savedDecision === 'deny') return false;
      return false;
    } catch {
      return false;
    }
  }

  public setDecision(origin: string, permission: string, decision: 'allow' | 'deny') {
    this.dataManager.setPermission(origin, permission, decision);
  }

  public resolveRequest(requestId: string, decision: PermissionDecision, sender?: Electron.WebContents): boolean {
    const pending = this.pending.get(requestId);
    if (!pending || (sender && pending.webContents !== sender)) return false;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    this.releaseDestructionListener(pending.webContents);

    if (decision !== 'once' && pending.session.isPersistent()) {
      this.setDecision(pending.origin, pending.permission, decision);
    } else if (decision === 'allow') {
      this.setSessionDecision(pending.session, pending.origin, pending.permission, 'allow');
    } else if (decision === 'deny') {
      this.setSessionDecision(pending.session, pending.origin, pending.permission, 'deny');
    }

    pending.callback(decision !== 'deny');
    return true;
  }

  public cancelForWebContents(webContents: Electron.WebContents) {
    for (const [requestId, pending] of this.pending) {
      if (pending.webContents !== webContents) continue;
      this.pending.delete(requestId);
      clearTimeout(pending.timer);
      pending.callback(false);
    }
    this.releaseDestructionListener(webContents);
  }

  private releaseDestructionListener(contents: Electron.WebContents) {
    if (Array.from(this.pending.values()).some(request => request.webContents === contents)) return;
    const listener = this.destructionListeners.get(contents);
    if (!listener) return;
    contents.off('destroyed', listener);
    this.destructionListeners.delete(contents);
  }

  public setSessionDecision(session: Electron.Session, origin: string, permission: string, decision: 'allow' | 'deny') {
    let decisions = this.sessionDecisions.get(session);
    if (!decisions) {
      decisions = new Map();
      this.sessionDecisions.set(session, decisions);
    }
    decisions.set(`${origin}\n${permission}`, decision);
  }

  public clearSessionDecision(session: Electron.Session, origin: string, permission: string) {
    this.sessionDecisions.get(session)?.delete(`${origin}\n${permission}`);
  }

  public getSessionPermissions(session: Electron.Session, origin: string): Record<string, 'allow' | 'deny'> {
    const decisions = this.sessionDecisions.get(session);
    if (!decisions) return {};
    const result: Record<string, 'allow' | 'deny'> = {};
    const prefix = `${origin}\n`;
    for (const [key, decision] of decisions) {
      if (key.startsWith(prefix)) result[key.slice(prefix.length)] = decision;
    }
    return result;
  }

  public getAllSessionPermissions(session: Electron.Session): Record<string, Record<string, 'allow' | 'deny'>> {
    const decisions = this.sessionDecisions.get(session);
    const result: Record<string, Record<string, 'allow' | 'deny'>> = {};
    if (!decisions) return result;
    for (const [key, decision] of decisions) {
      const separator = key.indexOf('\n');
      if (separator < 1) continue;
      const origin = key.slice(0, separator);
      const permission = key.slice(separator + 1);
      if (!result[origin]) result[origin] = {};
      result[origin][permission] = decision;
    }
    return result;
  }

  public clearSessionPermissions(session: Electron.Session, origin: string) {
    const decisions = this.sessionDecisions.get(session);
    if (!decisions) return;
    const prefix = `${origin}\n`;
    for (const key of decisions.keys()) {
      if (key.startsWith(prefix)) decisions.delete(key);
    }
  }

  private getDecision(session: Electron.Session | undefined, origin: string, permission: string): 'allow' | 'deny' | undefined {
    const inMemory = session ? this.sessionDecisions.get(session)?.get(`${origin}\n${permission}`) : undefined;
    if (inMemory) return inMemory;
    return session?.isPersistent() ? this.dataManager.getPermission(origin, permission) : undefined;
  }
}
