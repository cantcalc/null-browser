import { session } from 'electron';
import { createHash } from 'crypto';

/** Browser storage only: app settings/history/bookmarks stay in DataManager. */
export class WorkspaceSessions {
  private sessions = new Map<string, Electron.Session>();

  constructor(private readonly prepare: (ses: Electron.Session) => void = () => {}, private readonly legacyWorkspaceId = 'workspace-default') {}

  get(workspaceId = 'workspace-default'): Electron.Session {
    if (workspaceId === this.legacyWorkspaceId) return session.defaultSession;
    let ses = this.sessions.get(workspaceId);
    if (!ses) {
      // Names survive renames and cannot become filesystem paths. Never copy
      // default-session cookies into a new workspace (account leakage).
      const key = createHash('sha256').update(workspaceId).digest('hex').slice(0, 32);
      ses = session.fromPartition(`persist:aero-workspace-${key}`);
      this.sessions.set(workspaceId, ses);
      this.prepare(ses);
    }
    return ses;
  }

  all(): Electron.Session[] { return [session.defaultSession, ...this.sessions.values()]; }
  idFor(ses: Electron.Session): string | undefined {
    if (ses === session.defaultSession) return this.legacyWorkspaceId;
    return [...this.sessions].find(([, value]) => value === ses)?.[0];
  }
}
