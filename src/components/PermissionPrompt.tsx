import React, { useEffect, useRef } from 'react';
import { Camera, Bell, MapPin, ShieldAlert, X } from 'lucide-react';
import { PermissionPrompt as PermissionPromptData } from '../types/browser';

interface PermissionPromptProps {
  request: PermissionPromptData;
  onResolve: (decision: 'allow' | 'deny' | 'once') => void;
}

function permissionLabel(permission: string) {
  switch (permission) {
    case 'media':
    case 'camera':
    case 'microphone':
      return { label: '카메라와 마이크', icon: Camera };
    case 'geolocation':
      return { label: '현재 위치', icon: MapPin };
    case 'notifications':
      return { label: '알림', icon: Bell };
    default:
      return { label: permission, icon: ShieldAlert };
  }
}

export const PermissionPrompt: React.FC<PermissionPromptProps> = ({ request, onResolve }) => {
  const allowRef = useRef<HTMLButtonElement>(null);
  const info = permissionLabel(request.permission);
  const Icon = info.icon;

  useEffect(() => {
    allowRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onResolve('deny');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onResolve]);

  return (
    <div className="aero-overlay fixed inset-0 z-[80] flex items-start justify-center px-4 pt-24" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-prompt-title"
        className="aero-modal w-full max-w-[25rem] p-5 text-[var(--text-primary)]"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)]">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h2 id="permission-prompt-title" className="text-sm font-semibold">권한 요청</h2>
              <button type="button" onClick={() => onResolve('deny')} className="aero-icon-button !h-7 !w-7" aria-label="권한 요청 닫기">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 break-all font-mono text-[11px] text-[var(--accent)]">{request.origin}</p>
            <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
              이 사이트가 <strong className="text-[var(--text-primary)]">{info.label}</strong> 사용을 요청했습니다.
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
              허용 범위를 선택하세요. “이번만 허용”은 현재 요청에만 적용됩니다.
            </p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button type="button" onClick={() => onResolve('deny')} className="aero-quiet-button px-3 py-2 text-xs">
            차단
          </button>
          <button type="button" onClick={() => onResolve('once')} className="aero-quiet-button border-[var(--accent-border)] bg-[var(--accent-subtle)] px-3 py-2 text-xs text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]">
            이번만 허용
          </button>
          <button ref={allowRef} type="button" onClick={() => onResolve('allow')} className="aero-primary-button px-3 py-2 text-xs font-medium">
            항상 허용
          </button>
        </div>
      </section>
    </div>
  );
};
