// Called by the owned packaged QA process before any mock is installed.
// Uses a dummy key and the app's actual OS crypto identity, then removes it.
exports.run = async compiledVault => {
  const { app } = require('electron');
  const fs = require('node:fs/promises'), path = require('node:path');
  const filename = path.join(app.getPath('userData'), 'ai-keychain-probe.json');
  const { AIVault } = require(compiledVault);
  const vault = new AIVault(filename);
  const key = 'qa-probe-not-a-real-api-key-123456789';
  try {
    await vault.saveKey('probe', 'groq', key, true);
    const matches = await vault.key('probe', 'groq') === key;
    const encrypted = !(await fs.readFile(filename,'utf8')).includes(key);
    await vault.removeKey('probe','groq');
    return { ok: matches && encrypted, realOSStorage: true, encrypted, dummyCredential: true };
  } catch (error) { return { ok: false, realOSStorage: true, dummyCredential: true, error: error.message }; }
  finally { await fs.rm(filename, { force: true }); }
};
