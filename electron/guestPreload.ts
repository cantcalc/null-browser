import { ipcRenderer } from 'electron';

// The browser owns horizontal back/forward gestures. Prevent Chromium's
// native edge overscroll animation from competing with that gesture path.
function disableNativeHorizontalOverscroll() {
  const style = document.createElement('style');
  style.id = '__aero_horizontal_gesture_guard';
  style.textContent = 'html, body { overscroll-behavior-x: none !important; }';
  (document.head || document.documentElement)?.appendChild(style);
}

disableNativeHorizontalOverscroll();

// 1. Mouse Side Buttons (Button 3 = Back, Button 4 = Forward) & Middle-click on Links
// Handle side buttons on pointerdown so navigation starts immediately and the
// page cannot consume the same button as a native gesture.
function handleSideButtons(e: PointerEvent) {
  const action = e.button === 3 ? 'back' : e.button === 4 ? 'forward' : null;
  if (!action) return;
  e.preventDefault();
  e.stopPropagation();
  ipcRenderer.send('tab:guest-gesture', action);
}

window.addEventListener(
  'auxclick',
  (e: MouseEvent) => {
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
// Use one pointer event path only. Listening to mouseup, pointerup and
// auxclick together sends duplicate back/forward commands on many mice.
window.addEventListener('pointerdown', handleSideButtons, true);

// 2. Trackpad Horizontal Swipe Back / Forward
let lastSwipeTime = 0;
let swipeDeltaX = 0;
let swipeDeltaY = 0;
let swipeDirection = 0;
let swipeResetTimer: ReturnType<typeof setTimeout> | null = null;

function resetSwipeAccumulator() {
  swipeDeltaX = 0;
  swipeDeltaY = 0;
  swipeDirection = 0;
  if (swipeResetTimer) {
    clearTimeout(swipeResetTimer);
    swipeResetTimer = null;
  }
}

window.addEventListener(
  'wheel',
  (e: WheelEvent) => {
    if (e.ctrlKey) return;

    // Trackpads often emit a stream of small wheel deltas rather than one
    // large event. Accumulate a short, mostly-horizontal stream so light
    // swipes are not missed while vertical scrolling remains untouched.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerWidth : 1;
    const deltaX = e.deltaX * unit;
    const deltaY = e.deltaY * unit;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    if (absX < 0.5 || absX <= absY * 1.15) {
      if (absY > absX * 1.5) resetSwipeAccumulator();
      return;
    }

    const direction = Math.sign(deltaX);
    if (swipeDirection && swipeDirection !== direction) resetSwipeAccumulator();

    // Consume an edge-bound horizontal stream before Chromium's native
    // overscroll compositor can paint its transient rubber-band/flash state.
    // Vertical scrolling and horizontal scrolling away from the document edge
    // remain untouched.
    const scrollingElement = document.scrollingElement || document.documentElement;
    const scrollLeft = scrollingElement.scrollLeft || 0;
    const maxScroll = Math.max(0, scrollingElement.scrollWidth - scrollingElement.clientWidth);
    const atBackEdge = direction < 0 && scrollLeft <= 4;
    const atForwardEdge = direction > 0 && (maxScroll <= 4 || scrollLeft >= maxScroll - 4);
    if (!atBackEdge && !atForwardEdge) {
      resetSwipeAccumulator();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    swipeDirection = direction;
    swipeDeltaX += deltaX;
    swipeDeltaY += absY;
    if (swipeResetTimer) clearTimeout(swipeResetTimer);
    swipeResetTimer = setTimeout(resetSwipeAccumulator, 180);

    const now = Date.now();
    if (now - lastSwipeTime < 650) {
      resetSwipeAccumulator();
      return;
    }

    const accumulatedX = Math.abs(swipeDeltaX);
    const isMostlyHorizontal = accumulatedX >= 56 && swipeDeltaY <= accumulatedX * 0.9;
    if (!isMostlyHorizontal) return;

    lastSwipeTime = now;
    ipcRenderer.send('tab:guest-gesture', swipeDeltaX < 0 ? 'back' : 'forward');
    resetSwipeAccumulator();
  },
  { capture: true, passive: false }
);

// 3. In-Page Selection Translation Pill & Popover Card (부분 번역)
let selectionPill: HTMLDivElement | null = null;
let selectionCard: HTMLDivElement | null = null;
let selTimer: any = null;

function removeSelectionPill() {
  if (selectionPill && selectionPill.parentNode) {
    selectionPill.parentNode.removeChild(selectionPill);
  }
  selectionPill = null;
}

function removeSelectionCard() {
  if (selectionCard && selectionCard.parentNode) {
    selectionCard.parentNode.removeChild(selectionCard);
  }
  selectionCard = null;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function checkSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) {
    removeSelectionPill();
    return;
  }
  const text = sel.toString().trim();
  if (!text || text.length < 2 || text.length > 5000) {
    removeSelectionPill();
    return;
  }

  try {
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      removeSelectionPill();
      return;
    }

    if (!selectionPill) {
      selectionPill = document.createElement('div');
      selectionPill.id = '__aero_selection_pill';
      selectionPill.style.cssText =
        'position:fixed;z-index:2147483647;display:flex;align-items:center;gap:5px;background:#141b2d;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:4px 9px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:11.5px;font-weight:500;box-shadow:0 6px 16px rgba(0,0,0,0.45);cursor:pointer;user-select:none;transition:transform 0.1s,background-color 0.15s;';
      selectionPill.innerHTML = '<span style="color:#3b82f6;font-size:12px;font-weight:bold;">文A</span> <span>한국어로 번역</span>';

      selectionPill.onmouseenter = () => {
        if (selectionPill) {
          selectionPill.style.backgroundColor = '#1e293b';
          selectionPill.style.transform = 'scale(1.03)';
        }
      };
      selectionPill.onmouseleave = () => {
        if (selectionPill) {
          selectionPill.style.backgroundColor = '#141b2d';
          selectionPill.style.transform = 'scale(1)';
        }
      };

      selectionPill.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
      };

      selectionPill.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        showSelectionCard(text, rect);
        removeSelectionPill();
      };

      document.body?.appendChild(selectionPill);
    }

    // Keep the click handler synchronized with the current selection even
    // when the existing pill DOM node is reused.
    selectionPill.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showSelectionCard(text, rect);
      removeSelectionPill();
    };

    let topPos = rect.top - 36;
    if (topPos < 10) topPos = rect.bottom + 8;
    const leftPos = Math.max(10, Math.min(window.innerWidth - 130, rect.left + rect.width / 2 - 55));

    selectionPill.style.top = `${topPos}px`;
    selectionPill.style.left = `${leftPos}px`;
  } catch {
    removeSelectionPill();
  }
}

async function showSelectionCard(text: string, anchorRect: DOMRect) {
  removeSelectionCard();

  const card = document.createElement('div');
  card.id = '__aero_selection_card';
  card.style.cssText =
    'position:fixed;z-index:2147483647;width:320px;max-width:90vw;background:#0f172a;color:#f8fafc;border:1px solid #334155;border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,0.6);font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:12px;display:flex;flex-direction:column;overflow:hidden;';

  let topPos = anchorRect.bottom + 8;
  if (topPos + 220 > window.innerHeight) {
    topPos = Math.max(10, anchorRect.top - 230);
  }
  const leftPos = Math.max(10, Math.min(window.innerWidth - 330, anchorRect.left));
  card.style.top = `${topPos}px`;
  card.style.left = `${leftPos}px`;

  card.innerHTML = [
    '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#1e293b;border-bottom:1px solid #334155;">',
    '  <div style="display:flex;align-items:center;gap:6px;">',
    '    <span style="color:#3b82f6;font-weight:bold;font-size:11px;">Aero</span>',
    '    <span style="font-weight:600;font-size:11.5px;color:#e2e8f0;">선택 번역</span>',
    '  </div>',
    '  <button id="__aero_card_close" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:13px;padding:2px 6px;border-radius:4px;display:flex;align-items:center;justify-content:center;">✕</button>',
    '</div>',
    '<div style="padding:10px 12px;display:flex;flex-direction:column;gap:8px;">',
    '  <div style="font-size:11px;color:#94a3b8;border-left:2px solid #475569;padding-left:8px;max-height:48px;overflow-y:auto;line-height:1.4;">' +
      escapeHtml(text) +
      '</div>',
    '  <div id="__aero_card_body" style="font-size:12.5px;color:#f1f5f9;line-height:1.5;min-height:36px;padding:6px 0;">',
    '    <div style="display:flex;align-items:center;gap:6px;color:#60a5fa;font-size:11.5px;">한국어로 번역 중...</div>',
    '  </div>',
    '  <div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid #1e293b;padding-top:8px;margin-top:2px;">',
    '    <div style="display:flex;gap:6px;">',
    '      <button id="__aero_card_copy" style="background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;">복사</button>',
    '      <button id="__aero_card_drawer" style="background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;">Aside에서 열기</button>',
    '    </div>',
    '    <span style="font-size:10px;color:#64748b;margin-left:auto;">Aero Translate</span>',
    '  </div>',
    '</div>',
  ].join('');

  card.onmousedown = (e) => e.stopPropagation();
  card.onclick = (e) => e.stopPropagation();

  document.body?.appendChild(card);
  selectionCard = card;

  const closeBtn = card.querySelector('#__aero_card_close') as HTMLButtonElement | null;
  if (closeBtn) closeBtn.onclick = () => removeSelectionCard();

  const drawerBtn = card.querySelector('#__aero_card_drawer') as HTMLButtonElement | null;
  if (drawerBtn) {
    drawerBtn.onclick = () => {
      ipcRenderer.send('tab:guest-drawer-translate', text);
      removeSelectionCard();
    };
  }

  try {
    const translated = await ipcRenderer.invoke('translate:text', text, 'ko');
    const body = card.querySelector('#__aero_card_body');
    if (body) {
      body.textContent = translated || text;
    }
    const copyBtn = card.querySelector('#__aero_card_copy') as HTMLButtonElement | null;
    if (copyBtn) {
      copyBtn.onclick = () => {
        void navigator.clipboard.writeText(translated || text).catch(() => {});
        copyBtn.innerText = '✓ 복사됨';
        copyBtn.style.color = '#34d399';
        setTimeout(() => {
          copyBtn.innerText = '복사';
          copyBtn.style.color = '#cbd5e1';
        }, 1500);
      };
    }
  } catch {
    const body = card.querySelector('#__aero_card_body');
    if (body) {
      body.textContent = '온라인 번역을 사용할 수 없습니다.';
      (body as HTMLElement).style.color = '#ef4444';
    }
  }
}

document.addEventListener('mouseup', () => setTimeout(checkSelection, 30));
document.addEventListener('keyup', () => setTimeout(checkSelection, 50));
document.addEventListener('selectionchange', () => {
  clearTimeout(selTimer);
  selTimer = setTimeout(checkSelection, 150);
});

document.addEventListener('mousedown', (e) => {
  if (selectionPill && !selectionPill.contains(e.target as Node)) {
    removeSelectionPill();
  }
  if (selectionCard && !selectionCard.contains(e.target as Node)) {
    removeSelectionCard();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    removeSelectionPill();
    removeSelectionCard();
  }
});
