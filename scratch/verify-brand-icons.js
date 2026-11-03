// Compare exported icon pixels with the centered user-selected PNG. Does not change
// installed applications, caches, user profiles or release repositories.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');
const crypto = require('node:crypto');
const { bounds } = require('./prepare-ribbon-logo');
const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'assets');
const master = fs.readFileSync(path.join(assets, 'icon.png'));
async function pixels(input, size) {
  return sharp(input).resize(size, size).ensureAlpha().raw().toBuffer();
}
async function check(input, size, label) {
  const info = await sharp(input).metadata();
  assert.equal(info.width, size, label + ' width');
  assert.equal(info.height, size, label + ' height');
  assert.deepEqual(await pixels(input, size), await pixels(master, size), label + ' differs from PNG master');
}
async function checkLegacyIcns(input, size) {
  const actual = await pixels(input, size), expected = await pixels(master, size);
  assert.equal(actual.length, expected.length);
  // iconutil converts the 16px representation to legacy ARGB. Its extracted
  // partial-alpha RGB values are un/premultiplied, not byte-identical PNG RGB.
  // Verify the exact alpha silhouette and opaque artwork instead of claiming
  // byte equality for that native format conversion.
  for (let at = 0; at < actual.length; at += 4) {
    assert.equal(actual[at + 3], expected[at + 3], 'ICNS alpha geometry');
    if (expected[at + 3] === 255) for (let channel = 0; channel < 3; channel++) {
      assert.ok(Math.abs(actual[at + channel] - expected[at + channel]) <= 1, 'ICNS opaque artwork');
    }
  }
}
(async () => {
  const metadata = await sharp(master).metadata();
  assert.equal(metadata.width, 1024); assert.equal(metadata.height, 1024);
  const layout = JSON.parse(fs.readFileSync(path.join(assets, 'brand', 'null-logo-layout.json'), 'utf8'));
  const source = fs.readFileSync(path.join(assets, 'brand', 'null-logo-source.png'));
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'), layout.sourceSha256);
  if (process.argv[2]) assert.deepEqual(source, fs.readFileSync(process.argv[2]), 'selected original was changed');
  const visible = await bounds(master);
  assert.equal(visible.left, 1024 - visible.left - visible.width, 'horizontal center');
  assert.equal(visible.top, 1024 - visible.top - visible.height, 'vertical center');
  const exports = [];
  for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
    const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
    await check(path.join(assets, 'icon.iconset', name), size * scale, name);
    exports.push(name);
  }
  await check(path.join(assets, 'icon-preview.png'), 512, 'preview');
  const ico = fs.readFileSync(path.join(assets, 'icon.ico'));
  assert.equal(ico.readUInt16LE(2), 1);
  const count = ico.readUInt16LE(4);
  assert.equal(count, 7);
  const icoSizes = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16, size = ico[at] || 256;
    const length = ico.readUInt32LE(at + 8), offset = ico.readUInt32LE(at + 12);
    assert.ok(offset >= 6 + count * 16 && offset + length <= ico.length);
    await check(ico.subarray(offset, offset + length), size, 'ICO ' + size);
    icoSizes.push(size);
  }
  let icnsSizes = [];
  if (process.platform === 'darwin') {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'null-icon-qa-'));
    const extracted = path.join(temp, 'verified.iconset');
    execFileSync('iconutil', ['-c', 'iconset', path.join(assets, 'icon.icns'), '-o', extracted]);
    for (const [name, size] of [['icon_16x16.png', 16], ['icon_128x128.png', 128], ['icon_512x512@2x.png', 1024]]) {
      if (size === 16) await checkLegacyIcns(path.join(extracted, name), size);
      else await check(path.join(extracted, name), size, 'ICNS ' + size);
      icnsSizes.push(size);
    }
    console.log('ICNS pixel verification: ' + extracted);
  }
  console.log('NULL_ICON_QA=' + JSON.stringify({ ok: true, pngExports: exports.length, icoSizes, icnsSizes,
    originalSourceHash: layout.sourceSha256, originalUnchanged: true, centeredSilhouette: visible, singlePngMaster: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });
