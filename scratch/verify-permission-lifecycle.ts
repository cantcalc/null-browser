import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PermissionManager } from '../electron/PermissionManager';
import type { DataManager } from '../electron/DataManager';
const wc = Object.assign(new EventEmitter(), {
  getURL: () => 'https://fixture.test/', isDestroyed: () => false,
  session: { isPersistent: () => false },
}) as unknown as Electron.WebContents;
const manager = new PermissionManager({ getPermission: () => undefined, setPermission: () => {} } as unknown as DataManager);
let callbacks = 0;
for (let i = 0; i < 30; i++) {
  manager.handlePermissionRequest(wc, 'notifications', allowed => { assert.equal(allowed, true); callbacks++; }, undefined,
    prompt => manager.resolveRequest(prompt.requestId, 'once', wc));
}
assert.equal(callbacks, 30);
assert.equal(wc.listenerCount('destroyed'), 0, 'resolved prompts retained destruction listeners');
let errors = 0;
manager.handlePermissionRequest(wc, 'media', allowed => { assert.equal(allowed, false); errors++; }, undefined, () => { throw Error('prompt failed'); });
assert.equal(errors, 1); assert.equal(wc.listenerCount('destroyed'), 0);
const ids: string[] = [];
for (let i = 0; i < 2; i++) manager.handlePermissionRequest(wc, 'geolocation', () => { errors++; }, undefined, p => ids.push(p.requestId));
assert.equal(wc.listenerCount('destroyed'), 1);
manager.resolveRequest(ids[0], 'once', wc); assert.equal(wc.listenerCount('destroyed'), 1);
wc.emit('destroyed'); assert.equal(wc.listenerCount('destroyed'), 0);
assert.equal(errors, 3);
assert.equal(manager.resolveRequest(ids[1], 'once', wc), false);
console.log(JSON.stringify({ok:true,repeatedPrompts:30,resolvedListenerCleanup:true,promptFailureExactlyOnce:true,oneListenerPerContents:true,destroyCancelsPending:true}));
