import React, { useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { NullLogo } from './NullLogo';
import { BrowserSettings } from '../types/browser';
import { NavigationResult, parseNavigationInput } from '../utils/navigationParser';
import { normalizeHomeStyle } from '../../shared/appearance';

interface NewTabPageProps {
  settings: BrowserSettings;
  isIncognito?: boolean;
  onNavigate: (url: string) => void;
  onSearchExecuted?: (result: NavigationResult) => void;
}

export const NewTabPage: React.FC<NewTabPageProps> = ({ settings, isIncognito = false, onNavigate, onSearchExecuted }) => {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);

  return (
    <section className="null-newtab new-tab-page" data-home-style={normalizeHomeStyle(settings.homeStyle)} aria-label={isIncognito ? '시크릿 새 탭' : '새 탭'}>
      <div className="new-tab-content">
        <NullLogo size={112} className="null-newtab-logo" variant={isIncognito ? 'private' : 'default'} />
        <form onSubmit={event => {
          event.preventDefault();
          if (!query.trim()) return;
          const result = parseNavigationInput(query.trim(), { searchEngine: settings.searchEngine, customSearchUrl: settings.customSearchUrl });
          onSearchExecuted?.(result);
          onNavigate(result.url);
        }} autoComplete="off" className="null-newtab-form">
          <label className="null-newtab-search" onPointerDown={event => {
            if (event.button !== 0 || event.target === input.current) return;
            event.preventDefault();
            input.current?.focus();
          }}>
            <Search className="null-newtab-search-icon" strokeWidth={1.7} aria-hidden="true" />
            <input ref={input} value={query} onChange={event => setQuery(event.target.value)}
              type="text" autoFocus autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
              aria-label="검색 또는 URL" placeholder="" className="null-newtab-search-input" />
          </label>
        </form>
      </div>
    </section>
  );
};
