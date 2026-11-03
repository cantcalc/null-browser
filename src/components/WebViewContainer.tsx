import React, { useEffect, useLayoutEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Tab } from '../types/browser';

export interface WebViewContainerRef {
  toggleDevTools: () => void;
  findInPage: (text: string, forward: boolean) => void;
  stopFindInPage: () => void;
  setZoom: (zoomFactor: number) => void;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  reloadWithoutCache: () => void;
}

interface WebViewContainerProps {
  tabs: Tab[];
  activeTabId: string | null;
  layoutKey: string;
  onUpdateTab: (tabId: string, updates: Partial<Tab>) => void;
  onNewTab: (url: string) => void;
  onSelectTab: (tabId: string) => void;
  onFoundInPage?: (result: { activeMatchOrdinal: number; matches: number }) => void;
}

export const WebViewContainer = forwardRef<WebViewContainerRef, WebViewContainerProps>(
  ({ tabs, activeTabId, layoutKey }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const reportBoundsRef = useRef<() => void>(() => {});
    const activeUrl = tabs.find(tab => tab.id === activeTabId)?.url;

    useLayoutEffect(() => {
      reportBoundsRef.current();
    }, [activeTabId, activeUrl, layoutKey]);

    // Imperative control handle forwarded to the toolbar and keyboard shortcuts
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
    }));

    // Observe container size and position, notifying Electron WebContentsView in real-time
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      let lastBounds: { x: number; y: number; width: number; height: number } | null = null;

      const reportBounds = () => {
        if (!containerRef.current || !window.electronAPI) return;
        const rect = containerRef.current.getBoundingClientRect();
        const bounds = {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
        // Internal pages hide this DOM container. Never shrink a native page
        // to a zero viewport while its next document/route is being committed.
        if (bounds.width <= 0 || bounds.height <= 0) return;
        if (lastBounds && Object.keys(bounds).every(key => bounds[key as keyof typeof bounds] === lastBounds![key as keyof typeof bounds])) return;
        lastBounds = bounds;
        window.electronAPI.setTabViewBounds(bounds);
      };
      reportBoundsRef.current = reportBounds;
      reportBounds();

      // Observer/resize events already follow layout. Do not defer native view
      // bounds to an animation frame that a focused guest can throttle.
      const observer = new ResizeObserver(reportBounds);
      observer.observe(container);
      const chrome = document.querySelector('.null-connected-chrome');
      if (chrome) observer.observe(chrome);

      window.addEventListener('resize', reportBounds);
      // Native window resize IPC is a task, not a rendering-frame callback.
      // ResizeObserver/DOM resize events can wait while a focused native guest
      // makes the chrome renderer appear occluded to Chromium.
      const unsubscribeWindowResize = window.electronAPI?.onWindowResized(reportBounds);

      return () => {
        observer.disconnect();
        reportBoundsRef.current = () => {};
        window.removeEventListener('resize', reportBounds);
        unsubscribeWindowResize?.();
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
              NULL
            </div>
            <p className="text-xs text-[var(--text-secondary)]">열려 있는 탭이 없습니다. 새 탭을 열어 시작하세요.</p>
          </div>
        )}
      </div>
    );
  }
);
