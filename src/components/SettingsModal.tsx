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
  Plus,
  Wind,
  Copy,
  RotateCcw,
  Puzzle,
} from 'lucide-react';
import { BrowserSettings, SearchEngine, ClearDataOptions } from '../types/browser';
import { ACCENT_OPTIONS, getAccentForeground, getThemeOption, THEME_OPTIONS } from '../constants/appearance';
import type { InstalledExtension, UpdateStatus } from '../../electron/types';

interface SettingsModalProps {
  isOpen: boolean;
  settings: BrowserSettings;
  blockedCount: number;
  initialTab?: 'general' | 'search' | 'appearance' | 'privacy' | 'extensions' | 'shortcuts' | 'about';
  onClose: () => void;
  onUpdateSettings: (updates: Partial<BrowserSettings>) => void;
  onResetSettings?: () => void;
  onDataCleared?: (options: ClearDataOptions) => void;
  onBookmarksChanged?: () => void;
  onPermissionsChanged?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  settings,
  blockedCount,
  initialTab = 'general',
  onClose,
  onUpdateSettings,
  onResetSettings,
  onDataCleared,
  onBookmarksChanged,
  onPermissionsChanged,
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'search' | 'appearance' | 'privacy' | 'extensions' | 'shortcuts' | 'about'>(
    initialTab
  );

  // Draft settings state - changes are held here until user explicitly clicks [설정 저장]
  const [draftSettings, setDraftSettings] = useState<BrowserSettings>(settings);
  const prevIsOpenRef = useRef(false);
  const initialThemeRef = useRef(settings.theme);
  const initialAccentRef = useRef(settings.accentColor);

  // Default browser status
  const [isDefaultBrowser, setIsDefaultBrowser] = useState(false);
  const [defaultCheckDone, setDefaultCheckDone] = useState(false);

  // Shortcuts form state
  const [newKeyword, setNewKeyword] = useState('');
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');

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
  const [permissionEntries, setPermissionEntries] = useState<Record<string, Record<string, 'allow' | 'deny'>>>({});
  const [permissionSearch, setPermissionSearch] = useState('');
  const [permissionFilter, setPermissionFilter] = useState('all');
  const [siteData, setSiteData] = useState<Array<{ origin: string; hostname: string; cookieCount: number }>>([]);
  const [siteDataSearch, setSiteDataSearch] = useState('');
  const [siteDataError, setSiteDataError] = useState<string | null>(null);
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const [cookieExceptionDraft, setCookieExceptionDraft] = useState('');

  // Initialize draft and tab ONLY when modal opens (prevents tab-jumping on clicks)
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setDraftSettings(settings);
      initialThemeRef.current = settings.theme;
      initialAccentRef.current = settings.accentColor;
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

  const loadPrivacyData = async () => {
    if (!window.electronAPI) return;
    setPrivacyLoading(true);
    setSiteDataError(null);
    try {
      const [permissions, storedData] = await Promise.all([
        window.electronAPI.getAllSitePermissions(),
        window.electronAPI.listSiteData(),
      ]);
      setPermissionEntries(permissions || {});
      setSiteData(storedData || []);
    } finally {
      setPrivacyLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && activeTab === 'privacy') void loadPrivacyData();
  }, [isOpen, activeTab]);

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
    if (isOpen && activeTab === 'extensions') void loadExtensions();
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

  const setGlobalPermission = async (origin: string, permission: string, decision: 'allow' | 'deny' | 'default') => {
    if (!window.electronAPI) return;
    await window.electronAPI.setSitePermission(origin, permission, decision);
    await loadPrivacyData();
    onPermissionsChanged?.();
  };

  const resetOriginPermissions = async (origin: string) => {
    if (!window.electronAPI) return;
    await window.electronAPI.resetSitePermissions(origin);
    await loadPrivacyData();
    onPermissionsChanged?.();
  };

  const addCookieException = (decision: 'allow' | 'block') => {
    try {
      const origin = new URL(cookieExceptionDraft.trim()).origin;
      if (!/^https?:\/\//i.test(origin)) return;
      updateDraft({ cookieExceptions: { ...draftSettings.cookieExceptions, [origin]: decision } });
      setCookieExceptionDraft('');
    } catch {}
  };

  const applyAccentPreview = (color: string) => {
    const root = document.documentElement;
    root.style.setProperty('--accent', color);
    root.style.setProperty('--accent-subtle', `${color}20`);
    root.style.setProperty('--accent-border', `${color}40`);
    root.style.setProperty('--accent-foreground', getAccentForeground(color));
  };

  const handleCancelAndClose = () => {
    // Revert live preview
    document.documentElement.setAttribute('data-theme', initialThemeRef.current);
    applyAccentPreview(initialAccentRef.current);
    onClose();
  };

  // ESC key listener
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancelAndClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  const updateDraft = (updates: Partial<BrowserSettings>) => {
    setDraftSettings((prev) => ({ ...prev, ...updates }));
  };

  const handleSelectTheme = (themeId: BrowserSettings['theme']) => {
    const defaultAccent = getThemeOption(themeId)?.defaultAccent;
    updateDraft({ theme: themeId, ...(defaultAccent ? { accentColor: defaultAccent } : {}) });
    // Live preview on entire application
    document.documentElement.setAttribute('data-theme', themeId);
    if (defaultAccent) applyAccentPreview(defaultAccent);
  };

  const handleSelectAccent = (color: string) => {
    updateDraft({ accentColor: color });
    // Live preview on entire application
    applyAccentPreview(color);
  };

  const handleSaveAndClose = () => {
    onUpdateSettings(draftSettings);
    onClose();
  };

  const handleMakeDefaultBrowser = async () => {
    if (window.electronAPI) {
      const res = await window.electronAPI.makeDefaultBrowser();
      setIsDefaultBrowser(res);
    }
  };

  const handleAddShortcut = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyword.trim() || !newName.trim() || !newUrl.trim()) return;
    const currentShortcuts = draftSettings.searchShortcuts || [];
    const updated = [
      ...currentShortcuts.filter((s) => s.keyword !== newKeyword.trim()),
      { keyword: newKeyword.trim().toLowerCase(), name: newName.trim(), searchUrl: newUrl.trim() },
    ];
    updateDraft({ searchShortcuts: updated });
    setNewKeyword('');
    setNewName('');
    setNewUrl('');
  };

  const handleRemoveShortcut = (keyword: string) => {
    const currentShortcuts = draftSettings.searchShortcuts || [];
    updateDraft({ searchShortcuts: currentShortcuts.filter((s) => s.keyword !== keyword) });
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
    a.download = `aero_bookmarks_${new Date().toISOString().slice(0, 10)}.html`;
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
    a.download = `aero_settings_${new Date().toISOString().slice(0, 10)}.json`;
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
    { key: shortcut('⌘T', 'Ctrl+T'), desc: '새 탭 열기' },
    { key: shortcut('⌘W', 'Ctrl+W'), desc: '현재 탭 닫기' },
    { key: shortcut('⌘⇧T', 'Ctrl+Shift+T'), desc: '최근 닫은 탭 다시 열기' },
    { key: shortcut('⌘R', 'Ctrl+R'), desc: '새로고침' },
    { key: shortcut('⌘⇧R', 'Ctrl+Shift+R'), desc: '캐시 비우고 새로고침' },
    { key: shortcut('⌘L', 'Ctrl+L'), desc: '주소창 포커스 및 전체 선택' },
    { key: shortcut('⌘K', 'Ctrl+K'), desc: '커맨드 팔레트 열기' },
    { key: shortcut('⌘F', 'Ctrl+F'), desc: '페이지 내 단어 찾기 (Find in Page)' },
    { key: shortcut('⌘[ / ⌘]', 'Ctrl+[ / Ctrl+]'), desc: '뒤로 가기 / 앞으로 가기' },
    { key: shortcut('⌘+ / ⌘-', 'Ctrl++ / Ctrl+-'), desc: '화면 배율 확대 / 축소' },
    { key: shortcut('⌘0', 'Ctrl+0'), desc: '화면 배율 100% 리셋' },
    { key: shortcut('⌘1 ~ ⌘8', 'Ctrl+1 ~ Ctrl+8'), desc: '1~8번째 탭으로 바로 이동' },
    { key: shortcut('⌘9', 'Ctrl+9'), desc: '마지막 탭으로 이동' },
    { key: shortcut('⌘\\', 'Ctrl+\\'), desc: 'Aside 서랍 패널 (번역/메모/다운로드) 토글' },
    { key: shortcut('⌥⌘T', 'Alt+Ctrl+T'), desc: '현재 페이지 한국어로 즉시 번역 / 복원' },
    { key: shortcut('⌥⌘I / F12', 'Alt+Ctrl+I / F12'), desc: 'Chrome 개발자 도구 (DevTools) 열기/닫기' },
    { key: shortcut('⌘,', 'Ctrl+,'), desc: '브라우저 설정창 열기' },
  ];

  return (
    <div
      className="aero-overlay fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 select-none"
      onClick={handleCancelAndClose}
    >
      <div
        className="aero-modal aero-settings w-[min(100%,48rem)] max-w-[calc(100vw-2rem)] min-w-0 max-h-[calc(100dvh-2rem)] overflow-hidden flex flex-col text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="aero-panel-header flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-2">
            <Wind className="w-4 h-4 text-[var(--accent)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Aero 설정</h2>
          </div>
          <button
            onClick={handleCancelAndClose}
            className="aero-icon-button !h-7 !w-7"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body: Left Nav + Right Content */}
        <div className="flex flex-1 min-h-0 max-[640px]:min-h-0 overflow-hidden">
          {/* Left Navigation */}
          <nav className="aero-settings-nav w-48 max-[640px]:w-12 border-r border-[var(--border-subtle)] p-2 max-[640px]:p-1 space-y-0.5 flex-shrink-0">
            <button
              onClick={() => setActiveTab('general')}
              title="일반 설정"
              aria-label="일반 설정"
              data-active={activeTab === 'general'}
              className={`aero-settings-nav-item w-full flex items-center gap-2.5 px-3 py-2 max-[640px]:justify-center max-[640px]:px-2 text-left font-medium transition-colors ${
                activeTab === 'general'
                  ? 'bg-[var(--chrome-surface-active)] text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--chrome-surface-hover)]'
              }`}
            >
              <Wind className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="max-[640px]:hidden">일반 설정</span>
            </button>
            <button
              onClick={() => setActiveTab('search')}
              title="검색 및 단축어"
              aria-label="검색 및 단축어"
              data-active={activeTab === 'search'}
              className={`aero-settings-nav-item w-full flex items-center gap-2.5 px-3 py-2 max-[640px]:justify-center max-[640px]:px-2 text-left font-medium transition-colors ${
                activeTab === 'search'
                  ? 'bg-[var(--chrome-surface-active)] text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--chrome-surface-hover)]'
              }`}
            >
              <Search className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="max-[640px]:hidden">검색 및 단축어</span>
            </button>
            <button
              onClick={() => setActiveTab('appearance')}
              title="테마 및 새 탭"
              aria-label="테마 및 새 탭"
              data-active={activeTab === 'appearance'}
              className={`aero-settings-nav-item w-full flex items-center gap-2.5 px-3 py-2 max-[640px]:justify-center max-[640px]:px-2 text-left font-medium transition-colors ${
                activeTab === 'appearance'
                  ? 'bg-[var(--chrome-surface-active)] text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--chrome-surface-hover)]'
              }`}
            >
              <Palette className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="max-[640px]:hidden">테마 및 새 탭</span>
            </button>
            <button
              onClick={() => setActiveTab('privacy')}
              title="개인정보 및 백업"
              aria-label="개인정보 및 백업"
              data-active={activeTab === 'privacy'}
              className={`aero-settings-nav-item w-full flex items-center gap-2.5 px-3 py-2 max-[640px]:justify-center max-[640px]:px-2 text-left font-medium transition-colors ${
                activeTab === 'privacy'
                  ? 'bg-[var(--chrome-surface-active)] text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--chrome-surface-hover)]'
              }`}
            >
              <Shield className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="max-[640px]:hidden">개인정보 및 백업</span>
            </button>
            <button
              onClick={() => setActiveTab('extensions')}
              title="확장 프로그램"
              aria-label="확장 프로그램"
              data-active={activeTab === 'extensions'}
              className={`aero-settings-nav-item w-full flex items-center gap-2.5 px-3 py-2 max-[640px]:justify-center max-[640px]:px-2 text-left font-medium transition-colors ${
                activeTab === 'extensions'
                  ? 'bg-[var(--chrome-surface-active)] text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--chrome-surface-hover)]'
              }`}
            >
              <Puzzle className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="max-[640px]:hidden">확장 프로그램</span>
            </button>
            <button
              onClick={() => setActiveTab('shortcuts')}
              title="단축키 안내"
              aria-label="단축키 안내"
              data-active={activeTab === 'shortcuts'}
              className={`aero-settings-nav-item w-full flex items-center gap-2.5 px-3 py-2 max-[640px]:justify-center max-[640px]:px-2 text-left font-medium transition-colors ${
                activeTab === 'shortcuts'
                  ? 'bg-[var(--chrome-surface-active)] text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--chrome-surface-hover)]'
              }`}
            >
              <Keyboard className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="max-[640px]:hidden">단축키 안내</span>
            </button>
            <button
              onClick={() => setActiveTab('about')}
              title="정보 및 진단"
              aria-label="정보 및 진단"
              data-active={activeTab === 'about'}
              className={`aero-settings-nav-item w-full flex items-center gap-2.5 px-3 py-2 max-[640px]:justify-center max-[640px]:px-2 text-left font-medium transition-colors ${
                activeTab === 'about'
                  ? 'bg-[var(--chrome-surface-active)] text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--chrome-surface-hover)]'
              }`}
            >
              <Info className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="max-[640px]:hidden">정보 및 진단</span>
            </button>
          </nav>

          {/* Right Content Panel */}
          <div className="flex-1 min-w-0 min-h-0 p-5 max-[640px]:p-3 overflow-y-auto space-y-6">
            {/* 1. General Tab */}
            {activeTab === 'general' && (
              <>
                {/* Default Browser Banner */}
                <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--chrome-bg)] flex flex-wrap items-center justify-between gap-3 max-[640px]:flex-col max-[640px]:items-stretch">
                  <div className="min-w-0 flex-1 space-y-1 pr-1">
                    <div className="font-semibold text-[var(--text-primary)]">기본 브라우저 설정</div>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {defaultCheckDone && isDefaultBrowser
                        ? 'Aero가 현재 운영체제의 기본 브라우저로 설정되어 있습니다.'
                        : '외부 링크 클릭 시 Aero 브라우저로 바로 열리도록 설정합니다.'}
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
                      className="aero-primary-button shrink-0 px-3.5 py-1.5 font-medium text-xs max-[640px]:self-start"
                    >
                      기본 브라우저로 설정
                    </button>
                  )}
                </div>

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
                        }} className="aero-icon-button !h-6 !w-6 disabled:opacity-30" aria-label="위로 이동">↑</button>
                        <button type="button" disabled={index === draftSettings.preferredLanguages.length - 1} onClick={() => {
                          const next = [...draftSettings.preferredLanguages];
                          [next[index + 1], next[index]] = [next[index], next[index + 1]];
                          updateDraft({ preferredLanguages: next });
                        }} className="aero-icon-button !h-6 !w-6 disabled:opacity-30" aria-label="아래로 이동">↓</button>
                        <button type="button" disabled={draftSettings.preferredLanguages.length <= 1} onClick={() => updateDraft({ preferredLanguages: draftSettings.preferredLanguages.filter((item) => item !== language) })} className="aero-icon-button !h-6 !w-6 disabled:opacity-30" aria-label="언어 제거">×</button>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[['ko-KR', '한국어 추가'], ['en-US', 'English 추가']].filter(([code]) => !draftSettings.preferredLanguages.includes(code)).map(([code, label]) => (
                      <button key={code} type="button" onClick={() => updateDraft({ preferredLanguages: [...draftSettings.preferredLanguages, code] })} className="aero-quiet-button px-2.5 py-1.5 text-xs">{label}</button>
                    ))}
                  </div>
                  <label className="flex items-center justify-between gap-3 text-xs text-[var(--text-secondary)]">
                    <span>맞춤법 검사 사용</span>
                    <input type="checkbox" checked={draftSettings.spellCheckEnabled} onChange={(event) => updateDraft({ spellCheckEnabled: event.target.checked })} className="h-4 w-4 accent-[var(--accent)]" />
                  </label>
                </div>

                {/* Startup Behavior */}
                <div className="space-y-2">
                  <label className="font-semibold text-[var(--text-primary)]">시작 시 열기 (Startup)</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button
                      onClick={() => updateDraft({ startupBehavior: 'newtab' })}
                      className={`min-w-0 p-3 rounded-xl border text-left transition-colors ${
                        draftSettings.startupBehavior === 'newtab'
                          ? 'bg-[var(--chrome-surface-active)] border-[var(--accent)] text-[var(--text-primary)]'
                          : 'bg-[var(--chrome-bg)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <div className="font-medium text-xs break-keep">Aero New Tab 페이지 열기</div>
                      <div className="text-[11px] text-[var(--text-muted)] mt-1 break-keep">미니멀 검색창과 즐겨찾기 표시</div>
                    </button>
                    <button
                      onClick={() => updateDraft({ startupBehavior: 'restore' })}
                      className={`min-w-0 p-3 rounded-xl border text-left transition-colors ${
                        draftSettings.startupBehavior === 'restore'
                          ? 'bg-[var(--chrome-surface-active)] border-[var(--accent)] text-[var(--text-primary)]'
                          : 'bg-[var(--chrome-bg)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <div className="font-medium text-xs break-keep">이전 세션의 모든 탭 복원</div>
                      <div className="text-[11px] text-[var(--text-muted)] mt-1 break-keep">브라우저를 닫을 당시 열려있던 탭 유지</div>
                    </button>
                    <button
                      onClick={() => updateDraft({ startupBehavior: 'specific' })}
                      className={`min-w-0 p-3 rounded-xl border text-left transition-colors ${
                        draftSettings.startupBehavior === 'specific'
                          ? 'bg-[var(--chrome-surface-active)] border-[var(--accent)] text-[var(--text-primary)]'
                          : 'bg-[var(--chrome-bg)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <div className="font-medium text-xs break-keep">지정한 페이지 열기</div>
                      <div className="text-[11px] text-[var(--text-muted)] mt-1 break-keep">아래에 주소를 한 줄씩 입력</div>
                    </button>
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

                {/* Host-based Shield */}
                <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--chrome-bg)] flex flex-wrap items-center justify-between gap-3 max-[640px]:flex-col max-[640px]:items-stretch">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                      <Shield className="w-4 h-4 text-emerald-400" />
                      호스트 기반 실드 (Host-based Shield)
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      설정된 광고·추적 호스트 목록의 요청을 차단합니다. 전체 광고 차단 목록(EasyList)은 포함되지 않습니다.
                    </p>
                    <span className="inline-block text-[11px] text-emerald-400 font-mono mt-0.5">
                      차단된 요청 수: {blockedCount}개
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={draftSettings.adBlockEnabled}
                    onChange={(e) => updateDraft({ adBlockEnabled: e.target.checked })}
                    className="w-4 h-4 accent-[var(--accent)] cursor-pointer"
                  />
                </div>
              </>
            )}

            {/* 2. Search & Shortcuts Tab */}
            {activeTab === 'search' && (
              <>
                <div className="space-y-2">
                  <label className="font-semibold text-[var(--text-primary)]">기본 검색 엔진</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                    {(['google', 'naver', 'duckduckgo', 'bing', 'brave', 'custom'] as SearchEngine[]).map((engine) => (
                      <button
                        key={engine}
                        onClick={() => updateDraft({ searchEngine: engine })}
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

                {/* Search Shortcuts Manager */}
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-[var(--text-primary)]">검색 단축어 (Search Shortcuts)</div>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        주소창 또는 새 탭에서 키워드와 띄어쓰기를 입력하여 즉시 검색합니다. (예: `g 검색어`, `gh react`)
                      </p>
                    </div>
                  </div>

                  {/* Shortcuts List */}
                  <div className="border border-[var(--border-subtle)] rounded-xl overflow-x-auto bg-[var(--chrome-bg)]">
                    <table className="w-full min-w-[34rem] text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)] uppercase tracking-wider bg-[var(--chrome-surface)]">
                          <th className="px-3 py-2 font-medium">키워드</th>
                          <th className="px-3 py-2 font-medium">서비스 이름</th>
                          <th className="px-3 py-2 font-medium">검색 URL</th>
                          <th className="px-2 py-2 text-right">삭제</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-subtle)]">
                        {(draftSettings.searchShortcuts || []).map((s) => (
                          <tr key={s.keyword} className="hover:bg-[var(--chrome-surface-hover)]">
                            <td className="px-3 py-2 font-mono font-semibold text-[var(--accent)]">{s.keyword}</td>
                            <td className="px-3 py-2 text-[var(--text-primary)] font-medium">{s.name}</td>
                            <td className="px-3 py-2 font-mono text-[11px] text-[var(--text-muted)] truncate max-w-[200px]">
                              {s.searchUrl}
                            </td>
                            <td className="px-2 py-2 text-right">
                              <button
                                onClick={() => handleRemoveShortcut(s.keyword)}
                                className="p-1 text-[var(--text-muted)] hover:text-[var(--danger)] rounded transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Add Shortcut Form */}
                  <form onSubmit={handleAddShortcut} className="grid grid-cols-2 gap-2 pt-1">
                    <input
                      type="text"
                      placeholder="키워드"
                      value={newKeyword}
                      onChange={(e) => setNewKeyword(e.target.value)}
                      className="w-full min-w-0 px-2.5 py-1.5 bg-[var(--chrome-bg)] border border-[var(--border-subtle)] focus:border-[var(--accent)] rounded-[var(--radius-md)] text-xs text-[var(--text-primary)] outline-none"
                    />
                    <input
                      type="text"
                      placeholder="이름"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="w-full min-w-0 px-2.5 py-1.5 bg-[var(--chrome-bg)] border border-[var(--border-subtle)] focus:border-[var(--accent)] rounded-[var(--radius-md)] text-xs text-[var(--text-primary)] outline-none"
                    />
                    <input
                      type="text"
                      placeholder="검색 URL (%s 포함)"
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                      className="col-span-2 w-full min-w-0 px-2.5 py-1.5 bg-[var(--chrome-bg)] border border-[var(--border-subtle)] focus:border-[var(--accent)] rounded-[var(--radius-md)] text-xs text-[var(--text-primary)] outline-none"
                    />
                    <button
                      type="submit"
                      className="aero-primary-button col-span-2 gap-1 px-3 py-1.5 font-medium text-xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      추가
                    </button>
                  </form>
                </div>
              </>
            )}

            {/* 3. Appearance & New Tab */}
            {activeTab === 'appearance' && (
              <>
                {/* Theme Mode */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-[var(--text-primary)]">테마 (Theme)</label>
                    <span className="text-[10px] text-[var(--text-muted)] max-[640px]:hidden">클릭 시 즉시 실시간 미리보기 적용</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                    {THEME_OPTIONS.map((t) => {
                      const isSelected = draftSettings.theme === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => handleSelectTheme(t.id)}
                          className={`min-w-0 w-full p-2.5 rounded-xl border text-left flex flex-col justify-between gap-2 transition-all ${
                            isSelected
                              ? 'bg-[var(--chrome-surface-active)] border-[var(--accent)] ring-1 ring-[var(--accent)] shadow-sm'
                              : 'bg-[var(--chrome-bg)] border-[var(--border-subtle)] hover:border-[var(--border-active)] hover:bg-[var(--chrome-surface-hover)]'
                          }`}
                        >
                          <div className="flex items-center justify-between w-full min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className="w-3.5 h-3.5 rounded-full border border-white/20 shadow-xs flex-shrink-0"
                                style={{ backgroundColor: t.swatch, borderColor: t.border }}
                              />
                              <span className={`min-w-0 truncate font-medium text-xs ${isSelected ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>
                                {t.label}
                              </span>
                            </div>
                            {isSelected && <Check className="w-3.5 h-3.5 text-[var(--accent)]" />}
                          </div>
                          <span className="text-[10px] text-[var(--text-muted)] truncate">{t.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Accent Color */}
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-[var(--text-primary)]">액센트 컬러 (Accent Color)</label>
                    <span className="text-[10px] text-[var(--text-muted)] max-[640px]:hidden">버튼, 활성 탭, 인디케이터 강조색</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {ACCENT_OPTIONS.map((a) => (
                      <button
                        key={a.color}
                        type="button"
                        onClick={() => handleSelectAccent(a.color)}
                        style={{ backgroundColor: a.color }}
                        title={a.label}
                        className={`w-7 h-7 rounded-full flex items-center justify-center transition-transform ${
                          draftSettings.accentColor === a.color
                            ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-[var(--chrome-surface)]'
                            : 'opacity-75 hover:opacity-100'
                        }`}
                      >
                        {draftSettings.accentColor === a.color && <Check className="w-3.5 h-3.5 text-[var(--accent-foreground)]" />}
                      </button>
                    ))}
                  </div>
                </div>

                {/* New Tab Configuration */}
                <div className="space-y-3 pt-2">
                  <div className="font-semibold text-[var(--text-primary)]">Aero New Tab 페이지 설정</div>
                  <div className="space-y-2 border border-[var(--border-subtle)] rounded-xl p-3 bg-[var(--chrome-bg)]">
                    <label className="flex items-center justify-between cursor-pointer py-1">
                      <span className="text-xs text-[var(--text-secondary)]">즐겨찾기 타일 그리드 표시</span>
                      <input
                        type="checkbox"
                        checked={draftSettings.newTabConfig?.showFavorites ?? true}
                        onChange={(e) =>
                          updateDraft({
                            newTabConfig: { ...draftSettings.newTabConfig, showFavorites: e.target.checked },
                          })
                        }
                        className="w-4 h-4 accent-[var(--accent)]"
                      />
                    </label>
                    <label className="flex items-center justify-between cursor-pointer py-1 border-t border-[var(--border-subtle)]">
                      <span className="text-xs text-[var(--text-secondary)]">최근 방문 사이트 목록 표시</span>
                      <input
                        type="checkbox"
                        checked={draftSettings.newTabConfig?.showRecentSites ?? true}
                        onChange={(e) =>
                          updateDraft({
                            newTabConfig: { ...draftSettings.newTabConfig, showRecentSites: e.target.checked },
                          })
                        }
                        className="w-4 h-4 accent-[var(--accent)]"
                      />
                    </label>
                    <label className="flex items-center justify-between cursor-pointer py-1 border-t border-[var(--border-subtle)]">
                      <span className="text-xs text-[var(--text-secondary)]">Aero 로고 표시</span>
                      <input
                        type="checkbox"
                        checked={draftSettings.newTabConfig?.showLogo ?? true}
                        onChange={(e) =>
                          updateDraft({
                            newTabConfig: { ...draftSettings.newTabConfig, showLogo: e.target.checked },
                          })
                        }
                        className="w-4 h-4 accent-[var(--accent)]"
                      />
                    </label>
                    <label className="flex items-center justify-between cursor-pointer py-1 border-t border-[var(--border-subtle)]">
                      <span className="text-xs text-[var(--text-secondary)]">새 탭 타일 간격 줄이기</span>
                      <input
                        type="checkbox"
                        checked={draftSettings.newTabConfig?.compactMode ?? false}
                        onChange={(e) => updateDraft({ newTabConfig: { ...draftSettings.newTabConfig, compactMode: e.target.checked } })}
                        className="w-4 h-4 accent-[var(--accent)]"
                      />
                    </label>
                    <label className="flex items-center justify-between cursor-pointer py-1 border-t border-[var(--border-subtle)]">
                      <span className="text-xs text-[var(--text-secondary)]">북마크 바 표시</span>
                      <input
                        type="checkbox"
                        checked={draftSettings.showBookmarkBar ?? false}
                        onChange={(e) => updateDraft({ showBookmarkBar: e.target.checked })}
                        className="w-4 h-4 accent-[var(--accent)]"
                      />
                    </label>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <div className="font-semibold text-[var(--text-primary)]">다운로드</div>
                  <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--chrome-bg)] space-y-2">
                  <div className="flex flex-wrap gap-2">
                      <input readOnly value={draftSettings.downloadPath || '기본 다운로드 폴더'} className="flex-1 min-w-[10rem] px-2.5 py-1.5 bg-[var(--chrome-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-xs text-[var(--text-secondary)]" />
                      <button type="button" onClick={async () => { const selected = await window.electronAPI?.chooseDownloadDirectory(); if (selected) updateDraft({ downloadPath: selected }); }} className="shrink-0 px-3 py-1.5 bg-[var(--chrome-surface)] hover:bg-[var(--chrome-surface-hover)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-xs text-[var(--text-primary)]">폴더 선택</button>
                    </div>
                    <label className="flex items-center justify-between cursor-pointer text-xs text-[var(--text-secondary)]">
                      <span>다운로드할 때마다 저장 위치 묻기</span>
                      <input type="checkbox" checked={draftSettings.askDownloadLocation} onChange={(e) => updateDraft({ askDownloadLocation: e.target.checked })} className="w-4 h-4 accent-[var(--accent)]" />
                    </label>
                  </div>
                </div>
              </>
            )}

            {/* 4. Privacy & Backup */}
            {activeTab === 'privacy' && (
              <>
                <div className="space-y-1 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--chrome-bg)]">
                  <label className="flex cursor-pointer items-center justify-between gap-4 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-[var(--text-primary)]">방문 기록 저장</span>
                      <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">끄면 이후 방문부터 기록하지 않으며 기존 기록은 유지됩니다.</span>
                    </span>
                    <input type="checkbox" checked={draftSettings.saveBrowsingHistory ?? true} onChange={(event) => updateDraft({ saveBrowsingHistory: event.target.checked })} className="h-4 w-4 shrink-0 accent-[var(--accent)]" />
                  </label>
                  <div className="mx-3 border-t border-[var(--border-divider)]" />
                  <label className="flex cursor-pointer items-center justify-between gap-4 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-[var(--text-primary)]">검색 기록 저장</span>
                      <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">끄면 이후 검색부터 기록·추천하지 않으며 기존 기록은 유지됩니다.</span>
                    </span>
                    <input type="checkbox" checked={draftSettings.saveSearchHistory ?? true} onChange={(event) => updateDraft({ saveSearchHistory: event.target.checked })} className="h-4 w-4 shrink-0 accent-[var(--accent)]" />
                  </label>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div><div className="font-semibold text-[var(--text-primary)]">사이트 권한</div><p className="mt-1 text-[11px] text-[var(--text-muted)]">사이트 정보와 같은 실제 권한 저장소를 사용합니다.</p></div>
                    {privacyLoading && <span className="text-[11px] text-[var(--text-muted)]">불러오는 중…</span>}
                  </div>
                  <div className="flex gap-2">
                    <input value={permissionSearch} onChange={(event) => setPermissionSearch(event.target.value)} placeholder="사이트 검색" className="aero-field h-8 min-w-0 flex-1 px-3 text-xs outline-none" />
                    <select value={permissionFilter} onChange={(event) => setPermissionFilter(event.target.value)} className="aero-field h-8 px-2 text-xs outline-none">
                      <option value="all">모든 권한</option><option value="notifications">알림</option><option value="geolocation">위치</option><option value="media">카메라 및 마이크</option>
                    </select>
                  </div>
                  <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                    {Object.entries(permissionEntries).filter(([origin, decisions]) => (
                      origin.toLowerCase().includes(permissionSearch.trim().toLowerCase()) && (permissionFilter === 'all' || permissionFilter in decisions)
                    )).map(([origin, decisions]) => (
                      <div key={origin} className="rounded-[var(--radius-md)] bg-[var(--chrome-bg)] p-3">
                        <div className="mb-2 flex items-center justify-between gap-2"><span className="min-w-0 truncate text-xs text-[var(--text-primary)]">{origin}</span><button type="button" onClick={() => void resetOriginPermissions(origin)} className="text-[11px] text-[var(--text-muted)] hover:text-rose-400">모두 초기화</button></div>
                        <div className="space-y-1.5">
                          {Object.entries(decisions).filter(([permission]) => permissionFilter === 'all' || permission === permissionFilter).map(([permission, decision]) => (
                            <div key={permission} className="flex items-center gap-2 text-[11px]"><span className="min-w-0 flex-1 text-[var(--text-secondary)]">{permission === 'notifications' ? '알림' : permission === 'geolocation' ? '위치' : permission === 'media' ? '카메라 및 마이크' : permission}</span><select value={decision} onChange={(event) => void setGlobalPermission(origin, permission, event.target.value as 'allow' | 'deny' | 'default')} className="aero-field h-7 px-2 text-[11px] outline-none"><option value="allow">허용</option><option value="deny">차단</option><option value="default">묻기</option></select></div>
                          ))}
                        </div>
                      </div>
                    ))}
                    {!privacyLoading && Object.keys(permissionEntries).length === 0 && <div className="py-4 text-center text-[11px] text-[var(--text-muted)]">저장된 사이트 권한이 없습니다.</div>}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="font-semibold text-[var(--text-primary)]">쿠키</div>
                  <select value={draftSettings.cookiePolicy} onChange={(event) => updateDraft({ cookiePolicy: event.target.value as BrowserSettings['cookiePolicy'] })} className="aero-field h-9 w-full px-3 text-xs outline-none">
                    <option value="allow">쿠키 허용</option><option value="block-third-party">서드파티 쿠키 차단</option>
                  </select>
                  <p className="text-[11px] text-[var(--text-muted)]">서드파티 판정은 요청 사이트와 현재 최상위 사이트의 도메인을 비교합니다.</p>
                  <div className="flex flex-wrap gap-2">
                    <input value={cookieExceptionDraft} onChange={(event) => setCookieExceptionDraft(event.target.value)} placeholder="https://example.com" className="aero-field h-8 min-w-[12rem] flex-1 px-3 text-xs outline-none" />
                    <button type="button" onClick={() => addCookieException('allow')} className="aero-quiet-button px-2.5 py-1.5 text-xs">항상 허용</button>
                    <button type="button" onClick={() => addCookieException('block')} className="aero-quiet-button px-2.5 py-1.5 text-xs">항상 차단</button>
                  </div>
                  <div className="space-y-1">
                    {Object.entries(draftSettings.cookieExceptions).map(([origin, decision]) => <div key={origin} className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--chrome-bg)] px-3 py-2 text-[11px]"><span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">{origin}</span><span className="text-[var(--text-muted)]">{decision === 'allow' ? '허용' : '차단'}</span><button type="button" onClick={() => { const next = { ...draftSettings.cookieExceptions }; delete next[origin]; updateDraft({ cookieExceptions: next }); }} className="text-[var(--text-muted)] hover:text-rose-400">×</button></div>)}
                  </div>
                </div>

                <div className="space-y-3">
                  <div><div className="font-semibold text-[var(--text-primary)]">사이트 데이터</div><p className="mt-1 text-[11px] text-[var(--text-muted)]">쿠키가 확인된 출처입니다. 쿠키 값은 표시하지 않습니다.</p></div>
                  <input value={siteDataSearch} onChange={(event) => setSiteDataSearch(event.target.value)} placeholder="사이트 검색" className="aero-field h-8 w-full px-3 text-xs outline-none" />
                  <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                    {siteData.filter((item) => `${item.hostname} ${item.origin}`.toLowerCase().includes(siteDataSearch.trim().toLowerCase())).map((item) => <div key={item.origin} className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--chrome-bg)] px-3 py-2 text-[11px]"><div className="min-w-0 flex-1"><div className="truncate text-[var(--text-primary)]">{item.hostname}</div><div className="truncate text-[var(--text-muted)]">{item.origin} · 쿠키 {item.cookieCount}개</div></div><button type="button" onClick={async () => { setSiteDataError(null); const didClear = await window.electronAPI?.clearSiteData(item.origin); if (didClear) await loadPrivacyData(); else setSiteDataError(`${item.hostname} 데이터를 삭제하지 못했습니다.`); }} className="text-[var(--text-muted)] hover:text-rose-400">삭제</button></div>)}
                    {!privacyLoading && siteData.length === 0 && <div className="py-4 text-center text-[11px] text-[var(--text-muted)]">확인된 사이트 데이터가 없습니다.</div>}
                  </div>
                  {siteDataError && <p className="text-[11px] text-rose-400">{siteDataError}</p>}
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

                  <div className="grid grid-cols-2 gap-2 text-xs text-[var(--text-secondary)]">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={clearOptions.history}
                        onChange={(e) => setClearOptions({ ...clearOptions, history: e.target.checked })}
                        className="w-4 h-4 accent-[var(--accent)]"
                      />
                      <span>방문 기록</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={clearOptions.searchHistory}
                        onChange={(e) => setClearOptions({ ...clearOptions, searchHistory: e.target.checked })}
                        className="w-4 h-4 accent-[var(--accent)]"
                      />
                      <span>검색 기록</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={clearOptions.downloads}
                        onChange={(e) => setClearOptions({ ...clearOptions, downloads: e.target.checked })}
                        className="w-4 h-4 accent-[var(--accent)]"
                      />
                      <span>다운로드 기록</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={clearOptions.cookies}
                        onChange={(e) => setClearOptions({ ...clearOptions, cookies: e.target.checked })}
                        className="w-4 h-4 accent-[var(--accent)]"
                      />
                      <span>쿠키 및 사이트 데이터</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={clearOptions.cache}
                        onChange={(e) => setClearOptions({ ...clearOptions, cache: e.target.checked })}
                        className="w-4 h-4 accent-[var(--accent)]"
                      />
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
                        테마, 검색 단축어, 새 탭 구성 등 모든 환경설정을 안전하게 백업합니다.
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
              </>
            )}

            {/* 5. Extensions Tab */}
            {activeTab === 'extensions' && (
              <div className="space-y-4">
                <div>
                  <div className="font-semibold text-[var(--text-primary)]">확장 프로그램</div>
                  <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
                    압축 해제된 Chrome 확장 프로그램 폴더를 설치합니다. 폴더 안에 manifest.json이 있어야 합니다.
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--chrome-bg)] space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--text-primary)]">확장 프로그램 폴더 추가</div>
                      <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
                        Chrome 웹 스토어의 .crx 파일은 직접 설치할 수 없습니다. 파일을 내려받아 압축을 푼 폴더를 선택하세요.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleInstallExtension}
                      disabled={extensionBusy}
                      className="aero-primary-button shrink-0 px-3 py-1.5 text-[11px] disabled:opacity-50"
                    >
                      {extensionBusy ? '처리 중...' : '폴더 선택'}
                    </button>
                  </div>
                  <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                    확장 프로그램은 일반 창에서만 사용됩니다. 현재 비공개 창에는 확장 프로그램을 로드하지 않습니다.
                  </p>
                </div>

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
            )}

            {/* 5. Shortcuts Tab */}
            {activeTab === 'shortcuts' && (
              <div className="space-y-3">
                <div className="font-semibold text-[var(--text-primary)]">키보드 단축키 안내</div>
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
            )}

            {/* 6. About & Diagnostics Tab */}
            {activeTab === 'about' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 min-w-0 p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--chrome-bg)]">
                  <div className="w-10 h-10 rounded-xl bg-[var(--accent-subtle)] border border-[var(--accent-border)] flex items-center justify-center text-[var(--accent)] flex-shrink-0">
                    <Wind className="w-6 h-6" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-sm text-[var(--text-primary)]">Aero Browser</h3>
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
                        className="aero-primary-button shrink-0 px-3 py-1.5 text-[11px] disabled:opacity-50"
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
            )}
          </div>
        </div>

        {/* Modal Footer: Save & Cancel Buttons */}
        <div className="flex items-center justify-between gap-3 px-6 py-3.5 max-[640px]:px-3 max-[640px]:flex-col max-[640px]:items-stretch border-t border-[var(--border-subtle)] bg-[var(--chrome-bg)]">
          <span className="min-w-0 text-[11px] text-[var(--text-muted)]">
            대부분의 설정은 [설정 저장]을 눌러 적용됩니다. 데이터 가져오기/초기화는 즉시 반영됩니다.
          </span>
          <div className="flex items-center justify-end gap-2 shrink-0">
            <button
              onClick={handleCancelAndClose}
              className="px-4 py-2 rounded-[var(--radius-md)] bg-[var(--chrome-surface)] hover:bg-[var(--chrome-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-medium text-xs transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleSaveAndClose}
              className="aero-primary-button px-4 py-2 font-medium text-xs shadow-sm gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              설정 저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
