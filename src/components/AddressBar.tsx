import React, { useState, useEffect, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Home,
  Lock,
  Search,
  Copy,
  Check,
  Languages,
  Code2,
  Command,
  Bookmark as BookmarkIcon,
  Globe,
  Loader2,
} from 'lucide-react';
import { Tab, SearchEngine, Bookmark, SearchHistoryItem, SearchShortcut } from '../types/browser';
import { SiteInfoPopover } from './SiteInfoPopover';
import { NavigationResult, parseNavigationInput } from '../utils/navigationParser';
import { getOmniboxSuggestions, OmniboxSuggestion } from '../utils/suggestionEngine';
import { shortcutLabel } from '../utils/platform';

const isNewTabUrl = (url?: string) =>
  !url || url === 'aero://newtab' || url === 'browser://newtab' || url === 'about:blank';

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
  activeTab?: Tab;
  searchEngine: SearchEngine;
  searchShortcuts?: SearchShortcut[];
  customSearchUrl?: string;
  tabs: Tab[];
  searchHistory: SearchHistoryItem[];
  includeSearchHistory: boolean;
  isPageTranslated: boolean;
  isBookmarked?: boolean;
  isTranslating?: boolean;
  isAsideOpen: boolean;
  bookmarks: Bookmark[];
  zoomLevel: number;
  onNavigate: (url: string) => void;
  onSearchExecuted?: (result: NavigationResult) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onGoHome: () => void;
  onTranslatePage: () => void;
  onToggleDevTools: () => void;
  onOpenCommandPalette: () => void;
  onToggleAside: () => void;
  onResetZoom: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onToggleMuteTab?: (tabId: string) => void;
  onToggleBookmark?: () => void;
  onSiteInfoOpenChange?: (isOpen: boolean) => void;
  sitePermissions?: Record<string, 'allow' | 'deny'>;
  onSitePermissionChange?: (permission: string, decision: 'allow' | 'deny' | 'default') => void;
  siteTranslationMode?: 'always' | 'never' | 'ask';
  onSiteTranslationModeChange?: (mode: 'always' | 'never' | 'ask') => void;
}

export const AddressBar: React.FC<AddressBarProps> = ({
  activeTab,
  searchEngine,
  searchShortcuts = [],
  customSearchUrl,
  tabs,
  searchHistory,
  includeSearchHistory,
  isPageTranslated,
  isBookmarked = false,
  isTranslating = false,
  isAsideOpen: _isAsideOpen,
  bookmarks,
  zoomLevel,
  onNavigate,
  onSearchExecuted,
  onGoBack,
  onGoForward,
  onReload,
  onGoHome,
  onTranslatePage,
  onToggleDevTools,
  onOpenCommandPalette,
  onToggleAside: _onToggleAside,
  onResetZoom,
  onZoomIn,
  onZoomOut,
  onToggleMuteTab,
  onToggleBookmark,
  onSiteInfoOpenChange,
  sitePermissions,
  onSitePermissionChange,
  siteTranslationMode,
  onSiteTranslationModeChange,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isSiteInfoOpen, setIsSiteInfoOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<OmniboxSuggestion[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeTab?.url && !isNewTabUrl(activeTab.url)) {
      setInputValue(activeTab.url);
    } else {
      setInputValue('');
    }
  }, [activeTab?.url]);

  useEffect(() => {
    setIsSiteInfoOpen(false);
    onSiteInfoOpenChange?.(false);
  }, [activeTab?.id, onSiteInfoOpenChange]);

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

  // Keep the address bar and New Tab on the same suggestion source so the
  // browser does not behave differently depending on which surface is active.
  useEffect(() => {
    if (!isFocused) {
      setSuggestions([]);
      return;
    }
    setSuggestions(getOmniboxSuggestions(inputValue, {
      tabs,
      bookmarks,
      searchHistory,
      includeSearchHistory,
    }));
  }, [inputValue, isFocused, tabs, bookmarks, searchHistory, includeSearchHistory]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const query = inputValue.trim();
    if (!query) return;

    const targetUrl = parseNavigationInput(query, {
      searchEngine,
      customSearchUrl,
      searchShortcuts,
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
    <div className="aero-toolbar relative flex h-10 items-center gap-1.5 px-2.5 select-none z-20">
      {/* Navigation Controls */}
      <div className="aero-nav-controls flex items-center gap-0.5 flex-shrink-0">
        <button
          onClick={onGoBack}
          disabled={!activeTab?.canGoBack}
          title={`뒤로 가기 (${shortcutLabel('⌘[', 'Ctrl+[')})`}
          className="aero-icon-button disabled:hover:bg-transparent"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={onGoForward}
          disabled={!activeTab?.canGoForward}
          title={`앞으로 가기 (${shortcutLabel('⌘]', 'Ctrl+]')})`}
          className="aero-icon-button disabled:hover:bg-transparent"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          onClick={onReload}
          title={`새로고침 (${shortcutLabel('⌘R', 'Ctrl+R')})`}
          className="aero-icon-button max-[320px]:hidden"
        >
          <RotateCw
            className={`w-3.5 h-3.5 ${activeTab?.isLoading ? 'animate-spin text-[var(--accent)]' : ''}`}
          />
        </button>
        <button
          onClick={onGoHome}
          title="홈으로 이동"
          className="aero-icon-button aero-home-button"
        >
          <Home className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Omnibox / Search & URL Input */}
      <div className="flex-1 relative max-w-2xl mx-auto min-w-0">
        <form
          onSubmit={handleSubmit}
          data-focused={isFocused}
          className="aero-omnibox flex h-8 min-w-0 items-center px-2.5"
        >
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsSiteInfoOpen((prev) => {
                const next = !prev;
                onSiteInfoOpenChange?.(next);
                return next;
              });
            }}
            title={isSecure ? 'HTTPS 연결 및 사이트 정보' : '사이트 정보'}
            className="aero-site-button mr-1.5 flex items-center rounded-md text-[var(--text-muted)]"
          >
            {isSecure ? (
              <Lock className="w-3 h-3 text-emerald-500" />
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
              inputRef.current?.select();
            }}
            onBlur={() => setTimeout(() => setIsFocused(false), 200)}
            onKeyDown={handleKeyDown}
            placeholder="검색"
            aria-label="검색 또는 URL"
            className="min-w-0 flex-1 w-full bg-transparent border-none outline-none text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] tracking-tight"
          />

          {activeTab?.url && !isNewTabUrl(activeTab.url) && (
            <>
              <button
                type="button"
                onClick={onToggleBookmark}
                title={isBookmarked ? '북마크에서 제거' : '현재 페이지 북마크 추가'}
                className={`aero-icon-button !h-6 !w-6 ml-1 flex-shrink-0 ${
                  isBookmarked ? 'text-amber-400' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <BookmarkIcon className="w-3 h-3" fill={isBookmarked ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                onClick={handleCopy}
                title={isCopied ? 'URL 복사 완료' : 'URL 복사'}
                className="aero-icon-button !h-6 !w-6 ml-1 flex-shrink-0"
              >
                {isCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </button>
            </>
          )}
        </form>

        {/* Omnibox suggestions */}
        {isFocused && suggestions.length > 0 && (
          <div className="aero-popover absolute left-0 right-0 top-full mt-1 overflow-hidden z-50 py-1 text-xs">
            {suggestions.map((s, idx) => (
              <div
                key={idx}
                onMouseDown={() => {
                  if (s.type === 'search') {
                    const target = parseNavigationInput(s.url, {
                      searchEngine,
                      customSearchUrl,
                      searchShortcuts,
                    });
                    setInputValue(s.url);
                    onSearchExecuted?.(target);
                    onNavigate(target.url);
                  } else {
                    setInputValue(s.url);
                    onNavigate(s.url);
                  }
                  setIsFocused(false);
                }}
                className="aero-list-row flex items-center justify-between px-3 py-1.5 cursor-pointer text-[var(--text-primary)]"
              >
                <div className="flex min-w-0 items-center gap-2 truncate">
                  {s.type === 'bookmark' ? (
                    <BookmarkIcon className="w-3 h-3 text-amber-400 flex-shrink-0" />
                  ) : s.type === 'tab' ? (
                    <Globe className="w-3 h-3 text-[var(--accent)] flex-shrink-0" />
                  ) : (
                    <Search className="w-3 h-3 text-[var(--accent)] flex-shrink-0" />
                  )}
                  <span className="font-medium truncate text-xs">{s.title}</span>
                </div>
                <span className="shrink-0 text-[11px] text-[var(--text-muted)] truncate max-w-[45%] ml-2 font-mono">
                  {s.detail || s.url}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Site Information Popover */}
        <SiteInfoPopover
          url={activeTab?.url}
          isOpen={isSiteInfoOpen}
          isMuted={activeTab?.isMuted || false}
          zoomLevel={zoomLevel}
          onClose={() => {
            setIsSiteInfoOpen(false);
            onSiteInfoOpenChange?.(false);
          }}
          onToggleMute={() => {
            if (activeTab?.id && onToggleMuteTab) onToggleMuteTab(activeTab.id);
          }}
          onZoomIn={onZoomIn || (() => {})}
          onZoomOut={onZoomOut || (() => {})}
          onResetZoom={onResetZoom}
          permissions={sitePermissions}
          onPermissionChange={onSitePermissionChange}
          translationMode={siteTranslationMode}
          onTranslationModeChange={onSiteTranslationModeChange}
        />
      </div>

      {/* Right Action Tools (High Density Icons) */}
      <div className="aero-toolbar-actions flex items-center gap-0.5 flex-shrink-0">
        {/* Zoom Indicator if changed */}
        {zoomLevel !== 1 && (
          <button
            onClick={onResetZoom}
          title={`화면 배율 리셋 (100% - ${shortcutLabel('⌘0', 'Ctrl+0')})`}
            className="aero-quiet-button text-[10px] font-mono px-2 h-7 rounded-[var(--radius-md)] bg-[var(--chrome-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)]"
          >
            {Math.round(zoomLevel * 100)}%
          </button>
        )}

        {/* Korean Translation Button (1-Click Toggle with Loading State) */}
        <button
          onClick={onTranslatePage}
          disabled={isTranslating}
          title={
            isTranslating
              ? '페이지 번역 진행 중...'
              : isPageTranslated
              ? `원문 페이지로 복원 (${shortcutLabel('⌥⌘T', 'Alt+Ctrl+T')})`
              : `현재 페이지 한국어로 번역 (${shortcutLabel('⌥⌘T', 'Alt+Ctrl+T')})`
          }
          className={`aero-icon-button border transition-all ${
            isTranslating
              ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border-[var(--accent-border)] cursor-wait animate-pulse'
              : isPageTranslated
              ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border-[var(--accent-border)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--chrome-surface-hover)] border-transparent'
          }`}
        >
          {isTranslating ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" />
          ) : (
            <Languages className="w-3.5 h-3.5" />
          )}
        </button>

        {/* Chrome Developer Tools Button */}
        <button
          onClick={onToggleDevTools}
          title={`크롬 개발자 도구 열기/닫기 (${shortcutLabel('⌥⌘I / F12', 'Alt+Ctrl+I / F12')})`}
          className="aero-icon-button aero-devtools-button max-[320px]:hidden"
        >
          <Code2 className="w-3.5 h-3.5" />
        </button>

        {/* Command Palette Trigger */}
        <button
          onClick={onOpenCommandPalette}
          title={`커맨드 팔레트 (${shortcutLabel('⌘K', 'Ctrl+K')})`}
          className="aero-icon-button"
        >
          <Command className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
