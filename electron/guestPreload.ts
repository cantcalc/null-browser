import { ipcRenderer } from 'electron';
import { HistorySwipe, HISTORY_SWIPE } from './HistorySwipe';

// The browser owns horizontal back/forward gestures. Prevent Chromium's
// native edge overscroll animation from competing with that gesture path.
function disableNativeHorizontalOverscroll() {
  const style = document.createElement('style');
  style.id = '__null_horizontal_gesture_guard';
  style.textContent = 'html, body { overscroll-behavior-x: none !important; }';
  (document.head || document.documentElement)?.appendChild(style);
}

if (document.documentElement) disableNativeHorizontalOverscroll();
else window.addEventListener('DOMContentLoaded', disableNativeHorizontalOverscroll, { once: true });

type HistoryAction = 'back' | 'forward';
let historyState = { canGoBack: false, canGoForward: false };
let gestureHud: { host: HTMLDivElement; badge: HTMLDivElement; label: HTMLSpanElement } | null = null;
let hudTimer: ReturnType<typeof setTimeout> | null = null;

function canNavigate(action: HistoryAction) {
  return action === 'back' ? historyState.canGoBack : historyState.canGoForward;
}

// A small edge cue lives in this page's isolated preload, above its own content.
// No full-page overlay, screenshot animation, body transform or focus capture.
function showGesture(action: HistoryAction, progress: number, available = canNavigate(action), committed = false) {
  if (!process.isMainFrame || !document.documentElement) return;
  if (hudTimer) clearTimeout(hudTimer);
  if (!gestureHud || !gestureHud.host.isConnected) {
    const host = document.createElement('div');
    host.id = '__null_history_gesture';
    host.style.cssText = 'all:initial!important;position:fixed!important;top:50%!important;width:180px!important;height:64px!important;margin-top:-32px!important;z-index:2147483647!important;pointer-events:none!important;user-select:none!important;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { color-scheme: dark; }
      .badge { position:absolute;top:10px;left:10px;display:flex;align-items:center;gap:8px;max-width:164px;padding:5px 10px 5px 5px;border:1px solid #ffffff26;border-radius:24px;background:#202226f5;color:#f5f5f5;box-shadow:0 3px 12px #0003;font:500 11px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;opacity:0;transform:translateX(-8px);transition:opacity 100ms ease,transform 120ms ease; }
      .badge.visible { opacity:1;transform:translateX(0); }
      .badge.forward { left:auto;right:10px;flex-direction:row-reverse;padding:5px 5px 5px 10px;transform:translateX(8px); }
      .badge.forward.visible { transform:translateX(0); }
      .badge.unavailable { color:#a6a8ae; }
      .ring { display:grid;place-items:center;width:30px;height:30px;flex:none;border-radius:50%;background:conic-gradient(#f5f5f5 calc(var(--progress,0)*1turn),#ffffff24 0); }
      .arrow { display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:#202226; }
      svg { width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round; }
      .forward svg { transform:rotate(180deg); }
      @media(prefers-reduced-motion:reduce) { .badge { transition:none;transform:none!important; } }
    `;
    const badge = document.createElement('div'); badge.className = 'badge'; badge.setAttribute('role', 'status'); badge.setAttribute('aria-live', 'polite');
    const ring = document.createElement('div'); ring.className = 'ring'; ring.setAttribute('aria-hidden', 'true');
    const arrow = document.createElement('div'); arrow.className = 'arrow';
    arrow.innerHTML = '<svg viewBox="0 0 24 24"><path d="m14 6-6 6 6 6M8 12h12"/></svg>';
    const label = document.createElement('span');
    ring.appendChild(arrow); badge.append(ring, label); shadow.append(style, badge); document.documentElement.appendChild(host);
    gestureHud = { host, badge, label };
  }
  const { host, badge, label } = gestureHud;
  host.style.setProperty('left', action === 'back' ? '0' : 'auto', 'important');
  host.style.setProperty('right', action === 'forward' ? '0' : 'auto', 'important');
  host.dataset.action = action;
  host.dataset.state = available ? (committed ? 'committed' : 'tracking') : 'unavailable';
  host.dataset.progress = String(Math.min(1, progress));
  badge.className = `badge visible${action === 'forward' ? ' forward' : ''}${available ? '' : ' unavailable'}`;
  badge.style.setProperty('--progress', String(Math.min(1, progress)));
  const text = available ? (action === 'back' ? '뒤로 가기' : '앞으로 가기') : (action === 'back' ? '이전 페이지 없음' : '다음 페이지 없음');
  if (label.textContent !== text) label.textContent = text;
  hudTimer = setTimeout(hideGesture, committed ? 450 : HISTORY_SWIPE.idleMs + 40);
}

function hideGesture() {
  if (hudTimer) clearTimeout(hudTimer);
  hudTimer = null;
  if (gestureHud) {
    gestureHud.badge.classList.remove('visible');
    gestureHud.host.dataset.state = 'hidden';
  }
}

ipcRenderer.on('tab:gesture-state', (_event, state: { canGoBack?: boolean; canGoForward?: boolean }) => {
  historyState = { canGoBack: state.canGoBack === true, canGoForward: state.canGoForward === true };
});
ipcRenderer.on('tab:gesture-feedback', (_event, data: { action: HistoryAction; accepted: boolean }) => {
  if (data.action === 'back' || data.action === 'forward') showGesture(data.action, 1, data.accepted, true);
});

// 1. Mouse Side Buttons (Button 3 = Back, Button 4 = Forward) & Middle-click on Links
// Chromium performs native side-button navigation. Observe the different DOM
// event types only to show the cue; never cancel or navigate a second time.
let lastSideButtonAction: { action: 'back' | 'forward'; at: number } | null = null;

function consumeSideButton(e: MouseEvent | PointerEvent): boolean {
  if (!process.isMainFrame || !e.isTrusted) return false;
  const action = e.button === 3 ? 'back' : e.button === 4 ? 'forward' : null;
  if (!action) return false;
  const now = performance.now();
  if (lastSideButtonAction?.action === action && now - lastSideButtonAction.at < 160) {
    return true;
  }
  lastSideButtonAction = { action, at: now };
  showGesture(action, 1, canNavigate(action), true);
  if (canNavigate(action)) ipcRenderer.send('tab:guest-gesture', action, 'button');
  return true;
}

function handlePointerSideButton(e: PointerEvent) {
  consumeSideButton(e);
}

function handleMouseSideButton(e: MouseEvent) {
  consumeSideButton(e);
}

window.addEventListener(
  'auxclick',
  (e: MouseEvent) => {
    if (consumeSideButton(e)) return;
    if (e.button === 1) {
      const a = (e.target as HTMLElement)?.closest?.('a') as HTMLAnchorElement | null;
      if (a && a.href && /^https?:\/\//i.test(a.href)) {
        e.preventDefault();
        e.stopPropagation();
        ipcRenderer.send('tab:guest-open-newtab', a.href);
      }
    }
  },
  true
);
window.addEventListener('pointerdown', handlePointerSideButton, true);
window.addEventListener('mousedown', handleMouseSideButton, true);
window.addEventListener('mouseup', handleMouseSideButton, true);

// 2. Trackpad Horizontal Swipe Back / Forward
let lastSwipeTime = -Infinity;
const swipe = new HistorySwipe();
let swipeResetTimer: ReturnType<typeof setTimeout> | null = null;

function resetSwipeAccumulator() {
  swipe.reset();
  if (swipeResetTimer) {
    clearTimeout(swipeResetTimer);
    swipeResetTimer = null;
  }
}

// A horizontally scrollable code block/carousel owns the wheel until it
// reaches its own edge. RTL elements use a negative scrollLeft in Chromium.
function canScrollHorizontally(event: WheelEvent, direction: number) {
  const nodes = event.composedPath().filter((node): node is Element => node instanceof Element);
  const root = document.scrollingElement;
  if (root && !nodes.includes(root)) nodes.push(root);
  return nodes.some(node => {
    const max = node.scrollWidth - node.clientWidth;
    if (max <= 4) return false;
    const style = getComputedStyle(node);
    if (node !== root && !/^(auto|scroll|overlay)$/.test(style.overflowX)) return false;
    const rtl = style.direction === 'rtl';
    const min = rtl ? -max : 0;
    const limit = rtl ? 0 : max;
    return direction < 0 ? node.scrollLeft > min + 4 : node.scrollLeft < limit - 4;
  });
}

window.addEventListener(
  'wheel',
  (e: WheelEvent) => {
    if (!process.isMainFrame || !e.isTrusted) return;
    if (e.ctrlKey || e.shiftKey) { resetSwipeAccumulator(); hideGesture(); return; }

    // Trackpads often emit a stream of small wheel deltas rather than one
    // large event. Accumulate a short, mostly-horizontal stream so light
    // swipes are not missed while vertical scrolling remains untouched.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerWidth : 1;
    const deltaX = e.deltaX * unit;
    const deltaY = e.deltaY * unit;
    const direction = Math.sign(deltaX);

    // The CSS overscroll guard and disabled native history overscroll own the
    // edge effect. A passive observer lets ordinary scrolling stay on Chromium's
    // compositor instead of waiting for this page's JavaScript on every wheel.
    if (direction && Math.abs(deltaX) >= Math.abs(deltaY) * 0.65 && canScrollHorizontally(e, direction)) {
      resetSwipeAccumulator();
      hideGesture();
      return;
    }

    if (swipeResetTimer) clearTimeout(swipeResetTimer);
    swipeResetTimer = setTimeout(() => { resetSwipeAccumulator(); hideGesture(); }, HISTORY_SWIPE.idleMs);

    const now = performance.now();
    const result = swipe.add(deltaX, deltaY, now);
    if (now - lastSwipeTime < 650) {
      return;
    }

    if (!result) { hideGesture(); return; }
    e.stopPropagation();
    e.stopImmediatePropagation();
    showGesture(result.action, result.progress, canNavigate(result.action), result.commit);
    if (!result.commit) return;

    lastSwipeTime = now;
    if (canNavigate(result.action)) ipcRenderer.send('tab:guest-gesture', result.action, 'wheel');
  },
  { capture: true, passive: true }
);
window.addEventListener('blur', () => { resetSwipeAccumulator(); hideGesture(); });
window.addEventListener('pagehide', () => { resetSwipeAccumulator(); hideGesture(); });
