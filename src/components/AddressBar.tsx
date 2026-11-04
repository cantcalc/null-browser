import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Home,
  Lock,
  Search,
  Copy,
  Check,
  Code2,
  Bookmark as BookmarkIcon,
  Puzzle,
  Settings,
  MessageSquare,
} from 'lucide-react';
import { SunglassesIcon } from './SunglassesIcon';
import { isNewTabUrl, isSettingsUrl } from '../../shared/internalPages';
import { Tab, SearchEngine } from '../types/browser';
import { NavigationResult, parseNavigationInput } from '../utils/navigationParser';
import { shortcutLabel } from '../utils/platform';

function compactAddress(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.hostname + (parsed.pathname !== '/' ? parsed.pathname : '');
    }
  } catch {}
  return value;
}

interface AddressBarProps {
  isAIOpen?: boolean;
  onToggleAI?: () => void;
  isIncognito?: boolean;
  onNewPrivateWindow: () => void;
  workspaceId?: string;
  activeTab?: Tab;
  searchEngine: SearchEngine;
  customSearchUrl?: string;
  isBookmarked?: boolean;
  isAsideOpen: boolean;
  isSiteInfoOpen: boolean;
  onToggleSiteInfo: () => void;
  zoomLevel: number;
  onNavigate: (url: string) => void;
  onSearchExecuted?: (result: NavigationResult) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onGoHome: () => void;
  onToggleDevTools: () => void;
  onOpenSettings: () => void;
  onToggleAside: () => void;
  onResetZoom: () => void;
  onToggleBookmark?: () => void;
}

export const AddressBar: React.FC<AddressBarProps> = ({
  isAIOpen = false,
  onToggleAI,
  isIncognito = false,
  onNewPrivateWindow,
  workspaceId = 'workspace-default',
  activeTab,
  searchEngine,
  customSearchUrl,
  isBookmarked = false,
  isAsideOpen: _isAsideOpen,
  isSiteInfoOpen,
  onToggleSiteInfo,
  zoomLevel,
  onNavigate,
  onSearchExecuted,
  onGoBack,
  onGoForward,
  onReload,
  onGoHome,
  onToggleDevTools,
  onOpenSettings,
  onToggleAside: _onToggleAside,
  onResetZoom,
  onToggleBookmark,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [extensionRevision, setExtensionRevision] = useState(0);
  useEffect(() => window.electronAPI?.onExtensionsChanged(() => setExtensionRevision(value => value + 1)), []);

  // Select only after the compact display has become the editable full URL.
  useLayoutEffect(() => {
    if (isFocused) inputRef.current?.select();
  }, [isFocused]);

  useEffect(() => {
    if (activeTab?.url && !isNewTabUrl(activeTab.url)) {
      setInputValue(activeTab.url);
    } else {
      setInputValue('');
    }
  }, [activeTab?.url]);

  // Global Cmd+L listener to focus address bar
  useEffect(() => {
    const handleCmdL = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleCmdL);
    return () => window.removeEventListener('keydown', handleCmdL);
  }, []);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const query = inputValue.trim();
    if (!query) return;

    const targetUrl = parseNavigationInput(query, {
      searchEngine,
      customSearchUrl,
    });

    setIsFocused(false);
    onSearchExecuted?.(targetUrl);
    onNavigate(targetUrl.url);
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setInputValue(isNewTabUrl(activeTab?.url) ? '' : activeTab?.url || '');
      setIsFocused(false);
      inputRef.current?.blur();
    }
  };

  const handleCopy = () => {
    if (activeTab?.url) {
      navigator.clipboard.writeText(activeTab.url);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1200);
    }
  };

  const isSecure = activeTab?.url?.startsWith('https://');

  return (
    <div className="null-toolbar relative flex h-10 items-center gap-1.5 px-2.5 select-none z-20">
      {/* Navigation Controls */}
      <div className="null-nav-controls flex items-center gap-0.5 flex-shrink-0">
        <button
          onClick={onGoBack}
          disabled={!activeTab?.canGoBack}
          title={`뒤로 가기 (${shortcutLabel('⌘[', 'Ctrl+[')})`}
          className="null-icon-button disabled:hover:bg-transparent"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={onGoForward}
          disabled={!activeTab?.canGoForward}
          title={`앞으로 가기 (${shortcutLabel('⌘]', 'Ctrl+]')})`}
          className="null-icon-button disabled:hover:bg-transparent"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          onClick={onReload}
          title={`새로고침 (${shortcutLabel('⌘R', 'Ctrl+R')})`}
          className="null-icon-button max-[320px]:hidden"
        >
          <RotateCw
            className={`w-3.5 h-3.5 ${activeTab?.isLoading ? 'animate-spin text-[var(--accent)]' : ''}`}
          />
        </button>
        <button
          onClick={onGoHome}
          title="홈으로 이동"
          className="null-icon-button null-home-button"
        >
          <Home className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Omnibox / Search & URL Input */}
      <div className="flex-1 relative max-w-2xl mx-auto min-w-0">
        <form
          onSubmit={handleSubmit}
          autoComplete="off"
          data-focused={isFocused}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const target = event.target as Element;
            if (target.closest('input, button:not(:disabled), a')) return;
            event.preventDefault();
            inputRef.current?.focus();
          }}
          className="null-omnibox flex h-8 min-w-0 items-center px-2.5"
        >
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleSiteInfo();
            }}
            aria-label="사이트 정보"
            aria-pressed={isSiteInfoOpen}
            disabled={!/^https?:\/\//i.test(activeTab?.url || '')}
            title={isSecure ? 'HTTPS 연결 및 사이트 정보' : '사이트 정보'}
            className="null-site-button mr-1.5 flex items-center rounded-md text-[var(--text-muted)]"
          >
            {isSecure ? (
              <Lock className="w-3 h-3" />
            ) : (
              <Search className="w-3 h-3" />
            )}
          </button>

          <input
            ref={inputRef}
            type="text"
            value={isFocused ? inputValue : compactAddress(inputValue)}
            onChange={(e) => setInputValue(e.target.value)}
            onFocus={() => {
              setIsFocused(true);
            }}
            onBlur={() => setIsFocused(false)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder=""
            aria-label="검색 또는 URL"
            className="min-w-0 flex-1 w-full bg-transparent border-none outline-none text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] tracking-tight"
          />

          {activeTab?.url && !isNewTabUrl(activeTab.url) && (
            <>
              <button
                type="button"
                onClick={onToggleBookmark}
                title={isBookmarked ? '북마크에서 제거' : '현재 페이지 북마크 추가'}
                className={`null-icon-button !h-6 !w-6 ml-1 flex-shrink-0 ${
                  isBookmarked ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <BookmarkIcon className="w-3 h-3" fill={isBookmarked ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                onClick={handleCopy}
                title={isCopied ? 'URL 복사 완료' : 'URL 복사'}
                className="null-icon-button !h-6 !w-6 ml-1 flex-shrink-0"
              >
                {isCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              </button>
            </>
          )}
        </form>

      </div>

      {/* Right Action Tools (High Density Icons) */}
      <div className="null-toolbar-actions flex items-center gap-0.5 flex-shrink-0">
        {!isIncognito && onToggleAI && <button type="button" className="null-icon-button" aria-label="NULL AI 열기" aria-pressed={isAIOpen} title="NULL AI" onClick={onToggleAI}><MessageSquare size={15} /></button>}
        <button type="button" onClick={onNewPrivateWindow}
          aria-label="새 시크릿 창" title={`새 시크릿 창 (${shortcutLabel('⌘⇧N', 'Ctrl+Shift+N')})`}
          className="null-icon-button null-private-button" data-private-window={isIncognito ? 'true' : 'false'}>
          <SunglassesIcon className="w-4 h-4" />
        </button>
        {window.electronAPI && new URLSearchParams(window.location.search).get('incognito') !== '1' && (
          <>
            {React.createElement('browser-action-list', { key: `${workspaceId}:${extensionRevision}`, partition: `workspace:${workspaceId}`, className: 'null-extension-actions', alignment: 'bottom left' })}
            <button
              type="button"
              onClick={() => window.electronAPI?.openExtensionStore()}
              title="Chrome 웹 스토어에서 확장 프로그램 추가"
              aria-label="확장 프로그램 스토어"
              className="null-icon-button"
            >
              <Puzzle className="w-3.5 h-3.5" />
            </button>
          </>
        )}
        {/* Zoom Indicator if changed */}
        {zoomLevel !== 1 && (
          <button
            onClick={onResetZoom}
          title={`화면 배율 리셋 (100% - ${shortcutLabel('⌘0', 'Ctrl+0')})`}
            className="null-quiet-button text-[10px] font-mono px-2 h-7 rounded-[var(--radius-md)] bg-[var(--chrome-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)]"
          >
            {Math.round(zoomLevel * 100)}%
          </button>
        )}

        {/* Chrome Developer Tools Button */}
        <button
          onClick={onToggleDevTools}
          title={`크롬 개발자 도구 열기/닫기 (${shortcutLabel('⌥⌘I / F12', 'Alt+Ctrl+I / F12')})`}
          className="null-icon-button null-devtools-button max-[320px]:hidden"
        >
          <Code2 className="w-3.5 h-3.5" />
        </button>

        {!isIncognito && <button
          type="button"
          onClick={onOpenSettings}
          title={`설정 (${shortcutLabel('⌘,', 'Ctrl+,')})`}
          aria-label="브라우저 설정"
          aria-pressed={isSettingsUrl(activeTab?.url)}
          className="null-icon-button"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>}
      </div>
    </div>
  );
};
