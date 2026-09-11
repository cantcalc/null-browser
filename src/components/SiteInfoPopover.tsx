import React, { useState } from 'react';
import { ShieldCheck, ShieldAlert, Trash2, Volume2, VolumeX, ZoomIn, ZoomOut, Check, X } from 'lucide-react';

interface SiteInfoPopoverProps {
  url?: string;
  isOpen: boolean;
  isMuted: boolean;
  zoomLevel: number;
  onClose: () => void;
  onToggleMute: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  permissions?: Record<string, 'allow' | 'deny'>;
  onPermissionChange?: (permission: string, decision: 'allow' | 'deny' | 'default') => void;
  translationMode?: 'always' | 'never' | 'ask';
  onTranslationModeChange?: (mode: 'always' | 'never' | 'ask') => void;
}

export const SiteInfoPopover: React.FC<SiteInfoPopoverProps> = ({
  url,
  isOpen,
  isMuted,
  zoomLevel,
  onClose,
  onToggleMute,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  permissions = {},
  onPermissionChange,
  translationMode = 'ask',
  onTranslationModeChange,
}) => {
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [clearError, setClearError] = useState(false);

  if (!isOpen) return null;

  let origin = 'about:blank';
  let isSecure = false;
  let hostname = '';
  let isHttpSite = false;

  if (url) {
    try {
      const parsed = new URL(url);
      origin = parsed.origin;
      hostname = parsed.hostname;
      isSecure = parsed.protocol === 'https:';
      isHttpSite = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      origin = url;
    }
  }

  const handleClearSiteData = async () => {
    if (!url || !isHttpSite || clearing) return;
    setClearing(true);
    setCleared(false);
    setClearError(false);
    try {
      const didClear = await window.electronAPI?.clearSiteData?.(origin);
      if (!didClear) throw new Error('Site data clear operation was rejected');
      setCleared(true);
      setTimeout(() => setCleared(false), 2000);
    } catch (e) {
      console.error('Failed to clear site data:', e);
      setClearError(true);
    } finally {
      setClearing(false);
    }
  };

  const permissionRows = [
    { key: 'notifications', label: '알림' },
    { key: 'geolocation', label: '위치' },
    { key: 'media', label: '카메라·마이크' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/15"
      onClick={onClose}
    >
      <div
        className="aero-popover absolute top-[108px] left-1/2 -translate-x-1/2 w-[min(20rem,calc(100vw-1rem))] max-h-[calc(100vh-116px)] overflow-y-auto p-4 text-xs select-none animate-in fade-in zoom-in-95 duration-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Origin & Close */}
        <div className="flex items-start justify-between border-b border-[var(--border-subtle)] pb-3 mb-3">
          <div className="space-y-1 min-w-0 pr-2">
            <div className="flex items-center gap-1.5">
              {isSecure ? (
                <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0" />
              )}
              <span className="font-semibold text-[var(--text-primary)] truncate font-mono text-[11px]">
                {hostname || origin}
              </span>
            </div>
            <p className="text-[10px] text-[var(--text-muted)]">
              {isSecure ? 'HTTPS 프로토콜 사용 중 · 인증서는 Chromium이 검증합니다' : '주의: HTTPS가 아닌 연결'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="aero-icon-button !h-7 !w-7"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Site Zoom Control */}
        <div className="flex items-center justify-between py-2 border-b border-[var(--border-subtle)]">
          <span className="text-[var(--text-secondary)] font-medium">화면 배율</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onZoomOut}
              title="축소"
              className="aero-icon-button !h-7 !w-7"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <button
              onClick={onResetZoom}
              title="100% 리셋"
              className="aero-quiet-button h-7 px-2 font-mono text-[11px]"
            >
              {Math.round(zoomLevel * 100)}%
            </button>
            <button
              onClick={onZoomIn}
              title="확대"
              className="aero-icon-button !h-7 !w-7"
            >
              <ZoomIn className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Sound Toggle */}
        <div className="flex items-center justify-between py-2 border-b border-[var(--border-subtle)]">
          <span className="text-[var(--text-secondary)] font-medium">소리 재생</span>
          <button
            onClick={onToggleMute}
            className={`aero-quiet-button flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium transition-colors ${
              isMuted
                ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                : 'bg-[var(--chrome-bg)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {isMuted ? (
              <>
                <VolumeX className="w-3.5 h-3.5" />
                음소거됨
              </>
            ) : (
              <>
                <Volume2 className="w-3.5 h-3.5" />
                소리 켜짐
              </>
            )}
          </button>
        </div>

        {/* Site Permissions */}
        <div className="py-2.5 border-b border-[var(--border-subtle)] space-y-1.5">
          <div className="text-[10px] uppercase font-mono tracking-wider text-[var(--text-muted)]">권한 설정</div>
          <div className="space-y-1 text-[11px] text-[var(--text-secondary)]">
            {permissionRows.map((row) => (
              <label key={row.key} className="aero-list-row flex items-center justify-between gap-2 p-1.5 bg-[var(--chrome-bg)]">
                <span>{row.label}</span>
                <select
                  value={permissions[row.key] || 'default'}
                  disabled={!isHttpSite || !onPermissionChange}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === 'allow' || value === 'deny' || value === 'default') onPermissionChange?.(row.key, value);
                  }}
                  className="bg-transparent text-[10px] text-[var(--text-muted)] font-mono outline-none disabled:opacity-50"
                  aria-label={`${row.label} 권한`}
                >
                  <option value="default">기본 차단</option>
                  <option value="allow">허용</option>
                  <option value="deny">차단</option>
                </select>
              </label>
            ))}
          </div>
        </div>

        <div className="py-2.5 border-b border-[var(--border-subtle)] space-y-1.5">
          <div className="text-[10px] uppercase font-mono tracking-wider text-[var(--text-muted)]">페이지 번역</div>
          <label className="aero-list-row flex items-center justify-between gap-2 bg-[var(--chrome-bg)] p-1.5 text-[11px] text-[var(--text-secondary)]">
            <span>이 사이트의 번역 방식</span>
            <select
              value={translationMode}
              disabled={!isHttpSite || !onTranslationModeChange}
              onChange={(event) => {
                const value = event.target.value;
                if (value === 'always' || value === 'never' || value === 'ask') onTranslationModeChange?.(value);
              }}
              className="bg-transparent text-[10px] text-[var(--text-muted)] outline-none disabled:opacity-50"
              aria-label="사이트 번역 방식"
            >
              <option value="ask">필요할 때 묻기</option>
              <option value="always">자동 번역</option>
              <option value="never">자동 번역 안 함</option>
            </select>
          </label>
        </div>

        {/* Clear Site Data Action */}
        <div className="pt-3">
          <button
            onClick={handleClearSiteData}
            disabled={clearing || !isHttpSite}
            className={`aero-quiet-button w-full flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium transition-all ${
              cleared
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                : clearError
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  : 'bg-[var(--chrome-bg)] hover:bg-rose-500/10 border-[var(--border-subtle)] hover:border-rose-500/30 text-[var(--text-secondary)] hover:text-rose-300'
            }`}
          >
            {cleared ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                사이트 데이터 삭제 완료
              </>
            ) : (
              <>
                <Trash2 className="w-3.5 h-3.5" />
                {clearing ? '삭제 중...' : clearError ? '사이트 데이터 삭제 실패' : '이 사이트 저장 데이터 삭제'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
