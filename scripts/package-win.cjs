require('./signing-env.cjs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
process.chdir(path.resolve(__dirname,'..'));
execFileSync(process.execPath,[require.resolve('electron-builder/cli.js'),'--win',...(process.argv.includes('--dir')?['--dir']:['nsis']),'--x64','--publish','never'],{stdio:'inherit',env:process.env});
