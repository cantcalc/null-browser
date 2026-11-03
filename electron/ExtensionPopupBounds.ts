import { screen } from 'electron';
import type { BaseWindow, BrowserWindow, Rectangle } from 'electron';
import type { EventEmitter } from 'node:events';

interface ExtensionPopup extends EventEmitter {
  parent?: BaseWindow;
  browserWindow?: BrowserWindow;
}

/** All inputs are screen DIPs, not Retina/device pixels. */
export function fitExtensionPopup(requested: Rectangle, content: Rectangle, workArea: Rectangle): Rectangle {
  const margin = 8;
  const left = Math.max(content.x, workArea.x) + margin;
  const top = Math.max(content.y, workArea.y) + margin;
  const right = Math.max(left + 1, Math.min(content.x + content.width, workArea.x + workArea.width) - margin);
  const bottom = Math.max(top + 1, Math.min(content.y + content.height, workArea.y + workArea.height) - margin);
  const width = Math.max(1, Math.min(Math.round(requested.width), right - left));
  // Toolbar popups open downward. Reduce the viewport rather than pushing a
  // tall popup upward across the toolbar or below the browser's bottom edge.
  const minimumVisibleHeight = Math.min(120, requested.height, bottom - top);
  const y = Math.min(Math.max(Math.round(requested.y), top), bottom - minimumVisibleHeight);
  const height = Math.max(1, Math.min(Math.round(requested.height), bottom - y));
  return { x: Math.max(left, Math.min(Math.round(requested.x), right - width)), y, width, height };
}

/** Constrain the bridge's native popup without polling, DOM injection, or a
 * dependency patch. The pinned bridge emits mutable bounds before setBounds. */
export function constrainExtensionPopup(popup: ExtensionPopup): void {
  const parent = popup.parent;
  const win = popup.browserWindow;
  if (!parent || !win || parent.isDestroyed() || win.isDestroyed()) return;
  let anchor: { rightGap: number; topOffset: number } | undefined;
  let preferred: { width: number; height: number } | undefined;

  const fit = (requested: Rectangle) => fitExtensionPopup(requested, parent.getContentBounds(), screen.getDisplayMatching(parent.getBounds()).workArea);
  const applySize = (bounds: Rectangle) => {
    const previous = win.getBounds();
    if (previous.width !== bounds.width || previous.height !== bounds.height) {
      win.setBounds({ ...previous, width: bounds.width, height: bounds.height }, false);
    }
  };
  const willResize = (size: { width: number; height: number }) => {
    if (win.isDestroyed() || parent.isDestroyed()) return;
    preferred = { ...size };
    const content = parent.getContentBounds();
    const at = anchor
      ? { x: content.x + content.width - anchor.rightGap - size.width, y: content.y + anchor.topOffset }
      : { x: content.x, y: content.y };
    const bounds = fit({ ...at, ...size });
    size.width = bounds.width;
    size.height = bounds.height;
  };
  const willMove = (position: { x: number; y: number }) => {
    if (win.isDestroyed() || parent.isDestroyed()) return;
    const content = parent.getContentBounds();
    const current = win.getBounds();
    anchor = { rightGap: content.x + content.width - position.x - current.width, topOffset: position.y - content.y };
    const bounds = fit({ ...current, ...position });
    applySize(bounds);
    position.x = bounds.x;
    position.y = bounds.y;
  };
  const refit = () => {
    if (win.isDestroyed() || parent.isDestroyed() || !anchor) return;
    const content = parent.getContentBounds();
    const size = preferred || win.getBounds();
    const bounds = fit({ ...size, x: content.x + content.width - anchor.rightGap - size.width, y: content.y + anchor.topOffset });
    const old = win.getBounds();
    if (Object.keys(bounds).some(key => bounds[key as keyof Rectangle] !== old[key as keyof Rectangle])) win.setBounds(bounds, false);
  };
  const cleanup = () => {
    popup.off('will-resize', willResize);
    popup.off('will-move', willMove);
    parent.off('move', refit);
    parent.off('resize', refit);
    parent.off('enter-full-screen', refit);
    parent.off('leave-full-screen', refit);
    screen.off('display-metrics-changed', refit);
    win.off('show', refit);
  };
  popup.on('will-resize', willResize);
  popup.on('will-move', willMove);
  parent.on('move', refit);
  parent.on('resize', refit);
  parent.on('enter-full-screen', refit);
  parent.on('leave-full-screen', refit);
  screen.on('display-metrics-changed', refit);
  win.on('show', refit);
  win.once('closed', cleanup);
}
