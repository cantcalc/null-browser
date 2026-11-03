// Wheel deltas are CSS pixels after deltaMode normalization, not physical
// finger travel. Keep this small, deterministic and independent of the DOM.
export const HISTORY_SWIPE = {
  distance: 40,
  preview: 6,
  idleMs: 320,
  reverseSlop: 8,
} as const;

export class HistorySwipe {
  private x = 0;
  private y = 0;
  private lastAt = -Infinity;
  private vertical = false;
  private committed = false;

  reset() {
    this.x = this.y = 0;
    this.lastAt = -Infinity;
    this.vertical = this.committed = false;
  }

  add(deltaX: number, deltaY: number, now: number) {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || !Number.isFinite(now)) return null;
    if (now - this.lastAt > HISTORY_SWIPE.idleMs) this.reset();
    this.lastAt = now;
    // One physical stream must not repeatedly navigate or turn an ordinary
    // vertical scroll into history navigation halfway through the stream.
    if (this.vertical || this.committed) return null;

    const previousDirection = Math.sign(this.x);
    if (previousDirection && Math.sign(deltaX) !== previousDirection && Math.abs(deltaX) >= HISTORY_SWIPE.reverseSlop) {
      this.x = this.y = 0;
    }
    this.x += deltaX;
    this.y += Math.abs(deltaY);
    const distance = Math.abs(this.x);
    // Judge the whole stream, not each packet. Small off-axis packets and
    // 1–2px direction jitter no longer discard a deliberate horizontal swipe.
    if (this.y >= 10 && this.y > distance * 1.5) {
      this.vertical = true;
      return null;
    }
    if (distance < HISTORY_SWIPE.preview || distance < this.y * 0.9) return null;

    const commit = distance >= HISTORY_SWIPE.distance && this.y <= distance * 1.05;
    this.committed = commit;
    return {
      action: this.x < 0 ? 'back' as const : 'forward' as const,
      progress: Math.min(1, distance / HISTORY_SWIPE.distance),
      commit,
    };
  }
}
