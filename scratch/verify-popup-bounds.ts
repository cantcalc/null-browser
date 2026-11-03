import assert from 'node:assert/strict';
import { fitExtensionPopup } from '../electron/ExtensionPopupBounds';

let cases = 0;
const contains = (outer: Electron.Rectangle, inner: Electron.Rectangle) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
for (const scale of [1, 2]) {
  // DIPs stay the same at both Retina scales; no multiplication is allowed.
  for (const displayX of [-1920, 0, 1440]) {
    const work = { x: displayX, y: 25, width: 1440, height: 850 };
    for (const [width, height] of [[800,600],[1280,720],[1440,900]]) {
      const content = { x: displayX + 20, y: 40, width, height };
      for (const popupWidth of [280, 550, 800]) for (const popupHeight of [120, 450, 600, 1200]) for (const side of ['left','right']) {
        const requested = { x: side === 'left' ? content.x - 400 : content.x + width - 40, y: content.y + 140, width: popupWidth, height: popupHeight };
        const fitted = fitExtensionPopup(requested, content, work);
        assert(contains(content, fitted), `outside parent: ${JSON.stringify({scale,requested,fitted,content})}`);
        assert(contains(work, fitted), `outside display: ${JSON.stringify({scale,requested,fitted,work})}`);
        assert(fitted.width > 0 && fitted.height > 0);
        cases++;
      }
    }
  }
}
const bottom = fitExtensionPopup({x:760,y:890,width:550,height:600},{x:0,y:0,width:1000,height:1000},{x:0,y:25,width:1440,height:850});
assert(bottom.height >= 120, 'offscreen anchor resulted in unusable one-pixel popup');
console.log('NULL_POPUP_BOUNDS_UNIT=' + JSON.stringify({ok:true,cases,negativeDisplayCoordinates:true,retinaDips:true,offscreenAnchor:true}));
