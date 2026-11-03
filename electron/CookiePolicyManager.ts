import type { Session } from 'electron';
import type { BrowserSettings } from './types';

type CookieSettings = Pick<BrowserSettings, 'cookiePolicy' | 'cookieExceptions'>;
type CookieDecision = 'allow' | 'block';

function approximateSite(hostname: string): string {
  const normalized = hostname.toLowerCase().replace(/^\.|\.$/g, '');
  if (!normalized || normalized === 'localhost' || /^\d+(?:\.\d+){3}$/.test(normalized) || normalized.includes(':')) return normalized;
  const labels = normalized.split('.').filter(Boolean);
  return labels.length > 2 ? labels.slice(-2).join('.') : normalized;
}

// Keep the existing cookie decisions, but do not bounce every allowed resource
// through the main process. Snapshots change only when cookie settings change.
export class CookiePolicyManager {
  private readonly sessions = new Map<Session, string>();
  private exceptions = new Map<string, CookieDecision>();
  private blockThirdParty = false;
  private filterUrls: string[] = [];
  private policyKey = '';

  constructor(settings: CookieSettings) {
    this.update(settings);
  }

  public update(settings: CookieSettings): void {
    const entries = Object.entries(settings.cookieExceptions).sort(([a], [b]) => a.localeCompare(b));
    const key = JSON.stringify([settings.cookiePolicy, entries]);
    if (key === this.policyKey) return;
    this.policyKey = key;
    this.blockThirdParty = settings.cookiePolicy === 'block-third-party';
    this.exceptions = new Map(entries);
    this.filterUrls = this.blockThirdParty
      ? ['http://*/*', 'https://*/*']
      : entries.filter(([, decision]) => decision === 'block').map(([origin]) => `${origin}/*`);
    for (const ses of this.sessions.keys()) this.configure(ses);
  }

  public attach(ses: Session): void {
    if (this.sessions.has(ses)) return;
    // Empty means NULL has not registered a listener on this session. Do not
    // unsubscribe another component's listener when there is nothing to block.
    this.sessions.set(ses, '');
    this.configure(ses);
  }

  public detach(ses: Session): void {
    if (this.sessions.get(ses)) {
      ses.webRequest.onBeforeSendHeaders(null);
      ses.webRequest.onHeadersReceived(null);
    }
    this.sessions.delete(ses);
  }

  public decision(requestUrl: string, firstPartyUrl?: string): CookieDecision {
    try {
      const target = new URL(requestUrl);
      const explicit = this.exceptions.get(target.origin);
      if (explicit) return explicit;
      if (!this.blockThirdParty || !firstPartyUrl) return 'allow';
      const firstParty = new URL(firstPartyUrl);
      if (this.exceptions.get(firstParty.origin) === 'allow') return 'allow';
      return approximateSite(target.hostname) === approximateSite(firstParty.hostname) ? 'allow' : 'block';
    } catch {
      return 'allow';
    }
  }

  private configure(ses: Session): void {
    const previousFilter = this.sessions.get(ses);
    const filterKey = this.filterUrls.length ? JSON.stringify(this.filterUrls) : '';
    if (previousFilter === filterKey) return;
    this.sessions.set(ses, filterKey);
    if (!filterKey) {
      ses.webRequest.onBeforeSendHeaders(null);
      ses.webRequest.onHeadersReceived(null);
      return;
    }
    const filter = { urls: this.filterUrls };
    ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
      const firstPartyUrl = details.webContents && !details.webContents.isDestroyed()
        ? details.webContents.getURL() : details.referrer;
      if (this.decision(details.url, firstPartyUrl) !== 'block') return callback({ requestHeaders: details.requestHeaders });
      const requestHeaders = { ...details.requestHeaders };
      for (const name of Object.keys(requestHeaders)) {
        if (name.toLowerCase() === 'cookie') delete requestHeaders[name];
      }
      callback({ requestHeaders });
    });
    ses.webRequest.onHeadersReceived(filter, (details, callback) => {
      const firstPartyUrl = details.webContents && !details.webContents.isDestroyed()
        ? details.webContents.getURL() : details.referrer;
      if (this.decision(details.url, firstPartyUrl) !== 'block' || !details.responseHeaders) {
        return callback({ responseHeaders: details.responseHeaders });
      }
      const responseHeaders = { ...details.responseHeaders };
      for (const name of Object.keys(responseHeaders)) {
        if (name.toLowerCase() === 'set-cookie' || name.toLowerCase() === 'set-cookie2') delete responseHeaders[name];
      }
      callback({ responseHeaders });
    });
  }
}
