import React, { useEffect, useState } from 'react';
import { Search, Plus, X, Globe, ExternalLink, Bookmark as BookmarkIcon, Clock3 } from 'lucide-react';
import { BrowserSettings, FavoriteItem, HistoryEntry, SearchHistoryItem, Tab, Bookmark } from '../types/browser';
import { NavigationResult, parseNavigationInput } from '../utils/navigationParser';
import { getOmniboxSuggestions, OmniboxSuggestion } from '../utils/suggestionEngine';

interface NewTabPageProps {
  settings: BrowserSettings;
  isIncognito?: boolean;
  favorites: FavoriteItem[];
  recentHistory: HistoryEntry[];
  openTabs: Tab[];
  bookmarks: Bookmark[];
  searchHistory: SearchHistoryItem[];
  includeSearchHistory: boolean;
  onNavigate: (url: string) => void;
  onSearchExecuted?: (result: NavigationResult) => void;
  onAddFavorite: (title: string, url: string) => void;
  onRemoveFavorite: (id: string) => void;
}

export const NewTabPage: React.FC<NewTabPageProps> = ({
  settings,
  isIncognito = false,
  favorites,
  recentHistory,
  openTabs,
  bookmarks,
  searchHistory,
  includeSearchHistory,
  onNavigate,
  onSearchExecuted,
  onAddFavorite,
  onRemoveFavorite,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<OmniboxSuggestion[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newUrl, setNewUrl] = useState('');

  const config = settings.newTabConfig || {
    showFavorites: true,
    showRecentSites: true,
    showLogo: true,
    compactMode: false,
  };

  useEffect(() => {
    if (!isSearchFocused || !searchQuery.trim()) {
      setSuggestions([]);
      return;
    }
    setSuggestions(getOmniboxSuggestions(searchQuery, {
      tabs: openTabs,
      bookmarks,
      searchHistory,
      includeSearchHistory,
    }));
  }, [searchQuery, isSearchFocused, openTabs, bookmarks, searchHistory, includeSearchHistory]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;

    const target = parseNavigationInput(q, {
      searchEngine: settings.searchEngine,
      customSearchUrl: settings.customSearchUrl,
      searchShortcuts: settings.searchShortcuts,
    });

    onSearchExecuted?.(target);
    onNavigate(target.url);
    setIsSearchFocused(false);
  };

  const handleCreateFavorite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrl.trim()) return;
    let url = newUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }
    let title = newTitle.trim();
    try {
      title = title || new URL(url).hostname;
    } catch {
      return;
    }
    onAddFavorite(title, url);
    setNewTitle('');
    setNewUrl('');
    setIsAddModalOpen(false);
  };

  return (
    <div className="aero-newtab new-tab-page w-full h-full flex flex-col items-center justify-center max-[420px]:justify-start p-6 text-[var(--text-primary)] select-none overflow-y-auto">
      <div className={`new-tab-content w-full max-w-2xl flex flex-col items-center space-y-8 my-auto max-[420px]:my-6 ${config.compactMode ? '' : 'pb-12'}`}>
        {/* 1. Aero Branding Logo */}
        {config.showLogo && (
          <div className="flex flex-col items-center space-y-2">
            <div className="aero-wordmark flex items-center gap-4">
              <div className="aero-logo-mark" aria-hidden="true">
                <span className="aero-logo-stroke aero-logo-stroke-one" />
                <span className="aero-logo-stroke aero-logo-stroke-two" />
                <span className="aero-logo-stroke aero-logo-stroke-three" />
              </div>
              <div className="flex flex-col items-start"><h1 className="aero-wordmark-title text-[30px] font-medium tracking-[-0.035em] text-[var(--text-primary)] font-sans">Aero</h1>{isIncognito && <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Private</span>}</div>
            </div>
          </div>
        )}

        {/* 2. Central Omni Search Bar */}
        <form onSubmit={handleSearchSubmit} className="w-full relative">
          <div className="aero-newtab-search relative flex items-center min-w-0 px-4 transition-all">
            <Search className="aero-newtab-search-icon w-4 h-4 text-[var(--text-muted)] mr-2.5 flex-shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
              placeholder=""
              aria-label="검색 또는 URL"
              autoFocus
              className="aero-newtab-search-input min-w-0 flex-1 bg-transparent border-none outline-none text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] selection:bg-[var(--accent)] selection:text-[var(--accent-foreground)]"
            />
          </div>
          {isSearchFocused && suggestions.length > 0 && (
            <div className="aero-popover absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden py-1 text-xs">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  onMouseDown={() => {
                    if (suggestion.type === 'search') {
                      const target = parseNavigationInput(suggestion.url, {
                        searchEngine: settings.searchEngine,
                        customSearchUrl: settings.customSearchUrl,
                        searchShortcuts: settings.searchShortcuts,
                      });
                      onSearchExecuted?.(target);
                      onNavigate(target.url);
                    } else {
                      onNavigate(suggestion.url);
                    }
                    setSearchQuery(suggestion.type === 'search' ? suggestion.url : suggestion.title);
                    setIsSearchFocused(false);
                  }}
                  className="aero-list-row flex w-full items-center gap-2 px-3 py-2 text-left text-[var(--text-primary)]"
                >
                  {suggestion.type === 'bookmark' ? <BookmarkIcon className="h-3.5 w-3.5 shrink-0 text-amber-400" /> : <Search className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />}
                  <span className="min-w-0 flex-1 truncate font-medium">{suggestion.title}</span>
                  <span className="max-w-[42%] truncate text-[10px] text-[var(--text-muted)]">{suggestion.detail || suggestion.url}</span>
                </button>
              ))}
            </div>
          )}
        </form>

        {/* 3. Favorites Tile Grid */}
        {config.showFavorites && (
          <div className="w-full space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-medium text-[var(--text-secondary)]">즐겨찾기</span>
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline font-medium"
              >
                <Plus className="w-3 h-3" />
                추가
              </button>
            </div>

            <div className="grid grid-cols-2 min-[420px]:grid-cols-4 sm:grid-cols-6 gap-2">
              {favorites.map((fav) => (
                <div
                  key={fav.id}
                  onClick={() => onNavigate(fav.url)}
                  className="aero-favorite-tile group relative flex min-w-0 flex-col items-center justify-center p-3 cursor-pointer"
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveFavorite(fav.id);
                    }}
                    title="삭제"
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--danger)] transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>

                  <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--chrome-bg)] flex items-center justify-center mb-2 overflow-hidden">
                    {fav.favicon ? (
                      <img
                        src={fav.favicon}
                        alt=""
                        className="w-4 h-4 object-contain"
                        onError={(event) => { event.currentTarget.style.display = 'none'; }}
                      />
                    ) : (
                      <Globe className="w-4 h-4 text-[var(--text-muted)]" />
                    )}
                  </div>

                  <span className="w-full min-w-0 text-[11px] font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] truncate text-center">
                    {fav.title}
                  </span>
                </div>
              ))}

              {/* Add Favorite Tile */}
              {favorites.length < 12 && (
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="aero-favorite-add flex h-[86px] flex-col items-center justify-center p-3 text-[var(--text-muted)]"
                >
                  <Plus className="w-5 h-5 mb-1 opacity-70" />
                  <span className="text-[11px] font-medium">추가</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* 4. Recent Sites */}
        {config.showRecentSites && recentHistory.length > 0 && (
          <div className="w-full space-y-2 pt-2">
            <div className="text-xs font-medium text-[var(--text-secondary)] px-1">최근 방문 사이트</div>
            <div className="grid grid-cols-1 min-[520px]:grid-cols-2 gap-2">
              {recentHistory.slice(0, 4).map((entry) => (
                <div
                  key={entry.id}
                  onClick={() => onNavigate(entry.url)}
                  className="aero-recent-row group flex items-center gap-2.5 p-2.5 cursor-pointer"
                >
                  <Globe className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-[var(--text-primary)] truncate">{entry.title}</div>
                    <div className="text-[10px] font-mono text-[var(--text-muted)] truncate">
                      {(() => {
                        try {
                          return new URL(entry.url).hostname;
                        } catch {
                          return entry.url;
                        }
                      })()}
                    </div>
                  </div>
                  <ExternalLink className="w-3 h-3 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 flex-shrink-0" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Quick Add Favorite Modal */}
      {isAddModalOpen && (
          <div className="aero-overlay fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4">
          <div className="aero-modal w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2.5">
              <h3 className="text-xs font-semibold text-[var(--text-primary)]">즐겨찾기 추가</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="aero-icon-button !h-7 !w-7">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateFavorite} className="space-y-3">
              <div className="space-y-1">
                <label className="text-[11px] text-[var(--text-secondary)]">이름 (선택 사항)</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="예: GitHub"
                  className="aero-field w-full px-3 py-2 text-xs outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-[var(--text-secondary)]">URL (웹 주소)</label>
                <input
                  type="text"
                  required
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://github.com"
                  autoFocus
                  className="aero-field w-full px-3 py-2 text-xs outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--chrome-surface-hover)] rounded-[var(--radius-md)]"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="aero-primary-button px-3 py-1.5 text-xs font-semibold shadow-xs"
                >
                  추가
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
