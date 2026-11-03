// Deterministic exports of the selected, centered logo PNG (one design).
// Use a development copy of sharp, e.g. the desktop bundled NODE_PATH runtime.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'assets');
const master = fs.readFileSync(path.join(assets, 'icon.png'));
async function render(size) { return sharp(master).resize(size, size).png().toBuffer(); }
async function run() {
  const iconset = path.join(assets, 'icon.iconset');
  fs.mkdirSync(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    fs.writeFileSync(path.join(iconset, `icon_${size}x${size}.png`), await render(size));
    fs.writeFileSync(path.join(iconset, `icon_${size}x${size}@2x.png`), await render(size * 2));
  }
  fs.writeFileSync(path.join(assets, 'icon-preview.png'), await render(512));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = await Promise.all(sizes.map(render));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  images.forEach((bytes, index) => {
    const at = 6 + index * 16, size = sizes[index];
    header[at] = header[at + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(bytes.length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += bytes.length;
  });
  fs.writeFileSync(path.join(assets, 'icon.ico'), Buffer.concat([header, ...images]));
  if (process.platform === 'darwin') execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(assets, 'icon.icns')]);
  console.log('Centered NULL logo master exported to PNG iconset, preview, ICO and macOS ICNS.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
