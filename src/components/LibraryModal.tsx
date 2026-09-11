import React, { useEffect, useMemo, useState } from 'react';
import {
  Bookmark as BookmarkIcon,
  Check,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Pencil,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Bookmark as BookmarkItem, DownloadItem, HistoryEntry, SearchHistoryItem } from '../types/browser';

type LibraryTab = 'bookmarks' | 'history' | 'searches' | 'downloads';

interface LibraryModalProps {
  isOpen: boolean;
  bookmarks: BookmarkItem[];
  history: HistoryEntry[];
  searchHistory: SearchHistoryItem[];
  downloads: DownloadItem[];
  onClose: () => void;
  onNavigate: (url: string) => void;
  onOpenNewTab: (url: string) => void;
  onCopyText: (value: string) => void;
  onUpdateBookmark: (id: string, updates: { title: string; url: string }) => void;
  onRemoveBookmark: (id: string) => void;
  onRemoveHistory: (id: string) => void;
  onClearHistory: () => void;
  onRemoveSearchHistory: (id: string) => void;
  onClearSearchHistory: () => void;
  onSearchAgain: (query: string) => void;
  onOpenDownload: (id: string) => void;
  onShowDownloadInFinder: (id: string) => void;
  onCancelDownload: (id: string) => void;
  onRemoveDownload: (id: string) => void;
}

export const LibraryModal: React.FC<LibraryModalProps> = ({
  isOpen, bookmarks, history, searchHistory, downloads, onClose, onNavigate, onOpenNewTab, onCopyText,
  onUpdateBookmark, onRemoveBookmark, onRemoveHistory, onClearHistory, onRemoveSearchHistory,
  onClearSearchHistory, onSearchAgain, onOpenDownload, onShowDownloadInFinder, onCancelDownload, onRemoveDownload,
}) => {
  const [activeTab, setActiveTab] = useState<LibraryTab>('bookmarks');
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredBookmarks = useMemo(() => bookmarks.filter((item) => `${item.title} ${item.url}`.toLocaleLowerCase().includes(normalizedQuery)).slice(0, 500), [bookmarks, normalizedQuery]);
  const filteredHistory = useMemo(() => history.filter((item) => `${item.title} ${item.url}`.toLocaleLowerCase().includes(normalizedQuery)).slice(0, 500), [history, normalizedQuery]);
  const filteredSearchHistory = useMemo(() => searchHistory.filter((item) => `${item.query} ${item.engineId}`.toLocaleLowerCase().includes(normalizedQuery)).slice(0, 500), [searchHistory, normalizedQuery]);
  const filteredDownloads = useMemo(() => downloads.filter((item) => `${item.filename} ${item.sourceHostname || ''} ${item.sourceUrl || ''}`.toLocaleLowerCase().includes(normalizedQuery)).slice(0, 500), [downloads, normalizedQuery]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  const tabs: { id: LibraryTab; label: string; icon: React.ReactNode; count: number }[] = [
    { id: 'bookmarks', label: '북마크', icon: <BookmarkIcon className="h-3.5 w-3.5" />, count: bookmarks.length },
    { id: 'history', label: '방문 기록', icon: <Clock3 className="h-3.5 w-3.5" />, count: history.length },
    { id: 'searches', label: '검색 기록', icon: <Search className="h-3.5 w-3.5" />, count: searchHistory.length },
    { id: 'downloads', label: '다운로드', icon: <Download className="h-3.5 w-3.5" />, count: downloads.length },
  ];

  return (
    <div className="aero-overlay fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto px-4 pb-6 pt-16" onClick={onClose}>
      <section className="aero-modal flex max-h-[calc(100dvh-5rem)] min-h-[22rem] w-full max-w-4xl flex-col overflow-hidden text-[var(--text-primary)]" role="dialog" aria-modal="true" aria-label="브라우저 라이브러리" onClick={(event) => event.stopPropagation()}>
        <header className="aero-panel-header flex shrink-0 items-center gap-3 border-b px-4 py-3">
          <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">브라우저 라이브러리</h2><p className="mt-0.5 text-[11px] text-[var(--text-muted)]">북마크, 방문 기록, 검색 기록, 다운로드를 관리합니다.</p></div>
          <button type="button" onClick={onClose} className="aero-icon-button !h-7 !w-7" aria-label="라이브러리 닫기"><X className="h-4 w-4" /></button>
        </header>
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--border-divider)] px-3 py-2">
          {tabs.map((tab) => <button key={tab.id} type="button" data-active={activeTab === tab.id} onClick={() => { setActiveTab(tab.id); setQuery(''); }} className={`aero-segment inline-flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${activeTab === tab.id ? 'bg-[var(--accent-subtle)] text-[var(--accent)]' : 'hover:text-[var(--text-primary)]'}`}>{tab.icon}{tab.label}<span className="font-mono text-[10px] opacity-70">{tab.count}</span></button>)}
          <div className="aero-field ml-auto flex min-w-[10rem] flex-1 items-center gap-2 px-2 py-1.5 sm:max-w-xs"><Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="검색" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--text-muted)]" aria-label="라이브러리 검색" /></div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {activeTab === 'bookmarks' && <div className="space-y-1.5">{filteredBookmarks.length === 0 ? <EmptyState text="저장된 북마크가 없습니다." /> : filteredBookmarks.map((item) => <BookmarkRow key={item.id} item={item} onOpen={() => onNavigate(item.url)} onOpenNewTab={() => onOpenNewTab(item.url)} onCopy={() => onCopyText(item.url)} onSave={(updates) => onUpdateBookmark(item.id, updates)} onRemove={() => onRemoveBookmark(item.id)} />)}</div>}
          {activeTab === 'history' && <div className="space-y-1.5"><div className="mb-2 flex justify-end"><button type="button" onClick={() => { if (window.confirm('방문 기록을 전체 삭제할까요?')) onClearHistory(); }} disabled={history.length === 0} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--danger)] hover:bg-rose-500/10 disabled:opacity-40"><Trash2 className="h-3 w-3" />전체 삭제</button></div>{filteredHistory.length === 0 ? <EmptyState text="방문 기록이 없습니다." /> : filteredHistory.map((item, index) => <React.Fragment key={item.id}>{(index === 0 || dateGroup(filteredHistory[index - 1].visitedAt) !== dateGroup(item.visitedAt)) && <div className="px-2 pt-2 text-[10px] font-semibold text-[var(--text-muted)]">{dateGroup(item.visitedAt)}</div>}<LibraryRow icon={<Clock3 className="h-4 w-4 text-[var(--text-muted)]" />} title={item.title} subtitle={`${item.url} · ${new Date(item.visitedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`} onOpen={() => onNavigate(item.url)} action={<RowActions onOpenNewTab={() => onOpenNewTab(item.url)} onCopy={() => onCopyText(item.url)} onRemove={() => onRemoveHistory(item.id)} removeLabel={`${item.title} 방문 기록 삭제`} />} /></React.Fragment>)}</div>}
          {activeTab === 'searches' && <div className="space-y-1.5"><div className="mb-2 flex justify-end"><button type="button" onClick={() => { if (window.confirm('검색 기록을 전체 삭제할까요?')) onClearSearchHistory(); }} disabled={searchHistory.length === 0} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--danger)] hover:bg-rose-500/10 disabled:opacity-40"><Trash2 className="h-3 w-3" />전체 삭제</button></div>{filteredSearchHistory.length === 0 ? <EmptyState text="검색 기록이 없습니다." /> : filteredSearchHistory.map((item) => <LibraryRow key={item.id} icon={<Search className="h-4 w-4 text-[var(--accent)]" />} title={item.query} subtitle={`${item.engineId} · ${new Date(item.searchedAt).toLocaleString()}`} onOpen={() => onSearchAgain(item.query)} action={<RowActions onOpenNewTab={() => onSearchAgain(item.query)} onCopy={() => onCopyText(item.query)} onRemove={() => onRemoveSearchHistory(item.id)} removeLabel={`${item.query} 검색 기록 삭제`} openNewTabLabel="다시 검색" />} />)}</div>}
          {activeTab === 'downloads' && <div className="space-y-1.5">{filteredDownloads.length === 0 ? <EmptyState text="다운로드 기록이 없습니다." /> : filteredDownloads.map((item) => <div key={item.id} className="aero-list-row flex items-center gap-3 bg-[var(--chrome-bg)] p-3"><Download className="h-4 w-4 shrink-0 text-[var(--accent)]" /><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{item.filename}</div><div className="truncate text-[10px] text-[var(--text-muted)]">{downloadStateLabel(item)} · {item.sourceHostname || item.sourceUrl || item.savePath || '저장 위치 대기 중'}</div></div><div className="flex shrink-0 items-center gap-1"><button type="button" onClick={() => onOpenDownload(item.id)} disabled={!item.savePath || item.state !== 'completed'} className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--chrome-surface-hover)] hover:text-[var(--text-primary)] disabled:opacity-30" aria-label="다운로드 열기"><ExternalLink className="h-3.5 w-3.5" /></button><button type="button" onClick={() => onShowDownloadInFinder(item.id)} disabled={!item.savePath} className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--chrome-surface-hover)] hover:text-[var(--text-primary)] disabled:opacity-30" aria-label="Finder에서 보기"><FolderOpen className="h-3.5 w-3.5" /></button><button type="button" onClick={() => onCopyText(item.sourceUrl || '')} disabled={!item.sourceUrl} className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--chrome-surface-hover)] hover:text-[var(--text-primary)] disabled:opacity-30" aria-label="다운로드 URL 복사" title="다운로드 URL 복사"><Copy className="h-3.5 w-3.5" /></button>{item.state === 'progressing' && <button type="button" onClick={() => onCancelDownload(item.id)} className="rounded-md px-2 py-1 text-[11px] text-[var(--danger)] hover:bg-rose-500/10">취소</button>}<button type="button" onClick={() => onRemoveDownload(item.id)} disabled={item.state === 'progressing'} className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-rose-500/10 hover:text-[var(--danger)] disabled:opacity-30" aria-label="다운로드 기록 삭제"><Trash2 className="h-3.5 w-3.5" /></button></div></div>)}</div>}
        </div>
      </section>
    </div>
  );
};

const dateGroup = (timestamp: number) => { const date = new Date(timestamp); const today = new Date(); const yesterday = new Date(); yesterday.setDate(today.getDate() - 1); if (date.toDateString() === today.toDateString()) return '오늘'; if (date.toDateString() === yesterday.toDateString()) return '어제'; return date.toLocaleDateString(); };
const downloadStateLabel = (item: DownloadItem) => item.state === 'completed' ? '완료' : item.state === 'progressing' ? (item.totalBytes > 0 ? `진행 중 ${Math.round((item.receivedBytes / item.totalBytes) * 100)}%` : '진행 중') : item.state === 'cancelled' ? '취소됨' : '중단됨';
const EmptyState: React.FC<{ text: string }> = ({ text }) => <div className="flex min-h-40 items-center justify-center text-xs text-[var(--text-muted)]">{text}</div>;

const RowActions: React.FC<{ onOpenNewTab: () => void; onCopy: () => void; onRemove: () => void; removeLabel: string; openNewTabLabel?: string }> = ({ onOpenNewTab, onCopy, onRemove, removeLabel, openNewTabLabel = '새 탭에서 열기' }) => <div className="flex shrink-0 items-center gap-0.5"><button type="button" onClick={onOpenNewTab} className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--chrome-surface-hover)] hover:text-[var(--text-primary)]" aria-label={openNewTabLabel} title={openNewTabLabel}><ExternalLink className="h-3.5 w-3.5" /></button><button type="button" onClick={onCopy} className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--chrome-surface-hover)] hover:text-[var(--text-primary)]" aria-label="복사" title="복사"><Copy className="h-3.5 w-3.5" /></button><button type="button" onClick={onRemove} className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-rose-500/10 hover:text-[var(--danger)]" aria-label={removeLabel} title="삭제"><Trash2 className="h-3.5 w-3.5" /></button></div>;

const BookmarkRow: React.FC<{ item: BookmarkItem; onOpen: () => void; onOpenNewTab: () => void; onCopy: () => void; onSave: (updates: { title: string; url: string }) => void; onRemove: () => void }> = ({ item, onOpen, onOpenNewTab, onCopy, onSave, onRemove }) => {
  const [editing, setEditing] = useState(false); const [title, setTitle] = useState(item.title); const [url, setUrl] = useState(item.url);
  if (editing) return <form className="aero-list-row flex flex-wrap items-center gap-2 p-2.5" onSubmit={(event) => { event.preventDefault(); if (!title.trim() || !url.trim()) return; onSave({ title: title.trim(), url: url.trim() }); setEditing(false); }}><input value={title} onChange={(event) => setTitle(event.target.value)} className="aero-field min-w-[8rem] flex-1 px-2 py-1 text-xs outline-none" aria-label="북마크 이름" /><input value={url} onChange={(event) => setUrl(event.target.value)} className="aero-field min-w-[12rem] flex-[2] px-2 py-1 text-xs outline-none" aria-label="북마크 주소" /><button type="submit" className="rounded-md p-1.5 text-[var(--accent)] hover:bg-[var(--accent-subtle)]" aria-label="북마크 저장"><Check className="h-3.5 w-3.5" /></button><button type="button" onClick={() => setEditing(false)} className="rounded-md p-1.5 text-[var(--text-muted)]" aria-label="수정 취소"><X className="h-3.5 w-3.5" /></button></form>;
  return <LibraryRow icon={<BookmarkIcon className="h-4 w-4 text-[var(--accent)]" />} title={item.title} subtitle={item.url} onOpen={onOpen} action={<div className="flex shrink-0 items-center gap-0.5"><RowActions onOpenNewTab={onOpenNewTab} onCopy={onCopy} onRemove={onRemove} removeLabel={`${item.title} 북마크 삭제`} /><button type="button" onClick={() => setEditing(true)} className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--chrome-surface-hover)] hover:text-[var(--text-primary)]" aria-label="북마크 수정" title="수정"><Pencil className="h-3.5 w-3.5" /></button></div>} />;
};

const LibraryRow: React.FC<{ icon: React.ReactNode; title: string; subtitle: string; onOpen: () => void; action: React.ReactNode }> = ({ icon, title, subtitle, onOpen, action }) => <div className="aero-list-row group flex items-center gap-3 p-2.5"><span className="shrink-0">{icon}</span><button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left"><div className="truncate text-xs font-medium text-[var(--text-primary)]">{title}</div><div className="truncate text-[10px] text-[var(--text-muted)]">{subtitle}</div></button>{action}</div>;
