import React from 'react';
import { Columns2, Minus, Pencil, Plus } from 'lucide-react';
import { Tab, Workspace } from '../types/browser';
import { isInternalPageUrl } from '../../shared/internalPages';

export interface WorkspaceControlsProps {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  tabs: Tab[];
  activeTabId: string | null;
  splitEnabled: boolean;
  splitSecondaryTabId: string | null;
  splitRatio: number;
  onSelectWorkspace: (id: string) => void;
  onCreateWorkspace: () => void;
  onRenameWorkspace: () => void;
  onDeleteWorkspace: () => void;
  onToggleSplit: () => void;
  onSelectSplitTab: (id: string) => void;
  onSplitRatioChange: (ratio: number) => void;
  compact?: boolean;
}

export const WorkspaceControls: React.FC<WorkspaceControlsProps> = ({
  workspaces,
  activeWorkspaceId,
  tabs,
  activeTabId,
  splitEnabled,
  splitSecondaryTabId,
  splitRatio,
  onSelectWorkspace,
  onCreateWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  onToggleSplit,
  onSelectSplitTab,
  onSplitRatioChange,
  compact = false,
}) => {
  const isSplitable = (tab: Tab) => !isInternalPageUrl(tab.url);
  const canSplit = tabs.filter(isSplitable).length >= 2;
  const splitCandidates = tabs.filter((tab) => tab.id !== activeTabId && isSplitable(tab));

  return (
    <div className={`flex items-center gap-1.5 min-w-0 titlebar-no-drag ${compact ? 'shrink-0' : ''}`}>
      {!compact && <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] max-[480px]:hidden">Workspace</span>}
      <span className="w-1.5 h-1.5 rounded-full titlebar-no-drag bg-[var(--text-secondary)]" />
      <select
        value={activeWorkspaceId}
        onChange={(event) => onSelectWorkspace(event.target.value)}
        className={`${compact ? 'w-24 max-w-24 max-[900px]:w-20 max-[900px]:max-w-20' : 'w-32 max-w-32 max-[480px]:w-20 max-[480px]:max-w-20'} min-w-0 bg-transparent text-[11px] text-[var(--text-primary)] outline-none cursor-pointer titlebar-no-drag`}
        aria-label="워크스페이스 선택"
        title="워크스페이스별로 로그인·쿠키·사이트 데이터를 분리합니다"
      >
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id} className="bg-[var(--chrome-surface)]">
            {workspace.name}
          </option>
        ))}
      </select>
      <button onClick={onRenameWorkspace} title="현재 워크스페이스 이름 수정" aria-label="현재 워크스페이스 이름 수정" className="null-icon-button !h-7 !w-7 shrink-0 titlebar-no-drag max-[360px]:hidden">
        <Pencil className="w-3 h-3" />
      </button>
      <button onClick={onCreateWorkspace} title="워크스페이스 추가" aria-label="워크스페이스 추가" className="null-icon-button !h-7 !w-7 shrink-0 titlebar-no-drag">
        <Plus className="w-3 h-3" />
      </button>
      <button onClick={onDeleteWorkspace} disabled={workspaces.length <= 1} title="현재 워크스페이스 삭제" aria-label="현재 워크스페이스 삭제" className="null-icon-button !h-7 !w-7 shrink-0 hover:!bg-[var(--danger-subtle)] hover:!text-[var(--danger)] disabled:opacity-30 titlebar-no-drag max-[480px]:hidden">
        <Minus className="w-3 h-3" />
      </button>
      {splitEnabled && (
        <>
          <select
            value={splitSecondaryTabId || ''}
            onChange={(event) => onSelectSplitTab(event.target.value)}
            className="w-24 max-w-24 min-w-0 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--chrome-surface)] px-1.5 py-1 text-[10px] text-[var(--text-secondary)] outline-none titlebar-no-drag max-[900px]:w-20 max-[900px]:max-w-20"
            aria-label="분할 화면 두 번째 탭 선택"
          >
            {splitCandidates.map((tab) => (
              <option key={tab.id} value={tab.id}>{tab.title || tab.url}</option>
            ))}
          </select>
          <select
            value={String(Math.round(splitRatio * 100))}
            onChange={(event) => onSplitRatioChange(Number(event.target.value) / 100)}
            className="w-16 max-w-16 min-w-0 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--chrome-surface)] px-1 py-1 text-[10px] text-[var(--text-secondary)] outline-none titlebar-no-drag max-[700px]:hidden"
            aria-label="분할 화면 비율"
            title="분할 화면 비율"
          >
            <option value="30">30 / 70</option>
            <option value="40">40 / 60</option>
            <option value="50">50 / 50</option>
            <option value="60">60 / 40</option>
            <option value="70">70 / 30</option>
          </select>
        </>
      )}
      <button onClick={onToggleSplit} disabled={!canSplit && !splitEnabled} title={splitEnabled ? '분할 화면 닫기' : '현재 워크스페이스를 분할 화면으로 보기'} aria-label={splitEnabled ? '분할 화면 닫기' : '분할 화면'} className={`null-quiet-button flex h-7 shrink-0 items-center gap-1 px-2 text-[10px] titlebar-no-drag max-[700px]:px-1.5 ${splitEnabled ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)]' : 'border-transparent disabled:opacity-30'}`}>
        <Columns2 className="w-3 h-3" />
        <span className="max-[700px]:hidden">{splitEnabled ? '분할 중' : '분할'}</span>
      </button>
    </div>
  );
};

export const WorkspaceBar: React.FC<WorkspaceControlsProps> = (props) => {
  const isMacOS = window.electronAPI?.platform === 'darwin';

  return (
    <div
      onDoubleClick={(event) => {
        if (event.target === event.currentTarget || (event.target as HTMLElement).getAttribute('data-drag-region') === 'true') {
          window.electronAPI?.maximizeWindow();
        }
      }}
      className="null-workspacebar flex h-8 min-w-0 items-center gap-2 pl-0 pr-3 select-none titlebar-drag"
    >
      {/* Hidden-inset macOS windows draw content behind the traffic lights. */}
      {isMacOS && <div className="h-full w-[148px] max-[700px]:w-24 max-[480px]:w-[76px] flex-shrink-0 titlebar-drag" data-drag-region="true" aria-hidden="true" />}
      <WorkspaceControls {...props} />
    </div>
  );
};
