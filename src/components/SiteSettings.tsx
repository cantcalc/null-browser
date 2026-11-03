import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Bell, Camera, MapPin, Globe2, ChevronDown, RotateCcw, Trash2 } from 'lucide-react';
import type { BrowserSettings } from '../types/browser';
import { ToggleSwitch } from './ToggleSwitch';

type Decision = 'allow' | 'deny' | 'default';
export const SITE_PERMISSIONS = [
  { key: 'notifications', label: '알림', description: '사이트에서 보내는 알림', icon: Bell },
  { key: 'geolocation', label: '위치', description: '현재 위치 사용', icon: MapPin },
  { key: 'media', label: '카메라 및 마이크', description: '영상·음성 입력 사용', icon: Camera },
] as const;
export const permissionLabel = (decision?: string) => decision === 'allow' ? '허용' : decision === 'deny' ? '차단' : '요청 시 확인';

export function PermissionSelect({ label, value, disabled, onChange }: { label: string; value?: string; disabled?: boolean; onChange: (value: Decision) => void }) {
  return <select className="null-permission-select" aria-label={label} value={value || 'default'} disabled={disabled}
    onChange={event => onChange(event.target.value as Decision)}>
    <option value="default">요청 시 확인</option><option value="allow">허용</option><option value="deny">차단</option>
  </select>;
}

export function SiteSettings({ settings, onUpdateSettings, onPermissionsChanged, initialOrigin }: {
  settings: BrowserSettings; onUpdateSettings: (updates: Partial<BrowserSettings>) => void;
  onPermissionsChanged?: () => void; initialOrigin?: string | null;
}) {
  const [section, setSection] = useState<'permissions' | 'cookies' | 'data'>('permissions');
  const [permissions, setPermissions] = useState<Record<string, Record<string, 'allow' | 'deny'>>>({});
  const [data, setData] = useState<Array<{ origin: string; hostname: string; cookieCount: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(initialOrigin || null);
  const [exceptionUrl, setExceptionUrl] = useState('');
  const [exceptionDecision, setExceptionDecision] = useState<'allow' | 'block'>('allow');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  async function load() {
    if (!window.electronAPI) { setLoading(false); return; }
    setLoading(true);
    try {
      const [nextPermissions, nextData] = await Promise.all([window.electronAPI.getAllSitePermissions(), window.electronAPI.listSiteData()]);
      setPermissions(nextPermissions || {}); setData(nextData || []);
    } catch { setError('사이트 설정을 불러오지 못했습니다. 다시 시도해 주세요.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (initialOrigin) { setExpanded(initialOrigin); setSection('permissions'); } }, [initialOrigin]);

  const origins = useMemo(() => Array.from(new Set([
    ...Object.keys(permissions), ...data.map(item => item.origin), ...Object.keys(settings.cookieExceptions), ...(initialOrigin ? [initialOrigin] : []), ...(expanded ? [expanded] : []),
  ])).sort().filter(origin => origin.toLowerCase().includes(query.trim().toLowerCase())), [permissions, data, settings.cookieExceptions, query, initialOrigin, expanded]);
  const filteredData = data.filter(item => `${item.hostname} ${item.origin}`.toLowerCase().includes(query.trim().toLowerCase()));
  async function mutate(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await action();
      if (!result) throw new Error('Rejected');
      await load(); onPermissionsChanged?.(); setNotice(success);
    } catch { setError('변경 내용을 적용하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  }
  function addException(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      const parsed = new URL(exceptionUrl.trim());
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid URL');
      onUpdateSettings({ cookieExceptions: { ...settings.cookieExceptions, [parsed.origin]: exceptionDecision } }); setExceptionUrl('');
    } catch { setError('http:// 또는 https://로 시작하는 올바른 사이트 주소를 입력해 주세요.'); }
  }

  return <div className="null-site-settings" data-site-settings>
    <div className="null-site-sections" role="tablist" aria-label="사이트 설정 구분">
      {([['permissions','권한'],['cookies','쿠키'],['data','저장 데이터']] as const).map(([id,label]) =>
        <button key={id} type="button" role="tab" id={`site-tab-${id}`} aria-controls={`site-panel-${id}`} aria-selected={section === id}
          onClick={() => { setSection(id); setQuery(''); setError(''); setNotice(''); }} data-site-section={id}>{label}</button>)}
    </div>
    {error && <div className="null-settings-inline-error" role="alert">{error}<button type="button" onClick={() => { setError(''); void load(); }}>다시 불러오기</button></div>}
    {notice && <p className="null-site-notice" role="status">{notice}</p>}
    <div id={`site-panel-${section}`} role="tabpanel" aria-labelledby={`site-tab-${section}`}>
      {section === 'permissions' && <>
        <div className="null-site-section-heading"><h2>사이트별 권한</h2><p>기본값은 요청 시 확인입니다. 변경한 권한은 바로 저장됩니다.</p></div>
        <input className="null-field null-site-search" aria-label="권한을 관리할 사이트 찾기" placeholder="사이트 주소로 찾기" value={query} onChange={event => setQuery(event.target.value)} />
        <div className="null-site-list">
          {loading ? <p className="null-site-empty">불러오는 중…</p> : origins.length === 0 ? <p className="null-site-empty">{query ? '일치하는 사이트가 없습니다.' : '아직 관리할 사이트가 없습니다. 사이트에서 권한을 요청하면 여기에 표시됩니다.'}</p> : origins.map(origin => {
            const decisions = permissions[origin] || {}, isExpanded = expanded === origin;
            const hostname = new URL(origin).hostname;
            return <div key={origin} className="null-site-entry" data-site-origin={origin}>
              <button type="button" className="null-site-entry-heading" aria-expanded={isExpanded} onClick={() => setExpanded(isExpanded ? null : origin)}>
                <Globe2 size={18} aria-hidden="true" /><span><strong>{hostname}</strong><small>{origin}</small></span><ChevronDown size={16} className={isExpanded ? 'is-expanded' : ''} />
              </button>
              {isExpanded && <div className="null-site-entry-body">
                {SITE_PERMISSIONS.map(({ key,label,description,icon: Icon }) => <div className="null-setting-row" key={key}>
                  <Icon size={16} aria-hidden="true" /><div className="null-setting-copy"><strong>{label}</strong><small>{description}</small></div>
                  <PermissionSelect label={`${origin} ${label} 권한`} value={decisions[key]} disabled={busy} onChange={decision => void mutate(() => window.electronAPI!.setSitePermission(origin,key,decision),'사이트 권한을 저장했습니다.')} />
                </div>)}
                {Object.keys(decisions).filter(key => !SITE_PERMISSIONS.some(item => item.key === key)).map(key => <div className="null-setting-row" key={key}><div className="null-setting-copy"><span>{key}</span></div><PermissionSelect label={`${origin} ${key} 권한`} value={decisions[key]} disabled={busy} onChange={decision => void mutate(() => window.electronAPI!.setSitePermission(origin,key,decision),'사이트 권한을 저장했습니다.')} /></div>)}
                <div className="null-site-entry-footer"><span>일부 변경은 사이트를 새로고침하면 반영됩니다.</span><button type="button" disabled={busy || !Object.keys(decisions).length} onClick={() => void mutate(() => window.electronAPI!.resetSitePermissions(origin),'사이트 권한을 기본값으로 되돌렸습니다.')}><RotateCcw size={14} />권한 초기화</button></div>
              </div>}
            </div>;
          })}
        </div>
      </>}
      {section === 'cookies' && <>
        <div className="null-site-section-heading"><h2>쿠키 사용</h2><p>쿠키는 로그인 상태와 사이트 환경설정을 유지하는 데 사용됩니다.</p></div>
        <div className="null-setting-row"><div className="null-setting-copy"><strong>서드파티 쿠키 차단</strong><small>방문 중인 사이트와 다른 사이트의 쿠키를 제한합니다. 일부 로그인 기능에 영향을 줄 수 있습니다.</small></div>
          <ToggleSwitch aria-label="서드파티 쿠키 차단" checked={settings.cookiePolicy === 'block-third-party'} onCheckedChange={checked => onUpdateSettings({ cookiePolicy: checked ? 'block-third-party' : 'allow' })} /></div>
        <p className="null-site-hint">쿠키 정책과 예외는 아래 ‘설정 저장’을 눌러 적용합니다. 현재 판정은 요청/최상위 사이트의 도메인 비교를 사용합니다.</p>
        <div className="null-site-section-heading"><h2>사이트별 예외</h2><p>이 목록의 설정은 기본 쿠키 정책보다 우선합니다.</p></div>
        <form className="null-cookie-form" onSubmit={addException}>
          <input className="null-field" aria-label="쿠키 예외 사이트 주소" placeholder="https://example.com" value={exceptionUrl} onChange={event => setExceptionUrl(event.target.value)} />
          <select className="null-permission-select" aria-label="쿠키 예외 동작" value={exceptionDecision} onChange={event => setExceptionDecision(event.target.value as 'allow'|'block')}><option value="allow">허용</option><option value="block">차단</option></select>
          <button type="submit" className="null-quiet-button">추가</button>
        </form>
        <div className="null-site-list">{Object.entries(settings.cookieExceptions).map(([origin,decision]) => <div className="null-setting-row" key={origin}><div className="null-setting-copy"><span>{origin}</span></div><span className="null-site-badge">{decision === 'allow' ? '허용' : '차단'}</span><button type="button" className="null-icon-button" aria-label={`${origin} 쿠키 예외 삭제`} onClick={() => { const next = { ...settings.cookieExceptions }; delete next[origin]; onUpdateSettings({ cookieExceptions: next }); }}><XIcon /></button></div>)}</div>
        {!Object.keys(settings.cookieExceptions).length && <p className="null-site-empty">추가한 예외가 없습니다.</p>}
      </>}
      {section === 'data' && <>
        <div className="null-site-section-heading"><h2>저장된 사이트 데이터</h2><p>쿠키가 확인된 사이트입니다. 쿠키 값이나 비밀번호는 표시하지 않습니다.</p></div>
        <input className="null-field null-site-search" aria-label="저장 데이터를 삭제할 사이트 찾기" placeholder="사이트 주소로 찾기" value={query} onChange={event => setQuery(event.target.value)} />
        <div className="null-site-list">{filteredData.map(item => <div className="null-site-data-entry" key={item.origin}><div className="null-setting-row"><Globe2 size={18} /><div className="null-setting-copy"><strong>{item.hostname}</strong><small>{item.origin} · 쿠키 {item.cookieCount}개</small></div><button type="button" className="null-icon-button" disabled={busy} aria-label={`${item.origin} 저장 데이터 삭제`} onClick={() => setPendingDelete(item.origin)}><Trash2 size={16} /></button></div>
          {pendingDelete === item.origin && <div className="null-site-confirm" role="group" aria-label="사이트 데이터 삭제 확인"><p>이 사이트에서 로그아웃될 수 있습니다. 쿠키와 로컬 저장 데이터를 삭제할까요?</p><div><button type="button" onClick={() => setPendingDelete(null)}>취소</button><button type="button" disabled={busy} onClick={() => void mutate(async () => { const ok = await window.electronAPI!.clearSiteData(item.origin); if (ok) setPendingDelete(null); return ok; },'사이트 데이터를 삭제했습니다.')}>삭제</button></div></div>}
        </div>)}</div>
        {!loading && !filteredData.length && <p className="null-site-empty">{query ? '일치하는 사이트가 없습니다.' : '쿠키로 확인된 사이트 데이터가 없습니다.'}</p>}
      </>}
    </div>
  </div>;
}
function XIcon() { return <span aria-hidden="true">×</span>; }
