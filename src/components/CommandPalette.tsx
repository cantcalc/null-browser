import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Plus,
  RotateCw,
  Code2,
  Languages,
  PanelRight,
  CornerDownLeft,
  X,
  Copy,
  History,
  Trash2,
  ZoomIn,
  Camera,
  Settings,
  AppWindow,
  EyeOff,
  Link,
  Library,
  Home,
  FileText,
  Printer,
  FolderOpen,
} from 'lucide-react';
import { Tab } from '../types/browser';
import { shortcutLabel } from '../utils/platform';

interface CommandPaletteProps {
  isOpen: boolean;
  activeTab?: Tab;
  onClose: () => void;
  onNewTab: (url?: string) => void;
  onReopenClosedTab: () => void;
  onToggleDevTools: () => void;
  onToggleTranslate: () => void;
  onToggleAside: () => void;
  onOpenFind: () => void;
  onReloadWithoutCache: () => void;
  onCopyUrl: () => void;
  onCopyOrigin: () => void;
  onResetZoom: () => void;
  onClearHistory: () => void;
  onOpenSettings?: () => void;
  onOpenLibrary: () => void;
  onGoHome: () => void;
  onReload: () => void;
  onOpenFile: () => void;
  onPrint: () => void;
  onSavePdf: () => void;
  onViewSource: () => void;
  onCopyTitle: () => void;
  onCopyTitleUrl: () => void;
}

interface CommandItem {
  id: string;
  title: string;
  category: string;
  shortcut?: string;
  icon: React.ReactNode;
  action: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  activeTab,
  onClose,
  onNewTab,
  onReopenClosedTab,
  onToggleDevTools,
  onToggleTranslate,
  onToggleAside,
  onOpenFind,
  onReloadWithoutCache,
  onCopyUrl,
  onCopyOrigin,
  onResetZoom,
  onClearHistory,
  onOpenSettings,
  onOpenLibrary,
  onGoHome,
  onReload,
  onOpenFile,
  onPrint,
  onSavePdf,
  onViewSource,
  onCopyTitle,
  onCopyTitleUrl,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCaptureScreen = async () => {
    if (window.electronAPI) {
      const dataUrl = await window.electronAPI.captureVisiblePage();
      if (dataUrl) {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `aero_capture_${Date.now()}.png`;
        a.click();
      }
    }
  };

  const handleCopyMarkdown = () => {
    if (activeTab?.url && /^https?:\/\//i.test(activeTab.url)) {
      const title = activeTab.title || activeTab.url;
      navigator.clipboard.writeText(`[${title}](${activeTab.url})`);
    }
  };

  const handleCopyHostname = () => {
    if (activeTab?.url && /^https?:\/\//i.test(activeTab.url)) {
      try {
        navigator.clipboard.writeText(new URL(activeTab.url).hostname);
      } catch {
        // Fallback
      }
    }
  };

  const commands: CommandItem[] = [
    {
      id: 'new-tab',
      title: '새 탭 열기',
      category: '탐색',
      shortcut: shortcutLabel('⌘T', 'Ctrl+T'),
      icon: <Plus className="w-3.5 h-3.5 text-[var(--accent)]" />,
      action: () => onNewTab(),
    },
    {
      id: 'home',
      title: '홈 화면으로 이동',
      category: '탐색',
      shortcut: shortcutLabel('⌘⇧0', 'Ctrl+Shift+0'),
      icon: <Home className="w-3.5 h-3.5 text-[var(--text-secondary)]" />,
      action: onGoHome,
    },
    {
      id: 'reload',
      title: '현재 페이지 새로고침',
      category: '탐색',
      shortcut: shortcutLabel('⌘R', 'Ctrl+R'),
      icon: <RotateCw className="w-3.5 h-3.5 text-[var(--text-secondary)]" />,
      action: onReload,
    },
    {
      id: 'open-file',
      title: '로컬 파일 열기',
      category: '파일',
      shortcut: shortcutLabel('⌘O', 'Ctrl+O'),
      icon: <FolderOpen className="w-3.5 h-3.5 text-[var(--text-secondary)]" />,
      action: onOpenFile,
    },
    {
      id: 'print',
      title: '현재 페이지 인쇄',
      category: '파일',
      shortcut: shortcutLabel('⌘P', 'Ctrl+P'),
      icon: <Printer className="w-3.5 h-3.5 text-[var(--text-secondary)]" />,
      action: onPrint,
    },
    {
      id: 'save-pdf',
      title: '현재 페이지를 PDF로 저장',
      category: '파일',
      icon: <FileText className="w-3.5 h-3.5 text-[var(--accent)]" />,
      action: onSavePdf,
    },
    {
      id: 'view-source',
      title: '페이지 소스 보기',
      category: '개발자',
      icon: <Code2 className="w-3.5 h-3.5 text-[var(--text-muted)]" />,
      action: onViewSource,
    },
    {
      id: 'reopen-tab',
      title: '최근 닫은 탭 다시 열기',
      category: '탐색',
      shortcut: shortcutLabel('⌘⇧T', 'Ctrl+Shift+T'),
      icon: <History className="w-3.5 h-3.5 text-[var(--text-secondary)]" />,
      action: onReopenClosedTab,
    },
    {
      id: 'new-window',
      title: '새 일반 창 열기',
      category: '탐색',
      shortcut: shortcutLabel('⌘N', 'Ctrl+N'),
      icon: <AppWindow className="w-3.5 h-3.5 text-[var(--text-secondary)]" />,
      action: () => window.electronAPI?.newWindow(),
    },
    {
      id: 'new-private-window',
      title: '새 시크릿 창 열기',
      category: '개인정보',
      shortcut: shortcutLabel('⌘⇧N', 'Ctrl+Shift+N'),
      icon: <EyeOff className="w-3.5 h-3.5 text-purple-400" />,
      action: () => window.electronAPI?.newPrivateWindow(),
    },
    {
      id: 'settings',
      title: '브라우저 환경설정 열기',
      category: '설정',
      shortcut: shortcutLabel('⌘,', 'Ctrl+,'),
      icon: <Settings className="w-3.5 h-3.5 text-[var(--accent)]" />,
      action: () => onOpenSettings && onOpenSettings(),
    },
    {
      id: 'library',
      title: '북마크·방문 기록·다운로드 관리',
      category: '라이브러리',
      shortcut: shortcutLabel('⌘⇧H', 'Ctrl+Shift+H'),
      icon: <Library className="w-3.5 h-3.5 text-[var(--accent)]" />,
      action: onOpenLibrary,
    },
    {
      id: 'capture-page',
      title: '현재 화면 스크린샷 캡처 (PNG 저장)',
      category: '도구',
      icon: <Camera className="w-3.5 h-3.5 text-emerald-400" />,
      action: handleCaptureScreen,
    },
    {
      id: 'devtools',
      title: '크롬 개발자 도구 (DevTools) 열기/닫기',
      category: '개발자',
      shortcut: shortcutLabel('⌥⌘I', 'Alt+Ctrl+I'),
      icon: <Code2 className="w-3.5 h-3.5 text-emerald-400" />,
      action: onToggleDevTools,
    },
    {
      id: 'translate',
      title: '페이지 한국어 번역 / 복원',
      category: '도구',
      shortcut: shortcutLabel('⌥⌘T', 'Alt+Ctrl+T'),
      icon: <Languages className="w-3.5 h-3.5 text-[var(--accent)]" />,
      action: onToggleTranslate,
    },
    {
      id: 'find',
      title: '페이지 내 검색 (Find in Page)',
      category: '도구',
      shortcut: shortcutLabel('⌘F', 'Ctrl+F'),
      icon: <Search className="w-3.5 h-3.5 text-amber-400" />,
      action: onOpenFind,
    },
    {
      id: 'aside',
      title: 'Aside 서랍 패널 (번역/메모/다운로드) 토글',
      category: '화면',
      shortcut: shortcutLabel('⌘\\', 'Ctrl+\\'),
      icon: <PanelRight className="w-3.5 h-3.5 text-[var(--text-secondary)]" />,
      action: onToggleAside,
    },
    {
      id: 'reload-nocache',
      title: '캐시 비우고 새로고침',
      category: '개발자',
      shortcut: shortcutLabel('⌘⇧R', 'Ctrl+Shift+R'),
      icon: <RotateCw className="w-3.5 h-3.5 text-[var(--text-muted)]" />,
      action: onReloadWithoutCache,
    },
    {
      id: 'copy-url',
      title: '현재 전체 URL 복사',
      category: '복사 도구',
      icon: <Copy className="w-3.5 h-3.5 text-[var(--text-muted)]" />,
      action: onCopyUrl,
    },
    {
      id: 'copy-title',
      title: '현재 페이지 제목 복사',
      category: '복사 도구',
      icon: <Copy className="w-3.5 h-3.5 text-[var(--text-muted)]" />,
      action: onCopyTitle,
    },
    {
      id: 'copy-title-url',
      title: '페이지 제목과 URL 복사',
      category: '복사 도구',
      icon: <Copy className="w-3.5 h-3.5 text-[var(--text-muted)]" />,
      action: onCopyTitleUrl,
    },
    {
      id: 'copy-origin',
      title: '현재 Origin (도메인) 복사',
      category: '복사 도구',
      icon: <Link className="w-3.5 h-3.5 text-[var(--text-muted)]" />,
      action: onCopyOrigin,
    },
    {
      id: 'copy-hostname',
      title: '현재 Hostname 복사',
      category: '복사 도구',
      icon: <Link className="w-3.5 h-3.5 text-[var(--text-muted)]" />,
      action: handleCopyHostname,
    },
    {
      id: 'copy-markdown',
      title: '현재 페이지 Markdown 링크 복사 ([제목](URL))',
      category: '복사 도구',
      icon: <Copy className="w-3.5 h-3.5 text-[var(--text-muted)]" />,
      action: handleCopyMarkdown,
    },
    {
      id: 'reset-zoom',
      title: '화면 배율 리셋 (100%)',
      category: '화면',
      shortcut: shortcutLabel('⌘0', 'Ctrl+0'),
      icon: <ZoomIn className="w-3.5 h-3.5 text-[var(--text-muted)]" />,
      action: onResetZoom,
    },
    {
      id: 'clear-history',
      title: '방문 기록 전체 삭제',
      category: '개인정보',
      icon: <Trash2 className="w-3.5 h-3.5 text-[var(--danger)]" />,
      action: onClearHistory,
    },
  ];

  const filtered = commands.filter((cmd) => {
    const q = query.toLowerCase();
    return cmd.title.toLowerCase().includes(q) || cmd.category.toLowerCase().includes(q);
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = filtered[selectedIndex];
      if (selected) {
        selected.action();
        onClose();
      }
    }
  };

  return (
    <div
      className="command-palette-overlay aero-overlay fixed inset-0 z-50 flex items-start justify-center px-4 pt-20 select-none overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="command-palette aero-modal w-full max-w-[500px] max-h-[calc(100dvh-2rem)] min-h-0 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="aero-panel-header flex items-center px-3 h-10 border-b">
          <Search className="w-3.5 h-3.5 text-[var(--text-muted)] mr-2 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="검색"
            className="w-full bg-transparent text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none font-sans"
          />
          <button onClick={onClose} className="aero-icon-button !h-7 !w-7">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="command-palette-list min-h-0 flex-1 max-h-[340px] overflow-y-auto p-1.5 space-y-0.5">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-[var(--text-muted)]">
              일치하는 Aero 명령어가 없습니다.
            </div>
          ) : (
            filtered.map((cmd, index) => {
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={cmd.id}
                  onClick={() => {
                    cmd.action();
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  data-active={isSelected}
                  className={`aero-list-row flex items-center justify-between px-2.5 h-8 cursor-pointer text-xs transition-colors ${
                    isSelected
                      ? 'bg-[var(--accent-subtle)] text-[var(--text-primary)] border border-[var(--accent-border)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--chrome-surface-hover)] border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate pr-2">
                    <span className="flex-shrink-0">{cmd.icon}</span>
                    <span className="font-medium truncate text-xs">{cmd.title}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-[10px] text-[var(--text-muted)] px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--chrome-bg)]">
                      {cmd.category}
                    </span>
                    {cmd.shortcut && (
                      <span className="text-[10px] font-mono text-[var(--text-muted)] px-1.5 py-0.5 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--chrome-bg)]">
                        {cmd.shortcut}
                      </span>
                    )}
                    {isSelected && <CornerDownLeft className="w-3 h-3 text-[var(--accent)]" />}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="command-palette-footer shrink-0 px-3 h-6 bg-[var(--chrome-bg)]/70 border-t border-[var(--border-divider)] flex items-center justify-between gap-2 text-[10px] text-[var(--text-muted)]">
          <div className="flex items-center gap-2 min-w-0">
            <span>↑↓ 이동</span>
            <span>↵ 실행</span>
            <span>ESC 닫기</span>
          </div>
          <span className="shrink-0 max-[320px]:hidden">Aero Command Palette</span>
        </div>
      </div>
    </div>
  );
};
