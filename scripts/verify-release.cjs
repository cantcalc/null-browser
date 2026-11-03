const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const yaml = require('js-yaml');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const platform = process.argv[2] || process.platform;
const output = path.resolve(process.argv[3] || path.join(root, 'release'));
if (process.env.GITHUB_REF_TYPE === 'tag') assert.equal(process.env.GITHUB_REF_NAME, 'v' + pkg.version, 'Tag and package versions differ');
assert.equal(pkg.build.publish.provider, 'github'); assert.equal(pkg.build.publish.owner, 'cantcalc'); assert.equal(pkg.build.publish.repo, 'null-browser');
const names = fs.readdirSync(output);
const metadata = names.filter(n => /^(latest|beta|alpha)(-mac)?\.yml$/.test(n) && (platform === 'darwin' ? n.endsWith('-mac.yml') : !n.endsWith('-mac.yml')));
assert(metadata.length, 'No updater metadata');
const referenced = new Set();
for (const name of metadata) {
  const data = yaml.load(fs.readFileSync(path.join(output, name), 'utf8'));
  assert.equal(data.version, pkg.version, 'Wrong metadata version');
  for (const file of data.files || []) {
    const filename = decodeURIComponent(file.url); assert.equal(path.basename(filename), filename, 'Unsafe artifact path');
    const bytes = fs.readFileSync(path.join(output, filename));
    assert.equal(crypto.createHash('sha512').update(bytes).digest('base64'), file.sha512, 'Artifact SHA-512 mismatch: ' + filename);
    if (file.size !== undefined) assert.equal(bytes.length, file.size, 'Artifact size mismatch');
    referenced.add(filename);
  }
  if (data.path) assert(referenced.has(decodeURIComponent(data.path)), 'Legacy metadata path differs from files');
}
for (const ext of platform === 'darwin' ? ['.dmg', '.zip'] : ['.exe']) assert([...referenced].some(n => n.endsWith(ext)), 'Missing artifact ' + ext);
const appResources = platform === 'darwin' ? path.join(output, 'mac-arm64/NULL.app/Contents/Resources') : path.join(output, 'win-unpacked/resources');
const provider = yaml.load(fs.readFileSync(path.join(appResources, 'app-update.yml'), 'utf8'));
assert.equal(provider.provider, 'github'); assert.equal(provider.owner, 'cantcalc'); assert.equal(provider.repo, 'null-browser');
const asar = require('@electron/asar');
const archive = path.join(appResources, 'app.asar');
const packed = JSON.parse(asar.extractFile(archive, 'package.json').toString()); assert.equal(packed.version, pkg.version); assert.equal(packed.name, 'null-browser');
const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const walk = directory => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(directory,e.name)) : [path.join(directory,e.name)]);
for (const filename of [...walk('dist'), ...walk('dist-electron')]) assert.equal(hash(asar.extractFile(archive, filename.replaceAll('\\','/'))), hash(fs.readFileSync(path.join(root, filename))), 'Packed source differs: ' + filename);
for (const name of ['THIRD_PARTY_NOTICES.txt','LICENSE.electron.txt','LICENSES.chromium.html']) assert(fs.statSync(path.join(appResources,'licenses',name)).size > 0, 'Missing bundled license');
const artifacts = names.filter(n => /\.(dmg|zip|exe|blockmap)$/.test(n) || /^(latest|beta|alpha)(-mac)?\.yml$/.test(n));
const manifest = { version: pkg.version, platform, sourceCommit: process.env.GITHUB_SHA || require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(), provider: {provider:provider.provider,owner:provider.owner,repo:provider.repo}, packedSourcesMatch: true, files: artifacts.map(name => ({ name, size: fs.statSync(path.join(output,name)).size, sha256: hash(fs.readFileSync(path.join(output,name))) })) };
fs.writeFileSync(path.join(output, 'artifact-manifest-' + platform + '.json'), JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({ok:true,version:pkg.version,platform,metadata,artifacts,packedSourcesMatch:true}));
