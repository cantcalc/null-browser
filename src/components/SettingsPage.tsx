import { NullLogo } from './NullLogo';
import { ToggleSwitch } from './ToggleSwitch';
import { SiteSettings } from './SiteSettings';
import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Search,
  Shield,
  Palette,
  Keyboard,
  Info,
  Check,
  Download,
  Upload,
  Trash2,
  Copy,
  RotateCcw,
  Puzzle,
  Settings as SettingsIcon,
  Globe2,
  Languages,
  FolderDown,
  Database,
} from 'lucide-react';
import { BrowserSettings, SearchEngine, ClearDataOptions } from '../types/browser';
import { THEME_OPTIONS, INTERFACE_STYLES, HOME_STYLES } from '../constants/appearance';
import type { InstalledExtension, UpdateStatus } from '../../electron/types';

import type { SettingsSection } from '../../shared/internalPages';

const SECTION_ITEMS = [
  { id: 'general', label: '일반', description: 'NULL을 기본 브라우저로 설정하고 시작 페이지를 선택하세요.', icon: SettingsIcon, group: '브라우저' },
  { id: 'appearance', label: '모양 및 새 탭', description: '매일 보는 NULL의 색상과 새 탭 화면을 바꿔보세요.', icon: Palette, group: '브라우저' },
  { id: 'search', label: '검색 엔진', description: '주소창과 새 탭에서 사용할 기본 검색 엔진을 선택하세요.', icon: Search, group: '브라우저' },
  { id: 'privacy', label: '개인정보 및 보안', description: '기록 저장과 사용 기록 삭제를 관리하세요.', icon: Shield, group: '개인정보' },
  { id: 'sites', label: '사이트 설정', description: '사이트 권한과 쿠키, 저장된 사이트 데이터를 관리하세요.', icon: Globe2, group: '개인정보' },
  { id: 'languages', label: '언어', description: '웹사이트에 사용할 언어와 맞춤법 검사를 설정하세요.', icon: Languages, group: '환경설정' },
  { id: 'downloads', label: '다운로드', description: '파일을 저장할 위치와 다운로드 방식을 선택하세요.', icon: FolderDown, group: '환경설정' },
  { id: 'extensions', label: '확장 프로그램', description: 'Chrome 웹 스토어에서 확장을 추가하고 설치된 확장을 관리하세요.', icon: Puzzle, group: '환경설정' },
  { id: 'shortcuts', label: '키보드 단축키', description: '자주 사용하는 NULL 동작을 키보드로 빠르게 실행하세요.', icon: Keyboard, group: '환경설정' },
  { id: 'backup', label: '가져오기 및 백업', description: '북마크와 설정을 가져오거나 파일로 내보내세요.', icon: Database, group: 'NULL' },
  { id: 'about', label: 'NULL 정보', description: '현재 버전, 앱 업데이트와 실행 환경을 확인하세요.', icon: Info, group: 'NULL' },
] as const;
const SECTION_GROUPS = ['브라우저', '개인정보', '환경설정', 'NULL'] as const;

interface SettingsPageProps {
  isOpen: boolean;
  settings: BrowserSettings;
  initialTab?: SettingsSection;
  initialSiteOrigin?: string | null;
  onSectionChange: (section: SettingsSection) => void;
  onClose: () => void;
  onUpdateSettings: (updates: Partial<BrowserSettings>) => Promise<boolean | void> | boolean | void;
  onResetSettings?: () => void;
  onDataCleared?: (options: ClearDataOptions) => void;
  onBookmarksChanged?: () => void;
  onPermissionsChanged?: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  isOpen,
  settings,
  initialTab = 'general',
  initialSiteOrigin,
  onClose,
  onSectionChange,
  onUpdateSettings,
  onResetSettings,
  onDataCleared,
  onBookmarksChanged,
  onPermissionsChanged,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsSection>(initialTab);
  const contentRef = useRef<HTMLDivElement>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Draft settings state - changes are held here until user explicitly clicks [설정 저장]
  const [draftSettings, setDraftSettings] = useState<BrowserSettings>(settings);
  const prevIsOpenRef = useRef(false);
  const initialThemeRef = useRef(settings.theme);
  const initialStyleRef = useRef(settings.interfaceStyle);

  // Default browser status
  const [isDefaultBrowser, setIsDefaultBrowser] = useState(false);
  const [defaultCheckDone, setDefaultCheckDone] = useState(false);

  // Clear data options
  const [clearOptions, setClearOptions] = useState<ClearDataOptions>({
    history: true,
    searchHistory: true,
    downloads: false,
    cookies: false,
    cache: true,
    timeRange: 'all',
  });
  const [clearingData, setClearingData] = useState(false);
  const [dataClearedToast, setDataClearedToast] = useState(false);

  // Diagnostics & Backup
  const [diagnostics, setDiagnostics] = useState<{
    version: string;
    electronVersion: string;
    chromiumVersion: string;
    nodeVersion: string;
    platform: string;
    arch: string;
  } | null>(null);
  const [copiedDiag, setCopiedDiag] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [extensions, setExtensions] = useState<InstalledExtension[]>([]);
  const [extensionsLoading, setExtensionsLoading] = useState(false);
  const [extensionBusy, setExtensionBusy] = useState(false);
  const [extensionError, setExtensionError] = useState<string | null>(null);
  // Initialize draft and tab ONLY when modal opens (prevents tab-jumping on clicks)
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setDraftSettings(settings);
      initialThemeRef.current = settings.theme;
      initialStyleRef.current = settings.interfaceStyle;
      if (initialTab) {
        setActiveTab(initialTab);
      }
      if (window.electronAPI) {
        window.electronAPI.isDefaultBrowser().then((res) => {
          setIsDefaultBrowser(res);
          setDefaultCheckDone(true);
        });
        window.electronAPI.getDiagnostics().then(setDiagnostics);
      }
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, initialTab, settings]);

  useEffect(() => {
    if (!isOpen || !window.electronAPI) return;
    return window.electronAPI.onUpdateStatus(setUpdateStatus);
  }, [isOpen]);

  const loadExtensions = async () => {
    if (!window.electronAPI) return;
    setExtensionsLoading(true);
    setExtensionError(null);
    try {
      setExtensions(await window.electronAPI.listExtensions());
    } catch (error) {
      setExtensionError(error instanceof Error ? error.message : '확장 프로그램 목록을 불러오지 못했습니다.');
    } finally {
      setExtensionsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen || activeTab !== 'extensions') return;
    void loadExtensions();
    return window.electronAPI?.onExtensionsChanged(() => { void loadExtensions(); });
  }, [isOpen, activeTab]);

  const handleInstallExtension = async () => {
    if (!window.electronAPI) return;
    setExtensionBusy(true);
    setExtensionError(null);
    try {
      const result = await window.electronAPI.installExtension();
      if (result.ok) {
        await loadExtensions();
      } else if (result.error && result.error !== 'cancelled') {
        setExtensionError(result.error);
      }
    } catch (error) {
      setExtensionError(error instanceof Error ? error.message : '확장 프로그램을 설치하지 못했습니다.');
    } finally {
      setExtensionBusy(false);
    }
  };

  const handleRemoveExtension = async (extension: InstalledExtension) => {
    if (!window.electronAPI || !confirm(`'${extension.name}' 확장 프로그램을 제거할까요?`)) return;
    setExtensionBusy(true);
    setExtensionError(null);
    try {
      await window.electronAPI.removeExtension(extension.id);
      await loadExtensions();
    } catch (error) {
      setExtensionError(error instanceof Error ? error.message : '확장 프로그램을 제거하지 못했습니다.');
    } finally {
      setExtensionBusy(false);
    }
  };

  // Keep category navigation independent of the edit draft. Leaving the
  // settings page discards only its unsaved visual preview.
  useEffect(() => {
    if (isOpen) setActiveTab(initialTab);
  }, [isOpen, initialTab]);

  useEffect(() => {
    initialThemeRef.current = settings.theme;
    initialStyleRef.current = settings.interfaceStyle;
  }, [settings.theme, settings.interfaceStyle]);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [activeTab]);

  useEffect(() => {
    if (!isOpen) return;
    setSaveState('idle');
    return () => {
      document.documentElement.setAttribute('data-theme', initialThemeRef.current);
      document.documentElement.setAttribute('data-interface-style', initialStyleRef.current);
    };
  }, [isOpen]);

  const discardChanges = () => {
    setDraftSettings(settings);
    document.documentElement.setAttribute('data-theme', settings.theme);
    document.documentElement.setAttribute('data-interface-style', settings.interfaceStyle);
    setSaveState('idle');
  };

  const handleClosePage = () => {
    discardChanges();
    onClose();
  };

  if (!isOpen) return null;

  const updateDraft = (updates: Partial<BrowserSettings>) => {
    setDraftSettings((prev) => ({ ...prev, ...updates }));
    setSaveState('idle');
  };

  const handleSelectTheme = (themeId: BrowserSettings['theme']) => {
    updateDraft({ theme: themeId });
    // Live preview on entire application
    document.documentElement.setAttribute('data-theme', themeId);
  };

  const handleSave = async () => {
    setSaveState('saving');
    try {
      const saved = await onUpdateSettings(draftSettings);
      if (saved === false) throw new Error('Settings save failed');
      initialThemeRef.current = draftSettings.theme;
      initialStyleRef.current = draftSettings.interfaceStyle;
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  const handleMakeDefaultBrowser = async () => {
    if (window.electronAPI) {
      const res = await window.electronAPI.makeDefaultBrowser();
      setIsDefaultBrowser(res);
    }
  };

  const handleExecuteClearData = async () => {
    setClearingData(true);
    try {
      if (window.electronAPI) {
        await window.electronAPI.clearBrowsingData(clearOptions);
      }
      onDataCleared?.(clearOptions);
      setDataClearedToast(true);
      setTimeout(() => setDataClearedToast(false), 2000);
    } finally {
      setClearingData(false);
    }
  };

  const handleExportBookmarks = async () => {
    if (!window.electronAPI) return;
    const html = await window.electronAPI.exportBookmarksHtml();
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `null_bookmarks_${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportBookmarks = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.html,.htm';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      if (window.electronAPI) {
        const count = await window.electronAPI.importBookmarksHtml(text);
        onBookmarksChanged?.();
        setImportStatus(`${count}개의 북마크를 가져왔습니다.`);
        setTimeout(() => setImportStatus(null), 3000);
      }
    };
    input.click();
  };

  const handleExportSettings = async () => {
    if (!window.electronAPI) return;
    const json = await window.electronAPI.exportSettingsJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `null_settings_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportSettings = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      if (window.electronAPI) {
        const ok = await window.electronAPI.importSettingsJson(text);
        if (ok) {
          const fresh = await window.electronAPI.getSettings();
          setDraftSettings(fresh);
          onUpdateSettings(fresh);
          setImportStatus('설정을 성공적으로 복원했습니다.');
          setTimeout(() => setImportStatus(null), 3000);
        }
      }
    };
    input.click();
  };

  const handleCopyDiagnostics = () => {
    if (!diagnostics) return;
    const text = JSON.stringify(diagnostics, null, 2);
    navigator.clipboard.writeText(text);
    setCopiedDiag(true);
    setTimeout(() => setCopiedDiag(false), 1500);
  };

  const handleUpdateAction = async () => {
    if (!window.electronAPI) return;
    if (updateStatus?.state === 'downloaded') {
      window.electronAPI.installUpdate();
      return;
    }
    setUpdateBusy(true);
    try {
      const next = updateStatus?.state === 'available'
        ? await window.electronAPI.downloadUpdate()
        : await window.electronAPI.checkForUpdates();
      setUpdateStatus(next);
    } finally {
      setUpdateBusy(false);
    }
  };

  const shortcut = (macOS: string, windows: string) => window.electronAPI?.platform === 'darwin' ? macOS : windows;
  const SHORTCUTS = [
    { key: shortcut('⌘⇧N', 'Ctrl+Shift+N'), desc: '새 시크릿 창 열기' },
    { key: shortcut('⌘T', 'Ctrl+T'), desc: '새 탭 열기' },
    { key: shortcut('⌘W', 'Ctrl+W'), desc: '현재 탭 닫기' },
    { key: shortcut('⌘⇧T', 'Ctrl+Shift+T'), desc: '최근 닫은 탭 다시 열기' },
    { key: shortcut('⌘R', 'Ctrl+R'), desc: '새로고침' },
    { key: shortcut('⌘⇧R', 'Ctrl+Shift+R'), desc: '캐시 비우고 새로고침' },
    { key: shortcut('⌘L', 'Ctrl+L'), desc: '주소창 포커스 및 전체 선택' },
    { key: shortcut('⌘F', 'Ctrl+F'), desc: '페이지 내 단어 찾기 (Find in Page)' },
    { key: shortcut('⌘[ / ⌘]', 'Ctrl+[ / Ctrl+]'), desc: '뒤로 가기 / 앞으로 가기' },
    { key: shortcut('⌘+ / ⌘-', 'Ctrl++ / Ctrl+-'), desc: '화면 배율 확대 / 축소' },
    { key: shortcut('⌘0', 'Ctrl+0'), desc: '화면 배율 100% 리셋' },
    { key: shortcut('⌘1 ~ ⌘8', 'Ctrl+1 ~ Ctrl+8'), desc: '1~8번째 탭으로 바로 이동' },
    { key: shortcut('⌘9', 'Ctrl+9'), desc: '마지막 탭으로 이동' },
    { key: shortcut('⌘\\', 'Ctrl+\\'), desc: '서랍 패널 (메모/다운로드) 토글' },
    { key: shortcut('⌥⌘I / F12', 'Alt+Ctrl+I / F12'), desc: 'Chrome 개발자 도구 (DevTools) 열기/닫기' },
    { key: shortcut('⌘,', 'Ctrl+,'), desc: '브라우저 설정 열기' },
  ];

  const currentSection = SECTION_ITEMS.find((item) => item.id === activeTab)!;
  const hasChanges = JSON.stringify(draftSettings) !== JSON.stringify(settings);

  return (
    <div className="null-settings-page" data-settings-page="true">
      <aside className="null-settings-sidebar">
        <div className="null-settings-brand" aria-label="NULL 설정">
          <NullLogo size={39} />
        </div>
        <nav className="null-settings-navigation" aria-label="설정 카테고리">
          {SECTION_GROUPS.map((group) => (
            <div className="null-settings-nav-group" key={group}>
              <div className="null-settings-nav-label">{group}</div>
              {SECTION_ITEMS.filter((item) => item.group === group).map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-settings-nav={item.id}
                    aria-current={activeTab === item.id ? 'page' : undefined}
                    onClick={() => { setActiveTab(item.id); onSectionChange(item.id); }}
                  >
                    <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="null-settings-sidebar-footer">
          <span className="null-settings-version-dot" />
          <span>NULL</span>
          {diagnostics && <span className="null-settings-version">{diagnostics.version}</span>}
        </div>
      </aside>

      <main className="null-settings-main" aria-label="브라우저 설정">
        <header className="null-settings-page-header">
          <div className="null-settings-page-header-inner">
            <div>
              <div className="null-settings-eyebrow">NULL / 설정</div>
              <h1 id="settings-page-heading">{currentSection.label}</h1>
              <p>{currentSection.description}</p>
            </div>
            <button type="button" className="null-settings-close" onClick={handleClosePage} aria-label="설정 탭 닫기" title="설정 탭 닫기">
              <X size={18} strokeWidth={1.6} />
            </button>
          </div>
        </header>
        <div className="null-settings-scroll" ref={contentRef}>
          <div className="null-settings-content">
              {activeTab === 'general' && (
                <section className="null-settings-section" data-settings-section="general" aria-labelledby="settings-page-heading">
                  {/* Default Browser Banner */}
                <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--chrome-bg)] flex flex-wrap items-center justify-between gap-3 max-[640px]:flex-col max-[640px]:items-stretch">
                  <div className="min-w-0 flex-1 space-y-1 pr-1">
                    <div className="font-semibold text-[var(--text-primary)]">기본 브라우저 설정</div>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {defaultCheckDone && isDefaultBrowser
                        ? 'NULL이 현재 운영체제의 기본 브라우저로 설정되어 있습니다.'
                        : '외부 링크 클릭 시 NULL 브라우저로 바로 열리도록 설정합니다.'}
                    </p>
                  </div>
                  {defaultCheckDone && isDefaultBrowser ? (
                    <div className="flex items-center gap-1.5 text-emerald-400 font-medium text-xs flex-shrink-0">
                      <Check className="w-4 h-4" />
                      기본 브라우저
                    </div>
                  ) : (
                    <button
                      onClick={handleMakeDefaultBrowser}
                      className="null-primary-button shrink-0 px-3.5 py-1.5 font-medium text-xs max-[640px]:self-start"
                    >
                      기본 브라우저로 설정
                    </button>
                  )}
                </div>

                {/* Startup Behavior */}
                <div className="space-y-2">
                  <label className="font-semibold text-[var(--text-primary)]">시작 페이지</label>
                  <div className="null-settings-startup-options" role="group" aria-label="시작 페이지 선택">
                    {([
                      ['newtab', 'NULL 새 탭 페이지 열기', '새 탭 화면에서 시작합니다.'],
                      ['restore', '이전 세션의 모든 탭 복원', '브라우저를 닫을 때 열려 있던 탭을 유지합니다.'],
                      ['specific', '지정한 페이지 열기', '입력한 주소를 시작 페이지로 사용합니다.'],
                    ] as const).map(([value, title, description]) => (
                      <button key={value} type="button" className="null-settings-startup-option"
                        onClick={() => updateDraft({ startupBehavior: value })}
                        aria-pressed={draftSettings.startupBehavior === value}>
                        <span className="null-settings-radio" aria-hidden="true" />
                        <span><strong>{title}</strong><small>{description}</small></span>
                      </button>
                    ))}
                  </div>
                  {draftSettings.startupBehavior === 'specific' && (
                    <textarea
                      value={(draftSettings.startupPages || []).join('\n')}
                      onChange={(e) => updateDraft({ startupPages: e.target.value.split('\n').map((url) => url.trim()).filter(Boolean).slice(0, 20) })}
                      placeholder="https://example.com"
                      rows={3}
                      className="w-full px-3 py-2 bg-[var(--chrome-bg)] border border-[var(--border-subtle)] focus:border-[var(--accent)] rounded-[var(--radius-md)] text-xs text-[var(--text-primary)] outline-none resize-y"
                    />
                  )}
                </div>


                </section>
              )}

              {activeTab === 'languages' && (
                <section className="null-settings-section" data-settings-section="languages" aria-labelledby="settings-page-heading">
                  <div className="space-y-3">
                  <div>
                    <div className="font-semibold text-[var(--text-primary)]">선호 언어</div>
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">위쪽 언어가 웹 요청과 맞춤법 검사에서 우선됩니다.</p>
                  </div>
                  <div className="space-y-1.5">
                    {draftSettings.preferredLanguages.map((language, index) => (
                      <div key={language} className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--chrome-bg)] px-3 py-2 text-xs">
                        <span className="min-w-0 flex-1 text-[var(--text-primary)]">{language === 'ko-KR' ? '한국어' : language === 'en-US' ? 'English' : language}</span>
                        <button type="button" disabled={index === 0} onClick={() => {
                          const next = [...draftSettings.preferredLanguages];
                          [next[index - 1], next[index]] = [next[index], next[index - 1]];
                          updateDraft({ preferredLanguages: next });
                        }} className="null-icon-button !h-6 !w-6 disabled:opacity-30" aria-label="위로 이동">↑</button>
                        <button type="button" disabled={index === draftSettings.preferredLanguages.length - 1} onClick={() => {
                          const next = [...draftSettings.preferredLanguages];
                          [next[index + 1], next[index]] = [next[index], next[index + 1]];
                          updateDraft({ preferredLanguages: next });
                        }} className="null-icon-button !h-6 !w-6 disabled:opacity-30" aria-label="아래로 이동">↓</button>
                        <button type="button" disabled={draftSettings.preferredLanguages.length <= 1} onClick={() => updateDraft({ preferredLanguages: draftSettings.preferredLanguages.filter((item) => item !== language) })} className="null-icon-button !h-6 !w-6 disabled:opacity-30" aria-label="언어 제거">×</button>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[['ko-KR', '한국어 추가'], ['en-US', 'English 추가']].filter(([code]) => !draftSettings.preferredLanguages.includes(code)).map(([code, label]) => (
                      <button key={code} type="button" onClick={() => updateDraft({ preferredLanguages: [...draftSettings.preferredLanguages, code] })} className="null-quiet-button px-2.5 py-1.5 text-xs">{label}</button>
                    ))}
                  </div>
                  <label className="flex items-center justify-between gap-3 text-xs text-[var(--text-secondary)]">
                    <span>맞춤법 검사 사용</span>
                    <ToggleSwitch checked={draftSettings.spellCheckEnabled} onCheckedChange={(checked) => updateDraft({ spellCheckEnabled: checked })} aria-label="맞춤법 검사 사용" />
                  </label>
                </div>


                </section>
              )}

              {activeTab === 'appearance' && (
                <section className="null-settings-section" data-settings-section="appearance" aria-labelledby="settings-page-heading">
                  <div className="space-y-3">
                    <div className="null-style-picker-heading"><span>브라우저 테마</span><small>다크 또는 화이트</small></div>
                    <div className="null-settings-theme-grid" role="group" aria-label="브라우저 테마">
                      {THEME_OPTIONS.map(theme => (
                        <button key={theme.id} type="button" className="null-theme-choice"
                          aria-label={theme.label + ' 테마'} aria-pressed={draftSettings.theme === theme.id}
                          data-theme-choice={theme.id} onClick={() => handleSelectTheme(theme.id)}>
                          <span className="null-settings-theme-preview" style={{ backgroundColor: theme.swatch, borderColor: theme.border }} aria-hidden="true">
                            <i style={{ backgroundColor: theme.border }} /><b style={{ backgroundColor: theme.border }} /><span style={{ backgroundColor: theme.border }} />
                          </span>
                          <span className="null-style-label"><strong>{theme.label}</strong><span className="null-choice-dot" data-selected={draftSettings.theme === theme.id} aria-hidden="true" /></span>
                          <small>{theme.desc}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="null-style-picker-group">
                    <div className="null-style-picker-heading"><span>인터페이스</span><small>선택하면 바로 미리볼 수 있습니다</small></div>
                    <div className="null-style-picker" role="group" aria-label="인터페이스 디자인">
                      {INTERFACE_STYLES.map(style => (
                        <button key={style.id} type="button" className="null-style-choice" data-style={style.id}
                          aria-label={style.label + ' 디자인'} aria-pressed={draftSettings.interfaceStyle === style.id}
                          onClick={() => { updateDraft({ interfaceStyle: style.id }); document.documentElement.setAttribute('data-interface-style', style.id); }}>
                          <span className="null-style-preview" aria-hidden="true"><i /><span className="preview-tabs"><b /><b /><b /></span><span className="preview-toolbar"><b /></span><span className="preview-page"><b /><i /></span></span>
                          <span className="null-style-label"><strong>{style.label}</strong><span className="null-choice-dot" data-selected={draftSettings.interfaceStyle === style.id} aria-hidden="true" /></span>
                          <small>{style.description}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="null-home-picker-group">
                    <div className="null-style-picker-heading"><span>검색 홈</span><small>탭 인터페이스와 따로 선택합니다</small></div>
                    <div className="null-home-picker" role="group" aria-label="검색 홈 디자인">
                      {HOME_STYLES.map(style => (
                        <button key={style.id} type="button" className="null-style-choice null-home-choice"
                          data-home-choice={style.id} aria-label={style.label + ' 검색 홈'}
                          aria-pressed={draftSettings.homeStyle === style.id}
                          onClick={() => updateDraft({ homeStyle: style.id })}>
                          <span className="null-home-preview" data-home-style={style.id} aria-hidden="true">
                            <span><NullLogo size={24} /><i><Search size={8} strokeWidth={1.7} /></i></span>
                          </span>
                          <span className="null-style-label"><strong>{style.label}</strong><span className="null-choice-dot" data-selected={draftSettings.homeStyle === style.id} aria-hidden="true" /></span>
                          <small>{style.description}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center justify-between cursor-pointer">
                      <span className="text-xs text-[var(--text-secondary)]">북마크 바 표시</span>
                      <ToggleSwitch checked={draftSettings.showBookmarkBar} onCheckedChange={checked => updateDraft({ showBookmarkBar: checked })} aria-label="북마크 바 표시" />
                    </label>
                    <p className="text-xs text-[var(--text-muted)] leading-relaxed">새 탭은 로고와 검색창만 표시합니다. 북마크와 방문 기록은 라이브러리에서 확인할 수 있습니다.</p>
                  </div>
                </section>
              )}

              {activeTab === 'downloads' && (
                <section className="null-settings-section" data-settings-section="downloads" aria-labelledby="settings-page-heading">
                  <div className="space-y-2 pt-2">
                  <div className="font-semibold text-[var(--text-primary)]">다운로드</div>
                  <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--chrome-bg)] space-y-2">
                  <div className="flex flex-wrap gap-2">
                      <input readOnly value={draftSettings.downloadPath || '기본 다운로드 폴더'} className="flex-1 min-w-[10rem] px-2.5 py-1.5 bg-[var(--chrome-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-xs text-[var(--text-secondary)]" />
                      <button type="button" onClick={async () => { const selected = await window.electronAPI?.chooseDownloadDirectory(); if (selected) updateDraft({ downloadPath: selected }); }} className="shrink-0 px-3 py-1.5 bg-[var(--chrome-surface)] hover:bg-[var(--chrome-surface-hover)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-xs text-[var(--text-primary)]">폴더 선택</button>
                    </div>
                    <label className="flex items-center justify-between cursor-pointer text-xs text-[var(--text-secondary)]">
                      <span>다운로드할 때마다 저장 위치 묻기</span>
                      <ToggleSwitch checked={draftSettings.askDownloadLocation} onCheckedChange={(checked) => updateDraft({ askDownloadLocation: checked })} aria-label="다운로드 저장 위치 묻기" />
                    </label>
                  </div>
                </div>
                </section>
              )}

              {activeTab === 'search' && (
                <section className="null-settings-section" data-settings-section="search" aria-labelledby="settings-page-heading">
                  <div className="space-y-2">
                  <label className="font-semibold text-[var(--text-primary)]">기본 검색 엔진</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                    {(['google', 'naver', 'duckduckgo', 'bing', 'brave', 'custom'] as SearchEngine[]).map((engine) => (
                      <button
                        key={engine}
                        onClick={() => updateDraft({ searchEngine: engine })}
                        aria-pressed={draftSettings.searchEngine === engine}
                        className={`min-w-0 w-full py-2 px-2 rounded-[var(--radius-md)] border text-center font-medium capitalize leading-tight whitespace-normal break-words transition-all ${
                          draftSettings.searchEngine === engine
                            ? 'bg-[var(--chrome-surface-active)] border-[var(--accent)] text-[var(--accent)]'
                            : 'bg-[var(--chrome-bg)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        {engine === 'naver'
                          ? 'Naver'
                          : engine === 'google'
                          ? 'Google'
                          : engine === 'duckduckgo'
                          ? 'DuckDuckGo'
                          : engine === 'brave'
                          ? 'Brave'
                          : engine === 'bing'
                          ? 'Bing'
                          : 'Custom'}
                      </button>
                    ))}
                  </div>
                  {draftSettings.searchEngine === 'custom' && (
                    <input
                      type="url"
                      value={draftSettings.customSearchUrl}
                      onChange={(e) => updateDraft({ customSearchUrl: e.target.value })}
                      placeholder="https://example.com/search?q=%s"
                      className="w-full px-3 py-2 bg-[var(--chrome-bg)] border border-[var(--border-subtle)] focus:border-[var(--accent)] rounded-[var(--radius-md)] text-xs text-[var(--text-primary)] outline-none"
                    />
                  )}
                </div>

                </section>
              )}

              {activeTab === 'privacy' && (
                <section className="null-settings-section" data-settings-section="privacy" aria-labelledby="settings-page-heading">
                  <div className="space-y-1 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--chrome-bg)]">
                  <label className="flex cursor-pointer items-center justify-between gap-4 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-[var(--text-primary)]">방문 기록 저장</span>
                      <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">끄면 이후 방문부터 기록하지 않으며 기존 기록은 유지됩니다.</span>
                    </span>
                    <ToggleSwitch checked={draftSettings.saveBrowsingHistory ?? true} onCheckedChange={(checked) => updateDraft({ saveBrowsingHistory: checked })} aria-label="방문 기록 저장" />
                  </label>
                  <div className="mx-3 border-t border-[var(--border-divider)]" />
                  <label className="flex cursor-pointer items-center justify-between gap-4 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-[var(--text-primary)]">검색 기록 저장</span>
                      <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">끄면 이후 검색부터 저장하지 않으며 기존 기록은 유지됩니다.</span>
                    </span>
                    <ToggleSwitch checked={draftSettings.saveSearchHistory ?? true} onCheckedChange={(checked) => updateDraft({ saveSearchHistory: checked })} aria-label="검색 기록 저장" />
                  </label>
                </div>

                {/* Clear Browsing Data */}
                <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--chrome-bg)] space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-[var(--text-primary)]">인터넷 사용 기록 삭제</div>
                    <select
                      value={clearOptions.timeRange}
                      onChange={(e) => setClearOptions({ ...clearOptions, timeRange: e.target.value as any })}
                      className="bg-[var(--chrome-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none"
                    >
                      <option value="hour">지난 1시간</option>
                      <option value="day">지난 24시간</option>
                      <option value="week">지난 7일</option>
                      <option value="all">전체 기간</option>
                    </select>
                  </div>

                  <div className="null-clear-data-choices text-xs text-[var(--text-secondary)]">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <ToggleSwitch
                        checked={clearOptions.history}
                        onCheckedChange={(checked) => setClearOptions({ ...clearOptions, history: checked })}
                      aria-label="삭제 항목: 방문 기록" />
                      <span>방문 기록</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <ToggleSwitch
                        checked={clearOptions.searchHistory}
                        onCheckedChange={(checked) => setClearOptions({ ...clearOptions, searchHistory: checked })}
                      aria-label="삭제 항목: 검색 기록" />
                      <span>검색 기록</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <ToggleSwitch
                        checked={clearOptions.downloads}
                        onCheckedChange={(checked) => setClearOptions({ ...clearOptions, downloads: checked })}
                      aria-label="삭제 항목: 다운로드 기록" />
                      <span>다운로드 기록</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <ToggleSwitch
                        checked={clearOptions.cookies}
                        onCheckedChange={(checked) => setClearOptions({ ...clearOptions, cookies: checked })}
                      aria-label="삭제 항목: 쿠키 및 사이트 데이터" />
                      <span>쿠키 및 사이트 데이터</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <ToggleSwitch
                        checked={clearOptions.cache}
                        onCheckedChange={(checked) => setClearOptions({ ...clearOptions, cache: checked })}
                      aria-label="삭제 항목: 캐시" />
                      <span>캐시된 이미지 및 파일</span>
                    </label>
                  </div>

                  <div className="pt-2 flex items-center justify-between">
                    {dataClearedToast ? (
                      <span className="text-emerald-400 flex items-center gap-1 text-xs">
                        <Check className="w-3.5 h-3.5" /> 삭제 완료됨
                      </span>
                    ) : (
                      <span />
                    )}
                    <button
                      onClick={handleExecuteClearData}
                      disabled={clearingData}
                      className="px-3 py-1.5 bg-rose-600/90 hover:bg-rose-600 text-white rounded-[var(--radius-md)] font-medium text-xs transition-colors"
                    >
                      {clearingData ? '삭제 중...' : '데이터 삭제'}
                    </button>
                  </div>
                </div>


                </section>
              )}

              {activeTab === 'sites' && (
                <section className="null-settings-section" data-settings-section="sites" aria-labelledby="settings-page-heading">
                  <SiteSettings settings={draftSettings} onUpdateSettings={updateDraft} onPermissionsChanged={onPermissionsChanged} initialOrigin={initialSiteOrigin} />
                </section>
              )}

              {activeTab === 'backup' && (
                <section className="null-settings-section" data-settings-section="backup" aria-labelledby="settings-page-heading">
                  {/* Import / Export */}
                <div className="space-y-3 pt-2">
                  <div className="font-semibold text-[var(--text-primary)]">북마크 및 설정 백업/복원</div>
                  {importStatus && (
                    <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs">
                      {importStatus}
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--chrome-bg)] space-y-2">
                      <div className="font-medium text-xs text-[var(--text-primary)]">북마크 (HTML 포맷)</div>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        표준 Netscape 북마크 HTML 파일로 내보내거나 타 브라우저에서 가져옵니다.
                      </p>
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={handleExportBookmarks}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-[var(--radius-md)] bg-[var(--chrome-surface)] hover:bg-[var(--chrome-surface-hover)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                        >
                          <Download className="w-3.5 h-3.5" />
                          내보내기
                        </button>
                        <button
                          onClick={handleImportBookmarks}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-[var(--radius-md)] bg-[var(--chrome-surface)] hover:bg-[var(--chrome-surface-hover)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          가져오기
                        </button>
                      </div>
                    </div>

                    <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--chrome-bg)] space-y-2">
                      <div className="font-medium text-xs text-[var(--text-primary)]">설정 백업 (JSON 포맷)</div>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        테마, 기본 검색 엔진, 새 탭 구성 등 환경설정을 파일로 백업합니다.
                      </p>
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={handleExportSettings}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-[var(--radius-md)] bg-[var(--chrome-surface)] hover:bg-[var(--chrome-surface-hover)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                        >
                          <Download className="w-3.5 h-3.5" />
                          내보내기
                        </button>
                        <button
                          onClick={handleImportSettings}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-[var(--radius-md)] bg-[var(--chrome-surface)] hover:bg-[var(--chrome-surface-hover)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          가져오기
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                </section>
              )}

              {activeTab === 'extensions' && (
                <section className="null-settings-section" data-settings-section="extensions" aria-labelledby="settings-page-heading">
                  <div className="space-y-4">
                <div>
                  <div className="font-semibold text-[var(--text-primary)]">확장 프로그램</div>
                  <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
                    Chrome 웹 스토어에서 확장 프로그램을 선택해 NULL에 바로 추가하세요.
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
                  <div className="min-w-0">
                    <div className="font-medium text-[var(--text-primary)]">Chrome 웹 스토어</div>
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">추가 버튼을 누르고 권한을 승인하면 바로 설치됩니다.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { window.electronAPI?.openExtensionStore(); onClose(); }}
                    disabled={!window.electronAPI || new URLSearchParams(window.location.search).get('incognito') === '1'}
                    className="null-primary-button shrink-0 px-3 py-1.5 text-[11px] disabled:opacity-50"
                  >
                    스토어 열기
                  </button>
                </div>

                <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--chrome-bg)] space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--text-primary)]">확장 프로그램 폴더 추가</div>
                      <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
                        개발 중인 확장 프로그램은 manifest.json이 들어 있는 폴더로 추가할 수 있습니다.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleInstallExtension}
                      disabled={extensionBusy || new URLSearchParams(window.location.search).get('incognito') === '1'}
                      className="null-primary-button shrink-0 px-3 py-1.5 text-[11px] disabled:opacity-50"
                    >
                      {extensionBusy ? '처리 중...' : '폴더 선택'}
                    </button>
                  </div>
                  <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                    확장 프로그램은 일반 창에서만 사용됩니다. 현재 비공개 창에는 확장 프로그램을 로드하지 않습니다.
                  </p>
                </div>

                <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                  설치된 확장 아이콘은 주소창 오른쪽에 표시됩니다. Chrome 전용 API나 별도 앱이 필요한 확장은 일부 기능이 제한될 수 있습니다.
                </p>

                {extensionError && (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
                    {extensionError}
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                    <span>설치된 확장 프로그램</span>
                    {extensionsLoading && <span>불러오는 중…</span>}
                  </div>
                  {!extensionsLoading && extensions.length === 0 && (
                    <div className="rounded-xl border border-dashed border-[var(--border-subtle)] px-3 py-5 text-center text-[11px] text-[var(--text-muted)]">
                      설치된 확장 프로그램이 없습니다.
                    </div>
                  )}
                  {extensions.map((extension) => (
                    <div
                      key={extension.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--chrome-bg)] p-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-[var(--text-primary)]">{extension.name}</div>
                        <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                          v{extension.version}{extension.manifestVersion ? ` · Manifest V${extension.manifestVersion}` : ''}
                          {extension.source === 'webstore' ? ' · Chrome 웹 스토어' : ' · 로컬 폴더'}
                        </div>
                        <div className="mt-1 truncate font-mono text-[10px] text-[var(--text-muted)]" title={extension.path}>
                          {extension.path}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleRemoveExtension(extension)}
                        disabled={extensionBusy}
                        className="shrink-0 rounded-[var(--radius-md)] border border-rose-500/20 px-2.5 py-1.5 text-[11px] text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
                      >
                        제거
                      </button>
                    </div>
                  ))}
                </div>
              </div>
                </section>
              )}

              {activeTab === 'shortcuts' && (
                <section className="null-settings-section" data-settings-section="shortcuts" aria-labelledby="settings-page-heading">
                  <div className="space-y-3">
                <div className="font-semibold text-[var(--text-primary)]">단축키 목록</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {SHORTCUTS.map((s) => (
                    <div
                      key={s.key}
                      className="flex items-center justify-between gap-2 min-w-0 p-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--chrome-bg)]"
                    >
                      <span className="min-w-0 text-[var(--text-secondary)] text-xs">{s.desc}</span>
                      <span className="shrink-0 font-mono text-[11px] bg-[var(--chrome-surface)] px-2 py-0.5 rounded text-[var(--accent)] border border-[var(--border-subtle)]">
                        {s.key}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
                </section>
              )}

              {activeTab === 'about' && (
                <section className="null-settings-section" data-settings-section="about" aria-labelledby="settings-page-heading">
                  <div className="space-y-4">
                  <div className="null-about-brand">
                  <div className="null-about-logo">
                    <NullLogo size={64} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] text-[var(--text-muted)] font-mono">Version {diagnostics?.version || '확인 중...'}</p>
                  </div>
                  </div>

                  <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--chrome-bg)] space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-[var(--text-primary)]">앱 업데이트</div>
                        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                          새 버전은 확인 후 다운로드하며, 설치는 재시작할 때 진행됩니다.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleUpdateAction}
                        disabled={updateBusy || updateStatus?.state === 'checking' || updateStatus?.state === 'downloading'}
                        className="null-primary-button shrink-0 px-3 py-1.5 text-[11px] disabled:opacity-50"
                      >
                        {updateStatus?.state === 'downloaded'
                          ? '지금 재시작'
                          : updateStatus?.state === 'available'
                            ? '업데이트 다운로드'
                            : updateStatus?.state === 'downloading'
                              ? `다운로드 ${updateStatus.percent ?? 0}%`
                              : updateStatus?.state === 'checking' || updateBusy
                                ? '확인 중...'
                                : '업데이트 확인'}
                      </button>
                    </div>
                    {updateStatus?.message && (
                      <div className={`text-[11px] ${updateStatus.state === 'error' ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`}>
                        {updateStatus.message}
                      </div>
                    )}
                  </div>

                {diagnostics && (
                  <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--chrome-bg)] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[var(--text-primary)]">런타임 진단 정보</span>
                      <button
                        onClick={handleCopyDiagnostics}
                        className="flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline"
                      >
                        {copiedDiag ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedDiag ? '복사됨' : '클립보드 복사'}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                      <div className="flex justify-between p-2 rounded bg-[var(--chrome-surface)] border border-[var(--border-subtle)]">
                        <span className="text-[var(--text-muted)]">Chromium:</span>
                        <span className="text-[var(--text-primary)]">{diagnostics.chromiumVersion}</span>
                      </div>
                      <div className="flex justify-between p-2 rounded bg-[var(--chrome-surface)] border border-[var(--border-subtle)]">
                        <span className="text-[var(--text-muted)]">Electron:</span>
                        <span className="text-[var(--text-primary)]">{diagnostics.electronVersion}</span>
                      </div>
                      <div className="flex justify-between p-2 rounded bg-[var(--chrome-surface)] border border-[var(--border-subtle)]">
                        <span className="text-[var(--text-muted)]">Node.js:</span>
                        <span className="text-[var(--text-primary)]">{diagnostics.nodeVersion}</span>
                      </div>
                      <div className="flex justify-between p-2 rounded bg-[var(--chrome-surface)] border border-[var(--border-subtle)]">
                        <span className="text-[var(--text-muted)]">Platform/Arch:</span>
                        <span className="text-[var(--text-primary)]">
                          {diagnostics.platform} ({diagnostics.arch})
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Reset Settings */}
                <div className="pt-2">
                  <button
                    onClick={async () => {
                      if (confirm('모든 브라우저 설정을 기본값으로 초기화하시겠습니까?')) {
                        if (window.electronAPI) {
                          const res = await window.electronAPI.resetSettings();
                          setDraftSettings(res);
                          onUpdateSettings(res);
                        }
                        if (onResetSettings) onResetSettings();
                      }
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-[var(--radius-md)] border border-rose-500/20 transition-colors text-xs"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    브라우저 설정 전체 초기화
                  </button>
                </div>
              </div>
                </section>
              )}
          </div>
        </div>
        <footer className="null-settings-savebar">
          <div className="null-settings-savebar-inner">
            <div role="status" aria-live="polite" className={saveState === 'error' ? 'null-settings-save-error' : ''}>
              {saveState === 'error' ? '저장하지 못했습니다. 다시 시도해 주세요.'
                : saveState === 'saving' ? '설정 저장 중…'
                  : hasChanges ? '저장하지 않은 변경사항이 있습니다. 탭을 떠나면 취소됩니다.'
                    : saveState === 'saved' ? '설정이 저장되었습니다.' : '변경사항이 없습니다.'}
              <small>변경 후 저장해 주세요. 데이터 관리 작업은 즉시 적용됩니다.</small>
            </div>
            <div className="null-settings-save-actions">
              <button type="button" className="null-settings-secondary" onClick={discardChanges} disabled={!hasChanges || saveState === 'saving'}>변경 취소</button>
              <button type="button" className="null-primary-button" onClick={() => void handleSave()} disabled={!hasChanges || saveState === 'saving'}>
                <Check size={14} /> 설정 저장
              </button>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
};
