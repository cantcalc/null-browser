import React from 'react';
import { Download } from 'lucide-react';
import type { DownloadItem } from '../types/browser';

export function DownloadButton({ downloads, open, onClick }: { downloads: DownloadItem[]; open: boolean; onClick: () => void }) {
  const active = downloads.filter(item => item.state === 'progressing');
  const total = active.reduce((sum, item) => sum + item.totalBytes, 0);
  const received = active.reduce((sum, item) => sum + item.receivedBytes, 0);
  const knownSize = active.length > 0 && active.every(item => item.totalBytes > 0);
  const percent = knownSize ? Math.min(100, Math.round(received / total * 100)) : undefined;
  const latest = downloads[0];
  const state = active.length ? `다운로드 ${active.length}개 진행 중${percent === undefined ? '' : ` · ${percent}%`}`
    : latest ? `${latest.filename} · ${latest.state === 'completed' ? '완료' : latest.state === 'cancelled' ? '취소됨' : '중단됨'}` : '다운로드 기록';
  return <button type="button" onClick={onClick} className="null-icon-button relative" aria-label="다운로드 기록" aria-pressed={open} title={state} data-download-state={active.length ? 'progressing' : latest?.state || 'empty'}>
    <Download className="h-3.5 w-3.5" />
    {active.length > 0 && <>
      <svg viewBox="0 0 32 32" className="pointer-events-none absolute inset-0 h-full w-full -rotate-90" aria-hidden="true"><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" opacity="0.15" strokeWidth="1.5" /><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" pathLength="100" strokeDasharray={`${percent ?? 25} 100`} /></svg>
      <span className="pointer-events-none absolute -right-0.5 -top-0.5 rounded-full bg-[var(--text-primary)] px-1 text-[8px] leading-3 text-[var(--chrome-bg)]" aria-hidden="true">{active.length}</span>
    </>}
    <span className="sr-only" role="status">{active.length ? `${active.length}개 다운로드 중` : latest ? state : ''}</span>
  </button>;
}
