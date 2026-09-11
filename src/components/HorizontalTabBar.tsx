import React, { useState, useEffect, useRef } from 'react';
import { Plus, X, Globe, Pin, Volume2, VolumeX, RotateCw, Copy, PanelRight } from 'lucide-react';
import { Tab } from '../types/browser';
import { shortcutLabel } from '../utils/platform';

interface HorizontalTabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  isAsideOpen: boolean;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string, e?: React.MouseEvent) => void;
  onNewTab: (url?: string) => void;
  onTogglePinTab: (tabId: string) => void;
  onToggleMuteTab: (tabId: string) => void;
  onDuplicateTab: (tabId: string) => void;
  onCloseOtherTabs: (tabId: string) => void;
  onCloseTabsToRight: (tabId: string) => void;
  onReloadTab: (tabId: string) => void;
  onToggleAside: () => void;
  onReorderTabs?: (sourceId: string, targetId: string) => void;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  tabId: string;
}

export const HorizontalTabBar: React.FC<HorizontalTabBarProps> = ({
  tabs,
  activeTabId,
  isAsideOpen,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onTogglePinTab,
  onToggleMuteTab,
  onDuplicateTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onReloadTab,
  onToggleAside,
  onReorderTabs,
}) => {
  const navRef = useRef<HTMLElement>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    tabId: '',
  });

  // Keep the active tab visible without starting an animation that can be
  // interrupted by the next wheel/touch event.
  useEffect(() => {
    if (activeTabId && navRef.current) {
      const activeEl = navRef.current.querySelector(`[data-tab-id="${activeTabId}"]`) as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
      }
    }
  }, [activeTabId]);

  const handleNavWheel = (e: React.WheelEvent) => {
    const node = navRef.current;
    if (!node || node.scrollWidth <= node.clientWidth) return;

    // Trackpads usually report deltaX, while a mouse wheel reports deltaY.
    // Use whichever axis carries the user's actual horizontal intent and
    // consume the event so the page/window cannot steal part of the gesture.
    const delta = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!delta) return;

    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? node.clientWidth : 1;
    if (e.cancelable) e.preventDefault();
    node.scrollLeft += delta * unit;
  };

  useEffect(() => {
    const handleCloseMenu = () => {
      if (contextMenu.visible) {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, [contextMenu.visible]);

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      tabId,
    });
  };

  const pinnedTabs = tabs.filter((t) => t.isPinned);
  const unpinnedTabs = tabs.filter((t) => !t.isPinned);
  const targetTab = tabs.find((t) => t.id === contextMenu.tabId);

  return (
    <header
      onDoubleClick={(e) => {
        if (
          e.target === e.currentTarget ||
          (e.target as HTMLElement).getAttribute('data-drag-region') === 'true' ||
          (e.target as HTMLElement).classList.contains('titlebar-drag')
        ) {
          window.electronAPI?.maximizeWindow();
        }
      }}
      onWheel={handleNavWheel}
      className="aero-tabbar flex items-center h-10 px-2.5 titlebar-drag select-none z-30"
    >
      {/* Tabs Container (Interactive tabs have titlebar-no-drag, but container doesn't block dragging) */}
      <nav
        ref={navRef}
        data-tab-strip="true"
        className="aero-tab-strip flex items-center gap-1 overflow-x-auto no-scrollbar py-1 max-w-[calc(100%-140px)] min-w-0 flex-shrink titlebar-no-drag"
      >
        {/* Pinned Tabs (Compact 28x28 Favicon Pill) */}
        {pinnedTabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              data-tab-id={tab.id}
              onClick={() => onSelectTab(tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  e.stopPropagation();
                  onCloseTab(tab.id, e);
                }
              }}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              title={tab.title || tab.url}
              data-active={isActive}
              className="aero-tab aero-tab-pinned relative flex h-7 w-7 flex-shrink-0 items-center justify-center titlebar-no-drag"
            >
              <div className="w-3.5 h-3.5 flex items-center justify-center">
                {tab.isLoading ? (
                  <div className="w-3 h-3 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                ) : tab.favicon ? (
                  <img
                    src={tab.favicon}
                    alt=""
                    className="w-3.5 h-3.5 object-contain"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <Globe className="w-3.5 h-3.5 opacity-60" />
                )}
              </div>
            </button>
          );
        })}

        {pinnedTabs.length > 0 && (
          <div className="w-[1px] h-3.5 bg-[var(--border-divider)] mx-0.5 flex-shrink-0" />
        )}

        {/* Regular Tabs (Uniform 160px width with horizontal scroll) */}
        {unpinnedTabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isDragOver = tab.id === dragOverTabId;
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              draggable={true}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', tab.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dragOverTabId !== tab.id) setDragOverTabId(tab.id);
              }}
              onDragLeave={() => {
                if (dragOverTabId === tab.id) setDragOverTabId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverTabId(null);
                const sourceId = e.dataTransfer.getData('text/plain');
                if (sourceId && sourceId !== tab.id && onReorderTabs) {
                  onReorderTabs(sourceId, tab.id);
                }
              }}
              onClick={() => onSelectTab(tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  e.stopPropagation();
                  onCloseTab(tab.id, e);
                }
              }}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              data-active={isActive}
              className={`aero-tab aero-tab-regular group relative flex h-7 w-[160px] flex-shrink-0 cursor-pointer items-center gap-2 px-2.5 text-xs font-medium titlebar-no-drag ${
                isDragOver ? 'border-l-2 border-l-[var(--accent)] ring-1 ring-[var(--accent-subtle)]' : ''
              }`}
            >
              {/* Favicon or Loading Spinner */}
              <div className="flex-shrink-0 flex items-center justify-center w-3.5 h-3.5">
                {tab.isLoading ? (
                  <div className="w-3 h-3 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                ) : tab.favicon ? (
                  <img
                    src={tab.favicon}
                    alt=""
                    className="w-3.5 h-3.5 object-contain"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <Globe className="w-3.5 h-3.5 opacity-50" />
                )}
              </div>

              {/* Title */}
              <span className="flex-1 truncate select-none text-[12px]" title={tab.title || tab.url}>
                {tab.title || '새 탭'}
              </span>

              {/* Audio Playing Indicator */}
              {tab.audioPlaying && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleMuteTab(tab.id);
                  }}
                  title={tab.isMuted ? '음소거 해제' : '음소거'}
                  className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded titlebar-no-drag"
                >
                  {tab.isMuted ? (
                    <VolumeX className="w-3 h-3 text-[var(--danger)]" />
                  ) : (
                    <Volume2 className="w-3 h-3 text-[var(--accent)] animate-pulse" />
                  )}
                </button>
              )}

              {/* Tab Close Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id, e);
                }}
                title={`탭 닫기 (${shortcutLabel('⌘W', 'Ctrl+W')})`}
                className="aero-tab-close flex items-center justify-center rounded-[var(--radius-sm)] p-0.5 titlebar-no-drag"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}

        {/* New Tab Button */}
        <button
          onClick={() => onNewTab()}
          title={`새 탭 열기 (${shortcutLabel('⌘T', 'Ctrl+T')})`}
          className="aero-icon-button aero-newtab-button flex-shrink-0 titlebar-no-drag"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </nav>

      {/* Spacious Draggable Window Region between tabs and Aside button */}
      <div
        className="flex-1 h-full titlebar-no-drag min-w-[32px] cursor-default"
        data-drag-region="true"
        onWheel={handleNavWheel}
        onDoubleClick={() => window.electronAPI?.maximizeWindow()}
      />

      {/* Right Aside Toggle Button (Clean Icon-Only) */}
      <div className="flex items-center pl-1.5 titlebar-no-drag flex-shrink-0">
        <button
          onClick={onToggleAside}
          title="Aside 서랍 패널 토글 (번역/메모/다운로드)"
          className={`aero-icon-button border transition-colors ${
            isAsideOpen
              ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border-[var(--accent-border)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--chrome-surface-hover)] border-transparent'
          }`}
        >
          <PanelRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* High-Density Tab Context Menu */}
      {contextMenu.visible && targetTab && (
        <div
          className="aero-popover fixed z-50 py-1 w-44 text-xs text-[var(--text-primary)]"
          style={{ top: Math.min(contextMenu.y, window.innerHeight - 300), left: Math.min(contextMenu.x, window.innerWidth - 190) }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              onReloadTab(targetTab.id);
              setContextMenu((p) => ({ ...p, visible: false }));
            }}
            className="aero-list-row w-full text-left px-3 py-1.5 flex items-center gap-2"
          >
            <RotateCw className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            <span>새로고침</span>
          </button>
          <button
            onClick={() => {
              onDuplicateTab(targetTab.id);
              setContextMenu((p) => ({ ...p, visible: false }));
            }}
            className="aero-list-row w-full text-left px-3 py-1.5 flex items-center gap-2"
          >
            <Copy className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            <span>탭 복제</span>
          </button>
          <button
            onClick={() => {
              onTogglePinTab(targetTab.id);
              setContextMenu((p) => ({ ...p, visible: false }));
            }}
            className="aero-list-row w-full text-left px-3 py-1.5 flex items-center gap-2"
          >
            <Pin className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            <span>{targetTab.isPinned ? '탭 고정 해제' : '탭 고정'}</span>
          </button>
          <button
            onClick={() => {
              onToggleMuteTab(targetTab.id);
              setContextMenu((p) => ({ ...p, visible: false }));
            }}
            className="aero-list-row w-full text-left px-3 py-1.5 flex items-center gap-2"
          >
            {targetTab.isMuted ? (
              <Volume2 className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            ) : (
              <VolumeX className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            )}
            <span>{targetTab.isMuted ? '사이트 음소거 해제' : '사이트 음소거'}</span>
          </button>

          <div className="h-[1px] bg-[var(--border-divider)] my-1" />

          <button
            onClick={() => {
              onCloseTab(targetTab.id);
              setContextMenu((p) => ({ ...p, visible: false }));
            }}
            className="aero-list-row w-full text-left px-3 py-1.5 text-[var(--danger)] hover:!bg-[var(--danger-subtle)]"
          >
            탭 닫기
          </button>
          <button
            onClick={() => {
              onCloseOtherTabs(targetTab.id);
              setContextMenu((p) => ({ ...p, visible: false }));
            }}
            className="aero-list-row w-full text-left px-3 py-1.5"
          >
            다른 탭 닫기
          </button>
          <button
            onClick={() => {
              onCloseTabsToRight(targetTab.id);
              setContextMenu((p) => ({ ...p, visible: false }));
            }}
            className="aero-list-row w-full text-left px-3 py-1.5"
          >
            오른쪽 탭들 닫기
          </button>
        </div>
      )}
    </header>
  );
};
