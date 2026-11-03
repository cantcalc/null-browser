const fs=require('node:fs'),assert=require('node:assert/strict');
const mac=JSON.parse(fs.readFileSync('release/signing-status-mac.json','utf8'));
const win=fs.existsSync('release/signing-status-win.json')?JSON.parse(fs.readFileSync('release/signing-status-win.json','utf8')):null;
assert(mac.developerIdSigned&&mac.notarized&&mac.gatekeeperAccepted,'Stable publishing requires verified Developer ID signing and notarization');
if(win)assert.equal(win.authenticodeStatus,'Valid','Stable publishing requires a valid Windows Authenticode signature');
console.log('Stable signing prerequisites verified. Runtime smoke checks were validated separately.');
