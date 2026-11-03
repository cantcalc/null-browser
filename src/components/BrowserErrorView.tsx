import React from 'react';
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react';
import { PageError } from '../types/browser';

interface BrowserErrorViewProps {
  error: PageError;
  onRetry: () => void;
  onGoBack: () => void;
}

export const BrowserErrorView: React.FC<BrowserErrorViewProps> = ({ error, onRetry, onGoBack }) => {
  const timedOut = error.code === -7 || error.code === -118;
  return (
  <div className="null-state absolute inset-0 z-30 flex items-center justify-center overflow-y-auto p-6 text-center">
    <div className="w-full max-w-md space-y-4">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-400/10 text-amber-300">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <div>
        <h2 className="text-base font-semibold text-[var(--text-primary)]">페이지를 불러오지 못했습니다</h2>
        <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">{timedOut ? '사이트의 응답 시간이 초과되었습니다. 네트워크 연결이나 사이트 접속 상태를 확인한 뒤 다시 시도해 주세요.' : error.description || '네트워크 연결을 확인한 뒤 다시 시도해 주세요.'}</p>
        <p className="mt-2 break-all font-mono text-[10px] text-[var(--text-muted)]">오류 코드: {error.code} · {error.url}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" onClick={onGoBack} className="null-quiet-button gap-1.5 px-3 py-2 text-xs">
          <ArrowLeft className="h-3.5 w-3.5" /> 뒤로가기
        </button>
        <button type="button" onClick={onRetry} className="null-primary-button gap-1.5 px-3 py-2 text-xs font-medium">
          <RefreshCw className="h-3.5 w-3.5" /> 다시 시도
        </button>
      </div>
    </div>
  </div>
  );
};
