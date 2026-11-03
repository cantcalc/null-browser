const assert = require('assert');
const { buildSync } = require('esbuild');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { compileFunction } = require('vm');

function verifyLegacySettings(legacyOptions) {
  const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'null-search-settings-'));
  let manager;
  try {
    const compiled = buildSync({
      absWorkingDir: path.join(__dirname, '..'),
      entryPoints: ['electron/DataManager.ts'],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
      write: false,
    }).outputFiles[0].text;
    const compiledModule = { exports: {} };
    const testRequire = (id) => id === 'electron'
      ? { app: { getPath: () => profilePath } }
      : require(id);
    compileFunction(compiled, ['require', 'module', 'exports'])(testRequire, compiledModule, compiledModule.exports);
    const { DataManager } = compiledModule.exports;

    manager = new DataManager();
    const defaults = manager.getSettings();
    assert.strictEqual('searchShortcuts' in defaults, false, 'Fresh settings must not include shortcuts');
    assert.strictEqual(defaults.homeStyle, 'center');
    for (const homeStyle of ['center', 'compact', 'elevated', 'horizontal', 'grounded']) {
      manager.updateSettings({ homeStyle });
      manager.flushSync();
      assert.strictEqual(new DataManager().getSettings().homeStyle, homeStyle, 'Home design did not survive reload');
      assert.strictEqual(manager.getSettings().interfaceStyle, 'studio', 'Home design changed the tab interface');
    }
    assert.strictEqual(manager.updateSettings({ homeStyle: 'invalid' }).homeStyle, 'center');
    assert.strictEqual(manager.importSettingsJson(JSON.stringify({ settings: { homeStyle: 'invalid', interfaceStyle: 'air' } })), true);
    assert.strictEqual(manager.getSettings().homeStyle, 'center');
    assert.strictEqual(manager.getSettings().interfaceStyle, 'air');

    const legacySettings = { ...defaults, ...legacyOptions, searchEngine: 'custom' };
    const storePath = path.join(profilePath, 'browser_store.json');
    fs.writeFileSync(storePath, JSON.stringify({ settings: legacySettings }));
    manager = new DataManager();
    const assertNormalized = (settings, engine) => {
      assert.strictEqual('searchShortcuts' in settings, false, 'Legacy shortcuts survived normalization');
      assert.strictEqual(settings.searchEngine, engine);
      assert.strictEqual(settings.customSearchUrl, legacyOptions.customSearchUrl);
    };
    assertNormalized(manager.getSettings(), 'custom');
    assertNormalized(manager.updateSettings(legacyOptions), 'duckduckgo');

    assert.strictEqual(manager.importSettingsJson(JSON.stringify({ settings: legacySettings })), true);
    assertNormalized(manager.getSettings(), 'custom');
    assertNormalized(JSON.parse(manager.exportSettingsJson()).settings, 'custom');
    manager.flushSync();
    assertNormalized(JSON.parse(fs.readFileSync(storePath, 'utf8')).settings, 'custom');
    manager = new DataManager();
    assertNormalized(manager.getSettings(), 'custom');
    assert.strictEqual('searchShortcuts' in manager.resetSettings(), false, 'Reset restored shortcuts');
  } finally {
    if (manager) manager.flushSync();
    fs.rmSync(profilePath, { recursive: true, force: true });
  }
}

const compiledPath = path.join(os.tmpdir(), `null-navigation-parser-${process.pid}.cjs`);
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
    // Legacy callers may still supply this field; the parser must ignore it.
    searchShortcuts: [
      { keyword: 'g', name: 'Google', searchUrl: 'https://www.google.com/search?q=%s' },
      { keyword: 'gh', name: 'GitHub', searchUrl: 'https://github.com/search?q=%s' },
      { keyword: 'yt', name: 'YouTube', searchUrl: 'https://www.youtube.com/results?search_query=%s' },
      { keyword: 'mdn', name: 'MDN Web Docs', searchUrl: 'https://developer.mozilla.org/search?q=%s' },
      { keyword: 'n', name: 'Naver', searchUrl: 'https://search.naver.com/search.naver?query=%s' },
    ],
  };

  assert.deepStrictEqual(parseNavigationInput('', options), {
    url: 'null://newtab',
    type: 'internal',
    originalQuery: '',
  });
  const defaultTemplates = {
    google: 'https://www.google.com/search?q=%s',
    naver: 'https://search.naver.com/search.naver?query=%s',
    duckduckgo: 'https://duckduckgo.com/?q=%s',
    bing: 'https://www.bing.com/search?q=%s',
    brave: 'https://search.brave.com/search?q=%s',
    custom: options.customSearchUrl,
  };
  for (const [searchEngine, template] of Object.entries(defaultTemplates)) {
    for (const rawInput of ['g electron', 'gh react', 'yt music', 'mdn URL', 'n 날씨', ' G  café & 한글 ', 'gh', 'hello world']) {
      const query = rawInput.trim();
      const expected = {
        url: template.replace('%s', encodeURIComponent(query)),
        type: 'search',
        originalQuery: query,
        searchQuery: query,
        searchEngine,
      };
      assert.deepStrictEqual(parseNavigationInput(rawInput, { ...options, searchEngine }), expected);
      assert.deepStrictEqual(
        parseNavigationInput(rawInput, { searchEngine, customSearchUrl: options.customSearchUrl }),
        expected,
        'Legacy shortcut options must not change the result'
      );
    }
  }
  assert.deepStrictEqual(parseNavigationInput('g electron'), {
    url: 'https://www.google.com/search?q=g%20electron',
    type: 'search',
    originalQuery: 'g electron',
    searchQuery: 'g electron',
    searchEngine: 'google',
  });
  assert.deepStrictEqual(
    parseNavigationInput('g electron', { ...options, searchShortcuts: [null, {}] }),
    parseNavigationInput('g electron', options),
    'Malformed legacy shortcuts must also be ignored'
  );

  const navigationCases = [
    ['   ', 'null://newtab', 'internal'],
    ['null://newtab', 'null://newtab', 'internal'],
    ['vyro://newtab', 'null://newtab', 'internal'],
    ['aero://newtab', 'null://newtab', 'internal'],
    ['aero://settings/sites', 'null://settings/sites', 'internal'],
    ['vyro://settings/sites', 'null://settings/sites', 'internal'],
    ['null://settings/sites', 'null://settings/sites', 'internal'],
    ['browser://newtab', 'null://newtab', 'internal'],
    ['browser://settings/search', 'null://settings/search', 'internal'],
    ['null://', 'null://newtab', 'internal'],
    ['https://example.test/docs?q=one#two', 'https://example.test/docs?q=one#two', 'url'],
    ['http://example.test/', 'http://example.test/', 'url'],
    ['file:///tmp/example.html', 'file:///tmp/example.html', 'url'],
    ['mailto:hello@example.test', 'mailto:hello@example.test', 'url'],
    ['tel:+123456789', 'tel:+123456789', 'url'],
    ['vscode://file/tmp/example.ts', 'vscode://file/tmp/example.ts', 'url'],
    ['about:blank', 'about:blank', 'url'],
    ['about:blank#fragment', 'about:blank#fragment', 'url'],
    ['localhost', 'http://localhost', 'url'],
    ['localhost:5173/app', 'http://localhost:5173/app', 'url'],
    ['localhost/app', 'http://localhost/app', 'url'],
    ['127.0.0.1:8080/path', 'http://127.0.0.1:8080/path', 'url'],
    ['192.168.0.10:8080/path', 'http://192.168.0.10:8080/path', 'url'],
    ['[::1]', 'http://[::1]', 'url'],
    ['[2001:db8::1]:8080/path', 'http://[2001:db8::1]:8080/path', 'url'],
    ['example.test/docs', 'https://example.test/docs', 'url'],
    ['example.test:8443/docs?q=one#two', 'https://example.test:8443/docs?q=one#two', 'url'],
    ['  example.test/docs  ', 'https://example.test/docs', 'url'],
  ];
  for (const [rawInput, url, type] of navigationCases) {
    assert.deepStrictEqual(parseNavigationInput(rawInput, options), {
      url,
      type,
      originalQuery: rawInput.trim(),
    });
  }

  for (const query of ['https://', 'localhost:99999', 'example.test:99999', 'javascript:alert(1)', 'data:text/html,hello']) {
    assert.deepStrictEqual(parseNavigationInput(query, options), {
      url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
      type: 'search',
      originalQuery: query,
      searchQuery: query,
      searchEngine: 'duckduckgo',
    });
  }
  assert.strictEqual(
    parseNavigationInput('gh electron', { searchEngine: 'custom', customSearchUrl: 'https://search.example.test/?q=' }).url,
    'https://search.example.test/?q=gh%20electron'
  );
  for (const customSearchUrl of ['javascript:alert(1)', 'not a URL', undefined]) {
    assert.strictEqual(
      parseNavigationInput('gh electron', { ...options, searchEngine: 'custom', customSearchUrl }).url,
      'https://www.google.com/search?q=gh%20electron'
    );
  }

  verifyLegacySettings(options);

  console.log('--- TEST PASSED: navigation parser and legacy settings regression cases ---');
} finally {
  fs.rmSync(compiledPath, { force: true });
}
