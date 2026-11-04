const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'tmp/ai-qa');
fs.mkdirSync(output, { recursive: true });
for (const [entry, name] of [['scratch/verify-ai.ts', 'verify-ai.cjs'], ['electron/guestPreload.ts', 'guestPreload.js']]) {
  buildSync({ absWorkingDir: root, entryPoints: [entry], outfile: path.join(output, name), bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'electron-chrome-extensions'] });
}
execFileSync(require('electron'), [path.join(output, 'verify-ai.cjs')], { cwd: root, stdio: 'inherit' });
