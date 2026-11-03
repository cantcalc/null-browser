const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(electron, [path.join(__dirname, 'verify-extensions.js'), ...args], {env:process.env});
    let output = '';
    child.stdout.on('data', data => { output += data.toString(); process.stdout.write(data); });
    child.stderr.on('data', data => process.stderr.write(data));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code !== 0) return reject(new Error(`Extension QA failed: code=${code}, signal=${signal}`));
      const result = output.match(/NULL_EXTENSION_QA_RESULT=(.*)/);
      if (!result) return reject(new Error('Extension QA did not report a result'));
      resolve(JSON.parse(result[1]));
    });
  });
}

(async () => {
  const installed = await run([]);
  await run([`--restore=${path.join(installed.profile, 'restart.json')}`]);
})().catch(error => { console.error(error); process.exitCode = 1; });
