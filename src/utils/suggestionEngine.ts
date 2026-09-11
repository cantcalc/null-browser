import { Bookmark, SearchHistoryItem, Tab } from '../types/browser';

export type OmniboxSuggestionType = 'tab' | 'bookmark' | 'search';

export interface OmniboxSuggestion {
  id: string;
  title: string;
  url: string;
  type: OmniboxSuggestionType;
  detail?: string;
}

interface SuggestionSources {
  tabs?: Tab[];
  bookmarks?: Bookmark[];
  searchHistory?: SearchHistoryItem[];
  includeSearchHistory?: boolean;
}

function matches(value: string, query: string): boolean {
  return value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

export function getOmniboxSuggestions(query: string, sources: SuggestionSources): OmniboxSuggestion[] {
  const normalized = query.trim();
  const lower = normalized.toLocaleLowerCase();
  const seenUrls = new Set<string>();
  const results: OmniboxSuggestion[] = [];
  const add = (item: OmniboxSuggestion) => {
    if (results.length >= 10 || (item.url && seenUrls.has(item.url))) return;
    if (item.url) seenUrls.add(item.url);
    results.push(item);
  };

  for (const tab of sources.tabs || []) {
    if (!normalized || matches(`${tab.title} ${tab.url} ${hostnameOf(tab.url)}`, lower)) {
      add({ id: `tab-${tab.id}`, title: tab.title || hostnameOf(tab.url), url: tab.url, type: 'tab', detail: '열린 탭' });
    }
  }
  for (const bookmark of sources.bookmarks || []) {
    if (!normalized || matches(`${bookmark.title} ${bookmark.url} ${hostnameOf(bookmark.url)}`, lower)) {
      add({ id: `bookmark-${bookmark.id}`, title: bookmark.title || hostnameOf(bookmark.url), url: bookmark.url, type: 'bookmark', detail: '북마크' });
    }
  }
  if (sources.includeSearchHistory !== false && normalized.length >= 2) {
    for (const entry of sources.searchHistory || []) {
      if (!normalized || matches(entry.query, lower)) {
        add({ id: `search-${entry.id}`, title: entry.query, url: entry.query, type: 'search', detail: `${entry.engineId} 검색` });
      }
    }
  }
  return results;
}
