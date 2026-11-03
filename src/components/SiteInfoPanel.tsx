import { useState } from 'react';
import { LockKeyhole, Info, X, Settings, RotateCcw } from 'lucide-react';
import { PermissionSelect, SITE_PERMISSIONS } from './SiteSettings';
import { ToggleSwitch } from './ToggleSwitch';

export function SiteInfoPanel({ url, permissions, muted, zoom, onClose, onOpenSettings, onPermissionChange, onResetPermissions, onToggleMute, onZoomIn, onZoomOut, onResetZoom }: {
  url: string; permissions: Record<string,'allow'|'deny'>; muted: boolean; zoom: number;
  onClose: () => void; onOpenSettings?: () => void;
  onPermissionChange: (permission: string, decision: 'allow'|'deny'|'default') => Promise<boolean>;
  onResetPermissions: () => Promise<boolean>;
  onToggleMute: () => void; onZoomIn: () => void; onZoomOut: () => void; onResetZoom: () => void;
}) {
  const [busy, setBusy] = useState(false), [error,setError] = useState('');
  const parsed = new URL(url), secure = parsed.protocol === 'https:';
  async function apply(action: () => Promise<boolean>) {
    setBusy(true); setError('');
    try { if (!await action()) throw new Error('Rejected'); }
    catch { setError('사이트 권한을 저장하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  }
  return <aside className="null-site-inspector" aria-label="사이트 정보" data-site-inspector>
    <header><strong>사이트 정보</strong><button type="button" className="null-icon-button" aria-label="사이트 정보 닫기" onClick={onClose}><X size={17} /></button></header>
    <div className="null-site-inspector-scroll">
      <div className="null-site-identity">{secure ? <LockKeyhole size={21} /> : <Info size={21} />}<div><strong>{parsed.hostname}</strong><small>{parsed.origin}</small></div></div>
      <p className="null-site-connection">{secure ? '보안 연결 사용 중' : '암호화되지 않은 HTTP 연결'}</p>
      <p className="null-site-hint">{secure ? '연결 인증서는 Chromium이 검증합니다. 사이트 자체의 신뢰성을 보장하지는 않습니다.' : '이 사이트에 비밀번호나 결제 정보를 입력할 때 주의하세요.'}</p>
      <section className="null-inspector-section"><h2>사이트 권한</h2><p className="null-site-hint">변경사항은 바로 저장됩니다. 기본값은 요청 시 확인입니다.</p>
        {SITE_PERMISSIONS.map(({key,label,icon: Icon}) => <div className="null-setting-row" key={key}><Icon size={16} /><span className="null-setting-copy">{label}</span><PermissionSelect label={`${label} 권한`} value={permissions[key]} disabled={busy} onChange={decision => void apply(() => onPermissionChange(key,decision))} /></div>)}
        <button type="button" className="null-inspector-reset" disabled={busy || !Object.keys(permissions).length} onClick={() => void apply(onResetPermissions)}><RotateCcw size={14} />권한 초기화</button>
        {error && <p className="null-settings-inline-error" role="alert">{error}</p>}
      </section>
      <section className="null-inspector-section"><div className="null-setting-row"><span className="null-setting-copy">소리 재생</span><ToggleSwitch aria-label="이 탭에서 소리 재생" checked={!muted} onCheckedChange={onToggleMute} /></div>
        <div className="null-setting-row"><span className="null-setting-copy">화면 배율</span><div className="null-inspector-zoom"><button type="button" onClick={onZoomOut} aria-label="화면 축소">−</button><button type="button" onClick={onResetZoom} aria-label="화면 배율 초기화">{Math.round(zoom*100)}%</button><button type="button" onClick={onZoomIn} aria-label="화면 확대">+</button></div></div>
      </section>
      {onOpenSettings && <button type="button" className="null-inspector-settings" onClick={onOpenSettings}><Settings size={16} />이 사이트의 전체 설정</button>}
      <p className="null-site-hint">권한·쿠키·저장 데이터를 설정 탭에서 관리합니다.</p>
    </div>
  </aside>;
}
