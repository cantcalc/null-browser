import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Tab } from '../types/browser';

export interface WebViewContainerRef {
  toggleDevTools: () => void;
  findInPage: (text: string, forward: boolean) => void;
  stopFindInPage: () => void;
  setZoom: (zoomFactor: number) => void;
  toggleTranslatePage: () => Promise<boolean>;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  reloadWithoutCache: () => void;
}

interface WebViewContainerProps {
  tabs: Tab[];
  activeTabId: string | null;
  onUpdateTab: (tabId: string, updates: Partial<Tab>) => void;
  onNewTab: (url: string) => void;
  onSelectTab: (tabId: string) => void;
  onFoundInPage?: (result: { activeMatchOrdinal: number; matches: number }) => void;
  onOpenDrawerTranslate?: (text: string) => void;
}

export const WebViewContainer = forwardRef<WebViewContainerRef, WebViewContainerProps>(
  ({ tabs, activeTabId }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);

    // Imperative control handle forwarded to AddressBar, CommandPalette, Shortcuts
    useImperativeHandle(ref, () => ({
      toggleDevTools: () => {
        if (activeTabId && window.electronAPI) {
          window.electronAPI.toggleTabDevTools(activeTabId);
        }
      },
      findInPage: (text: string, forward: boolean) => {
        if (activeTabId && window.electronAPI) {
          window.electronAPI.findInTab(activeTabId, text, forward);
        }
      },
      stopFindInPage: () => {
        if (activeTabId && window.electronAPI) {
          window.electronAPI.stopFindInTab(activeTabId);
        }
      },
      setZoom: (zoomFactor: number) => {
        if (activeTabId && window.electronAPI) {
          window.electronAPI.setTabZoom(activeTabId, zoomFactor);
        }
      },
      goBack: () => {
        if (activeTabId && window.electronAPI) {
          window.electronAPI.goBackTab(activeTabId);
        }
      },
      goForward: () => {
        if (activeTabId && window.electronAPI) {
          window.electronAPI.goForwardTab(activeTabId);
        }
      },
      reload: () => {
        if (activeTabId && window.electronAPI) {
          window.electronAPI.reloadTab(activeTabId, false);
        }
      },
      reloadWithoutCache: () => {
        if (activeTabId && window.electronAPI) {
          window.electronAPI.reloadTab(activeTabId, true);
        }
      },
      toggleTranslatePage: async () => {
        if (activeTabId && window.electronAPI) {
          return await window.electronAPI.translateTab(activeTabId);
        }
        return false;
      },
    }));

    // Observe container size and position, notifying Electron WebContentsView in real-time
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const reportBounds = () => {
        if (!containerRef.current || !window.electronAPI) return;
        const rect = containerRef.current.getBoundingClientRect();
        window.electronAPI.setTabViewBounds({
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      };

      reportBounds();

      const observer = new ResizeObserver(() => {
        reportBounds();
      });
      observer.observe(container);

      window.addEventListener('resize', reportBounds);
      const interval = setInterval(reportBounds, 250);

      return () => {
        observer.disconnect();
        window.removeEventListener('resize', reportBounds);
        clearInterval(interval);
      };
    }, []);

    return (
      <div
        ref={containerRef}
        className="relative flex-1 w-full h-full bg-[var(--chrome-bg)] overflow-hidden flex"
      >
        {tabs.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-muted)] gap-2 select-none">
            <div className="text-xl font-semibold text-[var(--text-primary)] tracking-tight">
              Aero
            </div>
            <p className="text-xs text-[var(--text-secondary)]">열려 있는 탭이 없습니다. 새 탭을 열어 시작하세요.</p>
          </div>
        )}
      </div>
    );
  }
);
