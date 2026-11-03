const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const directory = path.resolve(process.argv[2] || 'release');
const version = require('../package.json').version;
const manifests = ['darwin','win32'].map(p=>JSON.parse(fs.readFileSync(path.join(directory,`artifact-manifest-${p}.json`),'utf8')));
for (const manifest of manifests) {
  assert.equal(manifest.version,version); assert(manifest.packedSourcesMatch);
  if(process.env.GITHUB_SHA)assert.equal(manifest.sourceCommit,process.env.GITHUB_SHA,'Builds are from different commits');
  assert.equal(manifest.provider.repo,'null-browser');
  for(const file of manifest.files) { assert.equal(path.basename(file.name),file.name);const bytes=fs.readFileSync(path.join(directory,file.name));assert.equal(bytes.length,file.size);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),file.sha256,'Downloaded CI artifact hash differs'); }
}
for(const platform of ['darwin','win32']) {const result=JSON.parse(fs.readFileSync(path.join(directory,`smoke-${platform}.json`),'utf8'));assert(result.ok);assert.equal(result.version,version);if(platform==='win32')assert(result.silentInstallAndUninstall);}
const files=fs.readdirSync(directory).filter(n=>fs.statSync(path.join(directory,n)).isFile()&&n!=='SHA256SUMS.txt').sort();
fs.writeFileSync(path.join(directory,'SHA256SUMS.txt'),files.map(name=>crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,name))).digest('hex')+'  '+name).join('\n')+'\n');
console.log(JSON.stringify({ok:true,version,platforms:manifests.map(m=>m.platform),files}));
