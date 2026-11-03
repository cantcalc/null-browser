import assert from 'node:assert/strict';
import { HistorySwipe, HISTORY_SWIPE } from '../electron/HistorySwipe';

const checked: string[] = [];
function check(name: string, test: (swipe: HistorySwipe) => void) {
  test(new HistorySwipe()); checked.push(name);
}
check('short back / forward', swipe => {
  assert.equal(swipe.add(-40, 0, 0)?.action, 'back');
  swipe.reset(); assert.equal(swipe.add(40, 0, 0)?.action, 'forward');
});
check('early preview without navigation', swipe => {
  const cue = swipe.add(-6, 0, 0); assert.equal(cue?.commit, false); assert.equal(cue?.progress, 0.15);
});
check('slow 250ms packets accumulate', swipe => {
  assert.equal(swipe.add(-14, 0, 0)?.commit, false);
  assert.equal(swipe.add(-14, 0, 250)?.commit, false);
  assert.equal(swipe.add(-14, 0, 500)?.commit, true);
});
check('subpixel packets accumulate', swipe => {
  let result; for (let i = 0; i < 160; i++) result = swipe.add(-0.25, 0, i * 5);
  assert.equal(result?.commit, true);
});
check('diagonal horizontal intent accepted', swipe => {
  assert.equal(swipe.add(-20, 19, 0)?.commit, false);
  assert.equal(swipe.add(-20, 19, 20)?.commit, true);
});
check('small direction tremor does not erase travel', swipe => {
  swipe.add(-22, 0, 0); swipe.add(2, 1, 15);
  assert.equal(swipe.add(-20, 0, 30)?.commit, true);
});
check('off-axis packet does not erase whole stream', swipe => {
  swipe.add(-22, 0, 0); swipe.add(-2, 5, 15);
  assert.equal(swipe.add(-16, 0, 30)?.commit, true);
});
check('large intentional reversal restarts direction', swipe => {
  swipe.add(-22, 0, 0); assert.equal(swipe.add(12, 0, 15)?.action, 'forward');
  assert.equal(swipe.add(28, 0, 30)?.commit, true);
});
check('idle cancels old incomplete travel', swipe => {
  swipe.add(-24, 0, 0); assert.equal(swipe.add(-20, 0, HISTORY_SWIPE.idleMs + 1)?.commit, false);
});
check('vertical scroll locks for this stream', swipe => {
  assert.equal(swipe.add(2, 24, 0), null);
  assert.equal(swipe.add(-100, 0, 100), null);
  assert.equal(swipe.add(-40, 0, 500)?.commit, true);
});
check('one commit per uninterrupted stream', swipe => {
  assert.equal(swipe.add(-40, 0, 0)?.commit, true);
  for (let i = 1; i <= 20; i++) assert.equal(swipe.add(-40, 0, i * 100), null);
  assert.equal(swipe.add(40, 0, 2400)?.commit, true);
});
check('reset clears direction and lock', swipe => {
  swipe.add(-40, 0, 0); swipe.reset(); assert.equal(swipe.add(40, 0, 20)?.commit, true);
});
check('invalid input cannot navigate', swipe => {
  assert.equal(swipe.add(NaN, 0, 0), null); assert.equal(swipe.add(100, 0, Infinity), null);
});
console.log(JSON.stringify({ ok: true, checked, thresholds: HISTORY_SWIPE }));
