import { NullLogo } from './NullLogo';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { BrowserSettings, SearchEngine } from '../types/browser';
import { THEME_OPTIONS } from '../constants/appearance';

interface FirstRunModalProps {
  isOpen: boolean;
  settings: BrowserSettings;
  onComplete: (configuredSettings: Partial<BrowserSettings>) => void;
}

export const FirstRunModal: React.FC<FirstRunModalProps> = ({ isOpen, settings, onComplete }) => {
  const [theme, setTheme] = useState(settings.theme);
  const [engine, setEngine] = useState<SearchEngine>(settings.searchEngine);
  const [startup, setStartup] = useState<BrowserSettings['startupBehavior']>(settings.startupBehavior);
  const originalTheme = useRef(settings.theme);

  useEffect(() => {
    if (!isOpen) return;
    originalTheme.current = settings.theme;
    setTheme(settings.theme);
    setEngine(settings.searchEngine);
    setStartup(settings.startupBehavior);
  }, [isOpen, settings]);

  useEffect(() => {
    if (isOpen) document.documentElement.setAttribute('data-theme', theme);
  }, [isOpen, theme]);

  if (!isOpen) return null;

  return (
    <div className="null-overlay fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4" role="presentation">
      <div className="null-modal w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 space-y-6"
        role="dialog" aria-modal="true" aria-labelledby="first-run-title">
        <header className="text-center space-y-2">
          <NullLogo size={64} className="null-onboarding-logo" />
          <h2 id="first-run-title" className="text-lg font-medium text-[var(--text-primary)]">시작하기</h2>
          <p className="text-xs text-[var(--text-secondary)]">테마와 기본 검색 엔진을 선택하세요.</p>
        </header>
        <div className="space-y-3">
          <div className="text-xs font-medium text-[var(--text-secondary)]">테마</div>
          <div className="grid grid-cols-2 gap-3" role="group" aria-label="테마">
            {THEME_OPTIONS.map(option => (
              <button key={option.id} type="button" onClick={() => setTheme(option.id)}
                className="null-theme-choice" aria-label={option.label + ' 테마'} aria-pressed={theme === option.id}>
                <span className="null-settings-theme-preview" style={{ backgroundColor: option.swatch, borderColor: option.border }} aria-hidden="true">
                  <i style={{ backgroundColor: option.border }} /><b style={{ backgroundColor: option.border }} /><span style={{ backgroundColor: option.border }} />
                </span>
                <span className="null-style-label"><strong>{option.label}</strong><span className="null-choice-dot" data-selected={theme === option.id} aria-hidden="true" /></span>
                <small>{option.desc}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <div className="text-xs font-medium text-[var(--text-secondary)]">기본 검색엔진</div>
          <div className="grid grid-cols-2 min-[480px]:grid-cols-4 gap-2">
            {(['google', 'naver', 'duckduckgo', 'bing'] as const).map((id, index) => (
              <button key={id} type="button" onClick={() => setEngine(id)}
                className="null-quiet-button px-2 py-2 text-xs" aria-pressed={engine === id}>
                {['Google', 'Naver', 'DuckDuckGo', 'Bing'][index]}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <div className="text-xs font-medium text-[var(--text-secondary)]">시작 시 열기</div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setStartup('newtab')} aria-pressed={startup === 'newtab'} className="null-quiet-button px-3 py-2.5 text-xs">새 탭</button>
            <button type="button" onClick={() => setStartup('restore')} aria-pressed={startup === 'restore'} className="null-quiet-button px-3 py-2.5 text-xs">이전 세션 복원</button>
          </div>
        </div>
        <footer className="flex items-center justify-between gap-3 pt-1">
          <button type="button" className="null-quiet-button border-transparent px-2 py-2 text-xs" onClick={() => {
            document.documentElement.setAttribute('data-theme', originalTheme.current);
            onComplete({ firstRunCompleted: true });
          }}>건너뛰기</button>
          <button type="button" className="null-primary-button gap-2 px-4 py-2 text-xs" onClick={() => onComplete({
            firstRunCompleted: true, theme, searchEngine: engine, startupBehavior: startup,
          })}>탐색 시작하기<ArrowRight size={14} /></button>
        </footer>
      </div>
    </div>
  );
};
