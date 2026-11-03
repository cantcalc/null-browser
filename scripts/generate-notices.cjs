const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const inventory = [], sections = [], missing = [];
for (const [location, meta] of Object.entries(lock.packages)) {
  if (!location || !location.includes('node_modules/')) continue;
  const directory = path.join(root, location);
  if (!fs.existsSync(path.join(directory, 'package.json'))) continue;
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  inventory.push({ name: pkg.name, version: pkg.version, license: pkg.license || meta.license || 'UNSPECIFIED', developmentOnly: meta.dev === true });
  if (meta.dev === true) continue;
  const licenses = fs.readdirSync(directory).filter(name => /^(licen[sc]e|copying|notice)([._-].*)?$/i.test(name) && fs.statSync(path.join(directory, name)).isFile());
  const fallback = path.join(root,'docs/licenses',pkg.name.replaceAll('/','-')+'-LICENSE.txt');
  if (!licenses.length && !fs.existsSync(fallback)) missing.push(pkg.name);
  const text = licenses.length ? licenses.map(name => `\n--- ${name} ---\n${fs.readFileSync(path.join(directory, name), 'utf8')}`).join('\n') : fs.existsSync(fallback) ? fs.readFileSync(fallback,'utf8') : '';
  sections.push(`${pkg.name} ${pkg.version}\nLicense: ${pkg.license || meta.license || 'UNSPECIFIED'}\n${text.replace(/\r\n/g,'\n').replace(/[ \t]+$/gm,'')}`);
}
if (missing.length) throw new Error('Production packages without bundled license text: ' + missing.join(', '));
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs/DEPENDENCIES.json'), JSON.stringify(inventory.sort((a,b) => a.name.localeCompare(b.name)), null, 2) + '\n');
fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.txt'), `NULL Browser — Third-party notices\n\nThe project source license is stated separately in README.md.\nApplication artwork was supplied by the project owner and is not covered by dependency licenses.\nElectron and Chromium notices are distributed alongside this file as LICENSE.electron.txt and LICENSES.chromium.html.\nThe following JavaScript dependencies retain their individual licenses and copyright notices.\n\n${sections.join('\n\n' + '='.repeat(72) + '\n\n').trimEnd()}\n`);
console.log(`Generated notices for ${sections.length} production dependencies; inventoried ${inventory.length} installed packages.`);
