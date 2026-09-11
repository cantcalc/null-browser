import React, { useState, useEffect } from 'react';
import {
  X,
  Languages,
  FileText,
  Download,
  ArrowRightLeft,
  Copy,
  Check,
  Link,
  Folder,
  File,
} from 'lucide-react';
import { Tab, DownloadItem } from '../types/browser';

interface AsidePanelProps {
  isOpen: boolean;
  activeTab?: Tab;
  downloads: DownloadItem[];
  externalTranslateText?: string | null;
  onClearExternalTranslateText?: () => void;
  onClose: () => void;
  onTranslatePage: () => void;
  isPageTranslated: boolean;
  pageTranslationStatus?: 'idle' | 'translating' | 'translated' | 'restoring' | 'failed';
  onOpenDownload: (id: string) => void;
  onShowDownloadInFinder: (id: string) => void;
  onCancelDownload: (id: string) => void;
  isIncognito?: boolean;
}

export const AsidePanel: React.FC<AsidePanelProps> = ({
  isOpen,
  activeTab,
  downloads,
  externalTranslateText,
  onClearExternalTranslateText,
  onClose,
  onTranslatePage,
  isPageTranslated,
  pageTranslationStatus = 'idle',
  onOpenDownload,
  onShowDownloadInFinder,
  onCancelDownload,
  isIncognito = false,
}) => {
  const [activeMode, setActiveMode] = useState<'translate' | 'notes' | 'downloads'>('translate');

  // Translation state
  const [sourceText, setSourceText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationStatus, setTranslationStatus] = useState<'idle' | 'translating' | 'translated' | 'failed'>('idle');
  const [isCopied, setIsCopied] = useState(false);

  // Sync external translation requests (from Selection / Context Menu)
  useEffect(() => {
    if (!externalTranslateText || !externalTranslateText.trim()) return;

    let cancelled = false;
    const text = externalTranslateText.trim();
    setActiveMode('translate');
    setSourceText(text);
    setTranslatedText('');
    setIsTranslating(true);
    setTranslationStatus('translating');

    const translate = async () => {
      try {
        if (!window.electronAPI) throw new Error('translation-unavailable');
        const result = await window.electronAPI.translateText(text, 'ko');
        if (!cancelled) {
          setTranslatedText(result);
          setTranslationStatus('translated');
        }
      } catch {
        if (!cancelled) {
          setTranslatedText('온라인 번역을 사용할 수 없습니다. 다시 시도해 주세요.');
          setTranslationStatus('failed');
        }
      } finally {
        if (!cancelled) {
          setIsTranslating(false);
          onClearExternalTranslateText?.();
        }
      }
    };
    void translate();

    return () => {
      cancelled = true;
    };
  }, [externalTranslateText, onClearExternalTranslateText]);

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

  const handleTranslateText = async () => {
    if (!sourceText.trim() || isTranslating) return;
    setTranslatedText('');
    setIsTranslating(true);
    setTranslationStatus('translating');
    try {
      if (!window.electronAPI) throw new Error('translation-unavailable');
      const result = await window.electronAPI.translateText(sourceText.trim(), 'ko');
      setTranslatedText(result);
      setTranslationStatus('translated');
    } catch {
      setTranslatedText('온라인 번역을 사용할 수 없습니다. 다시 시도해 주세요.');
      setTranslationStatus('failed');
    } finally {
      setIsTranslating(false);
    }
  };

  const handleCopyTranslation = () => {
    if (translatedText && translationStatus === 'translated') {
      void navigator.clipboard.writeText(translatedText).catch(() => {});
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1200);
    }
  };

  const handleInsertTabLinkToNotes = () => {
    if (!activeTab) return;
    const linkSnippet = `\n- [${activeTab.title || '링크'}](${activeTab.url})\n`;
    handleNotesChange(noteContent + linkSnippet);
  };

  return (
    <aside className="aero-panel aero-aside w-[min(340px,100vw)] max-w-full flex-shrink-0 min-w-0 h-full border-l border-[var(--border-subtle)] flex flex-col z-20 select-none">
      {/* Header */}
      <div className="aero-panel-header flex items-center justify-between px-4 h-10 border-b border-[var(--border-subtle)]">
        <span className="font-semibold text-xs text-[var(--text-primary)] tracking-wide">Aside Drawer</span>
        <button
          onClick={onClose}
          title="Aside 패널 닫기"
          className="aero-icon-button !h-7 !w-7"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Segmented Control Bar */}
      <div className="aero-segment-bar flex p-1.5 gap-1 bg-[var(--chrome-bg)] border-b border-[var(--border-divider)] text-xs font-medium">
        <button
          onClick={() => setActiveMode('translate')}
          data-active={activeMode === 'translate'}
          className={`aero-segment flex-1 flex items-center justify-center gap-1 h-7 transition-colors ${
            activeMode === 'translate'
              ? 'bg-[var(--chrome-surface-active)] text-[var(--text-primary)] border border-[var(--border-active)] shadow-xs'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent'
          }`}
        >
          <Languages className="w-3 h-3" />
          <span className="text-[11px]">번역</span>
        </button>
        <button
          onClick={() => setActiveMode('notes')}
          data-active={activeMode === 'notes'}
          className={`aero-segment flex-1 flex items-center justify-center gap-1 h-7 transition-colors ${
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
          className={`aero-segment flex-1 flex items-center justify-center gap-1 h-7 transition-colors ${
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
        {/* TRANSLATE MODE */}
        {activeMode === 'translate' && (
          <div className="flex-1 flex flex-col space-y-2.5">
            {/* Full Page Translation Action */}
            <div className="aero-panel-section p-3 bg-[var(--chrome-surface)] border border-transparent rounded-[var(--radius-lg)] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[var(--text-primary)]">페이지 번역</span>
                <span className="text-[10px] text-[var(--text-muted)] font-mono">
                  {pageTranslationStatus === 'failed' ? '번역 실패' : '온라인 번역'}
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-secondary)] leading-tight">
                페이지에서 읽을 수 있는 텍스트를 최대 1,000개까지 번역하거나 원문으로 복원합니다. 번역에는 인터넷 연결이 필요합니다.
              </p>
              <button
                onClick={onTranslatePage}
                disabled={pageTranslationStatus === 'translating' || pageTranslationStatus === 'restoring'}
                className={`w-full flex items-center justify-center gap-1.5 h-8 rounded-[var(--radius-md)] text-xs font-medium transition-colors disabled:opacity-50 ${
                  isPageTranslated
                    ? 'bg-[var(--chrome-surface-active)] text-[var(--accent)] border border-[var(--accent-border)]'
                    : 'aero-primary-button text-white'
                }`}
              >
                <Languages className="w-3.5 h-3.5" />
                <span>
                  {pageTranslationStatus === 'restoring'
                    ? '원문 복원 중...'
                    : pageTranslationStatus === 'translating'
                      ? '페이지 번역 중...'
                      : isPageTranslated
                        ? '원문 페이지로 복원'
                        : '페이지 번역'}
                </span>
              </button>
            </div>

            {/* In-Panel Text Translator */}
            <div className="flex-1 flex flex-col space-y-2 pt-1 border-t border-[var(--border-divider)]">
              <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                <span>텍스트 번역</span>
                <span className="text-[10px] text-[var(--text-muted)]">자동 감지 → 한국어</span>
              </div>

              <textarea
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                placeholder="번역할 텍스트"
                className="aero-field w-full h-24 p-2.5 text-xs outline-none resize-none leading-relaxed"
              />

              <button
                onClick={handleTranslateText}
                disabled={isTranslating || !sourceText.trim()}
                className="aero-quiet-button w-full h-8 bg-[var(--chrome-surface)] hover:bg-[var(--chrome-surface-active)] disabled:opacity-40 text-[var(--text-primary)] text-xs font-medium rounded-[var(--radius-md)] flex items-center justify-center gap-1.5 transition-colors border border-[var(--border-subtle)]"
              >
                <ArrowRightLeft className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                <span>{isTranslating ? '번역 중...' : '한국어로 번역'}</span>
              </button>

              {translatedText && (
                <div className="aero-panel-section mt-1 p-2.5 bg-[var(--chrome-surface)] border border-transparent rounded-[var(--radius-lg)] space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
                    <span className={`font-medium ${translationStatus === 'failed' ? 'text-[var(--danger)]' : 'text-[var(--accent)]'}`}>
                      {translationStatus === 'failed' ? '번역 실패' : '한국어 번역 결과'}
                    </span>
                    <button
                      onClick={handleCopyTranslation}
                      title="번역 복사"
                      disabled={translationStatus !== 'translated'}
                      className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded disabled:opacity-30"
                    >
                      {isCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                  <p className="text-xs text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
                    {translatedText}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

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
              className="aero-field flex-1 w-full p-2.5 text-xs outline-none resize-none leading-relaxed font-sans"
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
                      className="aero-list-row p-2.5 bg-[var(--chrome-surface)] border border-transparent rounded-[var(--radius-lg)] space-y-1 text-xs"
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
