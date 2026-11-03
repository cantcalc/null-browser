require('./signing-env.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
process.chdir(root);
const builder = require.resolve('electron-builder/cli.js');
const run = (exe, args) => execFileSync(exe, args, { stdio: 'inherit', env: process.env });
run(process.execPath, [builder, '--mac', '--arm64', '--dir', '--publish', 'never']);
const app = path.join(root, 'release/mac-arm64/NULL.app');
let details = '';
try { details = execFileSync('codesign', ['-dv', '--verbose=4', app], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }); } catch (error) { details = String(error.stderr || ''); }
// codesign describes signatures on stderr even on success.
const inspected = require('node:child_process').spawnSync('codesign', ['-dv', '--verbose=4', app], { encoding: 'utf8' });
details += inspected.stderr || '';
const developerId = details.includes('Authority=Developer ID Application:');
if (!developerId) run('codesign', ['--force', '--deep', '--sign', '-', app]);
run('codesign', ['--verify', '--deep', '--strict', app]);
const assessment = require('node:child_process').spawnSync('spctl', ['--assess', '--type', 'execute', '-vv', app], { encoding: 'utf8' });
const status = { platform: 'darwin', arch: 'arm64', developerIdSigned: developerId, localAdHocOnly: !developerId, gatekeeperAccepted: assessment.status === 0, notarized: developerId && assessment.status === 0 && /Notarized Developer ID/.test(assessment.stderr || '') };
fs.writeFileSync(path.join(root, 'release/signing-status-mac.json'), JSON.stringify(status, null, 2) + '\n');
console.log('macOS signing status: ' + JSON.stringify(status));
if (!process.argv.includes('--dir')) run(process.execPath, [builder, '--mac', 'dmg', 'zip', '--arm64', '--prepackaged', app, '--publish', 'never']);
