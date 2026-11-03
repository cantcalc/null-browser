require('./signing-env.cjs');
const {execFileSync}=require('node:child_process');
// Pass dotted builder options directly; PowerShell can split -c.foo options.
execFileSync(process.execPath,[require.resolve('electron-builder/cli.js'),'--win','nsis','--x64','--publish','never','-c.extraMetadata.version=1.0.0-beta.0','-c.directories.output=update-e2e-old'],{stdio:'inherit',env:process.env});
