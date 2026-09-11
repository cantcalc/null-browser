const assert = require('assert');
const { buildSync } = require('esbuild');
const fs = require('fs');
const os = require('os');
const path = require('path');

const compiledPath = path.join(os.tmpdir(), `aero-navigation-parser-${process.pid}.cjs`);
buildSync({
  absWorkingDir: path.join(__dirname, '..'),
  entryPoints: ['src/utils/navigationParser.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: compiledPath,
});

try {
  const { parseNavigationInput } = require(compiledPath);
  const options = {
    searchEngine: 'duckduckgo',
    customSearchUrl: 'https://search.example.test/?q=%s',
    searchShortcuts: [
      { keyword: 'g', name: 'Google', searchUrl: 'https://www.google.com/search?q=%s' },
    ],
  };

  assert.deepStrictEqual(parseNavigationInput('', options), {
    url: 'aero://newtab',
    type: 'internal',
    originalQuery: '',
  });
  assert.strictEqual(parseNavigationInput('g electron', options).type, 'shortcut');
  assert.strictEqual(parseNavigationInput('g electron', options).url, 'https://www.google.com/search?q=electron');
  assert.strictEqual(parseNavigationInput('localhost:5173/app', options).url, 'http://localhost:5173/app');
  assert.strictEqual(parseNavigationInput('192.168.0.10:8080/path', options).type, 'url');
  assert.strictEqual(parseNavigationInput('example.test/docs', options).url, 'https://example.test/docs');
  assert.strictEqual(parseNavigationInput('https://', options).type, 'search');
  assert.strictEqual(parseNavigationInput('localhost:99999', options).type, 'search');
  assert.strictEqual(parseNavigationInput('javascript:alert(1)', options).type, 'search');
  assert.strictEqual(
    parseNavigationInput('hello world', { ...options, searchEngine: 'custom' }).url,
    'https://search.example.test/?q=hello%20world'
  );

  console.log('--- TEST PASSED: navigation parser regression cases ---');
} finally {
  fs.rmSync(compiledPath, { force: true });
}
