import React, { useState, useEffect } from 'react';
import {
  X,
  FileText,
  Download,
  Link,
  Folder,
  File,
} from 'lucide-react';
import { Tab, DownloadItem } from '../types/browser';

interface AsidePanelProps {
  isOpen: boolean;
  activeTab?: Tab;
  downloads: DownloadItem[];
  onClose: () => void;
  onOpenDownload: (id: string) => void;
  onShowDownloadInFinder: (id: string) => void;
  onCancelDownload: (id: string) => void;
  isIncognito?: boolean;
}

export const AsidePanel: React.FC<AsidePanelProps> = ({
  isOpen,
  activeTab,
  downloads,
  onClose,
  onOpenDownload,
  onShowDownloadInFinder,
  onCancelDownload,
  isIncognito = false,
}) => {
  const [activeMode, setActiveMode] = useState<'notes' | 'downloads'>('notes');

  // Notes state
  const [noteContent, setNoteContent] = useState('');

  // Fetch notes from Electron userData
  useEffect(() => {
    if (window.electronAPI && !isIncognito) {
      window.electronAPI.getNotes().then((saved) => {
        if (saved) setNoteContent(saved);
      }).catch(() => {});
    }
  }, [isIncognito]);

  const handleNotesChange = (content: string) => {
    setNoteContent(content);
    if (!isIncognito) window.electronAPI?.saveNotes(content);
  };

  if (!isOpen) return null;

  const handleInsertTabLinkToNotes = () => {
    if (!activeTab) return;
    const linkSnippet = `\n- [${activeTab.title || '링크'}](${activeTab.url})\n`;
    handleNotesChange(noteContent + linkSnippet);
  };

  return (
    <aside className="null-panel null-aside w-[min(340px,100vw)] max-w-full flex-shrink-0 min-w-0 h-full border-l border-[var(--border-subtle)] flex flex-col z-20 select-none">
      {/* Header */}
      <div className="null-panel-header flex items-center justify-between px-4 h-10 border-b border-[var(--border-subtle)]">
        <span className="font-semibold text-xs text-[var(--text-primary)] tracking-wide">Aside Drawer</span>
        <button
          onClick={onClose}
          title="Aside 패널 닫기"
          className="null-icon-button !h-7 !w-7"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Segmented Control Bar */}
      <div className="null-segment-bar flex p-1.5 gap-1 bg-[var(--chrome-bg)] border-b border-[var(--border-divider)] text-xs font-medium">
        <button
          onClick={() => setActiveMode('notes')}
          data-active={activeMode === 'notes'}
          className={`null-segment flex-1 flex items-center justify-center gap-1 h-7 transition-colors ${
            activeMode === 'notes'
              ? 'bg-[var(--chrome-surface-active)] text-[var(--text-primary)] border border-[var(--border-active)] shadow-xs'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent'
          }`}
        >
          <FileText className="w-3 h-3" />
          <span className="text-[11px]">메모</span>
        </button>
        <button
          onClick={() => setActiveMode('downloads')}
          data-active={activeMode === 'downloads'}
          className={`null-segment flex-1 flex items-center justify-center gap-1 h-7 transition-colors ${
            activeMode === 'downloads'
              ? 'bg-[var(--chrome-surface-active)] text-[var(--text-primary)] border border-[var(--border-active)] shadow-xs'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent'
          }`}
        >
          <Download className="w-3 h-3" />
          <span className="text-[11px]">다운로드</span>
        </button>
      </div>

      {/* Body Content Area */}
      <div className="flex-1 flex flex-col p-3 overflow-y-auto space-y-3">
        {/* QUICK NOTES MODE */}
        {activeMode === 'notes' && (
          <div className="flex-1 flex flex-col space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-secondary)] font-medium">스크랩 & 빠른 메모</span>
              {activeTab && (
                <button
                  onClick={handleInsertTabLinkToNotes}
                  className="flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline"
                >
                  <Link className="w-3 h-3" />
                  <span>탭 링크 삽입</span>
                </button>
              )}
            </div>

              <textarea
                value={noteContent}
                onChange={(e) => handleNotesChange(e.target.value)}
                placeholder={isIncognito ? '시크릿 메모' : '메모'}
              className="null-field flex-1 w-full p-2.5 text-xs outline-none resize-none leading-relaxed font-sans"
            />
          </div>
        )}

        {/* DOWNLOADS MODE */}
        {activeMode === 'downloads' && (
          <div className="flex-1 flex flex-col space-y-2">
            <div className="text-xs font-medium text-[var(--text-secondary)] pb-1 border-b border-[var(--border-divider)]">
              다운로드 내역 ({downloads.length})
            </div>

            {downloads.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-muted)] text-xs gap-2">
                <Download className="w-6 h-6 opacity-30" />
                <span>다운로드 내역이 없습니다.</span>
              </div>
            ) : (
              <div className="space-y-1.5 overflow-y-auto pr-1">
                {downloads.map((dl) => {
                  const progressPct =
                    dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0;
                  return (
                    <div
                      key={dl.id}
                      className="null-list-row p-2.5 bg-[var(--chrome-surface)] border border-transparent rounded-[var(--radius-lg)] space-y-1 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium truncate max-w-[170px] text-[var(--text-primary)]" title={dl.filename}>
                          {dl.filename}
                        </span>
                        <span className="text-[10px] text-[var(--text-muted)] uppercase">{dl.state}</span>
                      </div>

                      {dl.state === 'progressing' && (
                        <div className="space-y-1">
                          <div className="w-full h-1 bg-[var(--chrome-bg)] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[var(--accent)] transition-all duration-200"
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono">
                            <span>{progressPct}%</span>
                            <button
                              onClick={() => onCancelDownload(dl.id)}
                              className="text-[var(--danger)] hover:underline"
                            >
                              취소
                            </button>
                          </div>
                        </div>
                      )}

                      {dl.state === 'completed' && (
                        <div className="flex items-center gap-1.5 pt-0.5">
                          <button
                            onClick={() => onOpenDownload(dl.id)}
                            className="flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline"
                          >
                            <File className="w-3 h-3" />
                            열기
                          </button>
                          <span className="text-[var(--text-muted)]">·</span>
                          <button
                            onClick={() => onShowDownloadInFinder(dl.id)}
                            className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                          >
                            <Folder className="w-3 h-3" />
                            {window.electronAPI?.platform === 'win32' ? '파일 탐색기에서 보기' : 'Finder에서 보기'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
