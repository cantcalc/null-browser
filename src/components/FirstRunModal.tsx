import React, { useEffect, useRef, useState } from 'react';
import { Wind, Check, ArrowRight } from 'lucide-react';
import { BrowserSettings, SearchEngine } from '../types/browser';
import { ACCENT_OPTIONS, getAccentForeground, getThemeOption, THEME_OPTIONS } from '../constants/appearance';

interface FirstRunModalProps {
  isOpen: boolean;
  settings: BrowserSettings;
  onComplete: (configuredSettings: Partial<BrowserSettings>) => void;
}

export const FirstRunModal: React.FC<FirstRunModalProps> = ({ isOpen, settings, onComplete }) => {
  const [selectedTheme, setSelectedTheme] = useState<BrowserSettings['theme']>(settings.theme || 'noir');
  const [selectedAccent, setSelectedAccent] = useState<string>(settings.accentColor || '#ffffff');
  const [selectedEngine, setSelectedEngine] = useState<SearchEngine>(settings.searchEngine || 'google');
  const [selectedStartup, setSelectedStartup] = useState<BrowserSettings['startupBehavior']>(
    settings.startupBehavior || 'newtab'
  );

  const initialThemeRef = useRef<BrowserSettings['theme']>(settings.theme || 'noir');
  const initialAccentRef = useRef<string>(settings.accentColor || '#ffffff');

  // Settings arrive asynchronously on the first render. Keep the onboarding
  // draft in sync when the persisted profile is finally available.
  useEffect(() => {
    if (!isOpen) return;
    const theme = settings.theme || 'noir';
    const accent = settings.accentColor || '#ffffff';
    initialThemeRef.current = theme;
    initialAccentRef.current = accent;
    setSelectedTheme(theme);
    setSelectedAccent(accent);
    setSelectedEngine(settings.searchEngine || 'google');
    setSelectedStartup(settings.startupBehavior || 'newtab');
  }, [isOpen, settings]);

  // First-run choices are a real draft: reflect them across the chrome
  // immediately, but only persist them after the user starts browsing.
  useEffect(() => {
    if (!isOpen) return;
    const root = document.documentElement;
    root.setAttribute('data-theme', selectedTheme);
    root.style.setProperty('--accent', selectedAccent);
    root.style.setProperty('--accent-subtle', `${selectedAccent}20`);
    root.style.setProperty('--accent-border', `${selectedAccent}40`);
    root.style.setProperty('--accent-foreground', getAccentForeground(selectedAccent));
  }, [isOpen, selectedTheme, selectedAccent]);

  const restorePreview = () => {
    const root = document.documentElement;
    root.setAttribute('data-theme', initialThemeRef.current);
    root.style.setProperty('--accent', initialAccentRef.current);
    root.style.setProperty('--accent-subtle', `${initialAccentRef.current}20`);
    root.style.setProperty('--accent-border', `${initialAccentRef.current}40`);
    root.style.setProperty('--accent-foreground', getAccentForeground(initialAccentRef.current));
  };

  if (!isOpen) return null;

  const ENGINES: { id: SearchEngine; label: string }[] = [
    { id: 'google', label: 'Google' },
    { id: 'naver', label: 'Naver' },
    { id: 'duckduckgo', label: 'DuckDuckGo' },
    { id: 'bing', label: 'Bing' },
  ];

  const handleFinish = () => {
    onComplete({
      firstRunCompleted: true,
      theme: selectedTheme,
      accentColor: selectedAccent,
      searchEngine: selectedEngine,
      startupBehavior: selectedStartup,
    });
  };

  const handleSelectTheme = (theme: BrowserSettings['theme']) => {
    setSelectedTheme(theme);
    const defaultAccent = getThemeOption(theme)?.defaultAccent;
    if (defaultAccent) setSelectedAccent(defaultAccent);
  };

  const handleSkip = () => {
    restorePreview();
    onComplete({ firstRunCompleted: true });
  };

  return (
    <div className="aero-overlay fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 select-none" role="presentation">
      <div className="aero-modal w-full max-w-xl max-h-[calc(100dvh-2rem)] overflow-y-auto flex flex-col p-6 max-[480px]:p-4 space-y-5 max-[480px]:space-y-4 animate-in fade-in zoom-in-95 duration-200" role="dialog" aria-modal="true" aria-labelledby="first-run-title">
        {/* Branding Header */}
        <div className="text-center space-y-1.5 pt-1">
          <div className="aero-logo-mark mb-1">
            <Wind className="w-5 h-5" />
          </div>
          <h2 id="first-run-title" className="text-lg font-semibold text-[var(--text-primary)] tracking-tight">Aero 시작하기</h2>
          <p className="text-xs text-[var(--text-secondary)]">원하는 분위기를 고르면 아래 미리보기에 즉시 반영됩니다.</p>
        </div>

        {/* Live preview */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-secondary)]">실시간 미리보기</span>
            <span className="text-[10px] text-[var(--accent)]" aria-live="polite">
              {THEME_OPTIONS.find((theme) => theme.id === selectedTheme)?.label} · {ACCENT_OPTIONS.find((accent) => accent.color === selectedAccent)?.label || '사용자 지정'}
            </span>
          </div>
          <div className="aero-panel-section overflow-hidden shadow-inner" aria-label="선택한 테마와 액센트 미리보기">
            <div className="flex h-8 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--chrome-toolbar)] px-3">
              <span className="h-2 w-2 rounded-full bg-rose-400/80" />
              <span className="h-2 w-2 rounded-full bg-amber-400/80" />
              <span className="h-2 w-2 rounded-full bg-emerald-400/80" />
              <span className="ml-2 text-[9px] font-medium tracking-[0.18em] text-[var(--text-muted)]">AERO</span>
              <span className="ml-auto h-1.5 w-10 rounded-full bg-[var(--accent)] opacity-80" />
            </div>
            <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--chrome-bg)] px-3 py-2">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--chrome-surface-active)] px-2.5 py-1.5">
                <Wind className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
                <span className="truncate text-[11px] text-[var(--text-primary)]">새 탭</span>
              </div>
              <span className="px-1 text-sm text-[var(--accent)]">+</span>
            </div>
            <div className="flex items-center gap-1.5 bg-[var(--chrome-toolbar)] px-3 py-2">
              <span className="text-sm text-[var(--text-muted)]">‹</span>
              <span className="text-sm text-[var(--text-muted)]">›</span>
              <span className="text-sm text-[var(--accent)]">↻</span>
              <div className="ml-1 flex min-w-0 flex-1 items-center rounded-md border border-[var(--border-subtle)] bg-[var(--chrome-bg)] px-2 py-1 text-[10px] text-[var(--text-muted)]">검색 또는 URL</div>
              <span className="h-4 w-4 rounded-md bg-[var(--accent)] opacity-85" />
            </div>
            <div className="flex h-12 items-center justify-center bg-[var(--chrome-bg)] text-[10px] text-[var(--text-muted)]">웹 콘텐츠가 이 색상 계층 위에 표시됩니다</div>
          </div>
        </div>

        {/* 1. Theme Selection */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-[var(--text-secondary)]">테마</label>
            <span className="text-[10px] text-[var(--text-muted)]">브라우저 크롬 색상</span>
          </div>
          <div className="grid grid-cols-2 gap-2 min-[560px]:grid-cols-4">
            {THEME_OPTIONS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => handleSelectTheme(t.id)}
                aria-pressed={selectedTheme === t.id}
                className={`min-w-0 w-full rounded-xl border p-2.5 text-left transition-colors ${
                  selectedTheme === t.id
                    ? 'border-[var(--accent)] bg-[var(--chrome-surface-active)] ring-1 ring-[var(--accent-border)]'
                    : 'border-[var(--border-subtle)] bg-[var(--chrome-bg)] hover:border-[var(--border-active)] hover:bg-[var(--chrome-surface-hover)]'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 shrink-0 rounded-full border border-white/20" style={{ backgroundColor: t.swatch }} />
                  <span className={`min-w-0 truncate text-xs font-medium ${selectedTheme === t.id ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>{t.label}</span>
                  {selectedTheme === t.id && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />}
                </span>
                <span className="mt-1 block truncate text-[10px] text-[var(--text-muted)]">{t.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 2. Accent Color */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-[var(--text-secondary)]">액센트 컬러</label>
            <span className="text-[10px] text-[var(--text-muted)]">포커스·활성 상태·진행 표시</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {ACCENT_OPTIONS.map((a) => (
              <button
                key={a.color}
                type="button"
                onClick={() => setSelectedAccent(a.color)}
                style={{ backgroundColor: a.color }}
                title={a.label}
                aria-label={`${a.label} 액센트 컬러`}
                aria-pressed={selectedAccent === a.color}
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-transform ${
                  selectedAccent === a.color ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-[var(--chrome-surface)]' : 'opacity-70 hover:scale-105 hover:opacity-100'
                }`}
              >
                {selectedAccent === a.color && <Check className="h-4 w-4 text-[var(--accent-foreground)]" />}
              </button>
            ))}
            <span className="text-[11px] text-[var(--text-muted)]">{ACCENT_OPTIONS.find((accent) => accent.color === selectedAccent)?.label || '사용자 지정'}</span>
          </div>
        </div>

        {/* 3. Search Engine */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--text-secondary)]">기본 검색엔진</label>
          <div className="grid grid-cols-2 min-[480px]:grid-cols-4 gap-1.5">
            {ENGINES.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setSelectedEngine(e.id)}
                className={`min-w-0 w-full py-1.5 px-2 rounded-[var(--radius-md)] text-[11px] min-[480px]:text-xs font-medium text-center leading-tight whitespace-normal break-words border transition-colors ${
                  selectedEngine === e.id
                    ? 'bg-[var(--chrome-surface-active)] text-[var(--text-primary)] border-[var(--accent)] shadow-xs'
                    : 'bg-[var(--chrome-bg)] text-[var(--text-muted)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>

        {/* 4. Startup Behavior */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--text-secondary)]">시작 시 열기</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSelectedStartup('newtab')}
                className={`min-w-0 w-full py-2 px-3 rounded-[var(--radius-md)] text-xs font-medium border text-left transition-colors ${
                selectedStartup === 'newtab'
                  ? 'bg-[var(--chrome-surface-active)] text-[var(--text-primary)] border-[var(--accent)] shadow-xs'
                  : 'bg-[var(--chrome-bg)] text-[var(--text-muted)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
              }`}
            >
              <div className="font-semibold text-[var(--text-primary)] leading-tight">Aero New Tab</div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-tight break-keep">미니멀 새 탭으로 시작</div>
            </button>
            <button
              type="button"
              onClick={() => setSelectedStartup('restore')}
                className={`min-w-0 w-full py-2 px-3 rounded-[var(--radius-md)] text-xs font-medium border text-left transition-colors ${
                selectedStartup === 'restore'
                  ? 'bg-[var(--chrome-surface-active)] text-[var(--text-primary)] border-[var(--accent)] shadow-xs'
                  : 'bg-[var(--chrome-bg)] text-[var(--text-muted)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
              }`}
            >
              <div className="font-semibold text-[var(--text-primary)] leading-tight">이전 세션 복원</div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-tight break-keep">닫기 전 탭 그대로 유지</div>
            </button>
          </div>
        </div>

        {/* Action Button */}
        <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleSkip}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] px-2 py-1 transition-colors"
          >
            건너뛰기
          </button>
          <button
            onClick={handleFinish}
            className="aero-primary-button gap-1.5 px-4 py-2 text-xs font-semibold shadow-md"
          >
            탐색 시작하기
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
