// Private New Tab uses the supplied purple tile, with the same transparent
// framing and matte-edge cleanup as the normal white logo.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { bounds, tileOutline } = require('./prepare-ribbon-logo');
const assets = path.resolve(__dirname, '../assets');
const source = path.join(assets, 'brand/null-private-logo-source.png');

async function main() {
  fs.mkdirSync(path.dirname(source), { recursive: true });
  if (process.argv[2]) fs.copyFileSync(path.resolve(process.argv[2]), source);
  const original = fs.readFileSync(source);
  const box = await bounds(original);
  const cropped = await sharp(original).extract(box).ensureAlpha()
    .composite([{ input: await tileOutline(original, box), blend: 'dest-in' }]).png().toBuffer();
  const output = await sharp(cropped).trim({ background: '#00000000', threshold: 0 })
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  const final = await bounds(output);
  const margins = { left: final.left, right: 1024 - final.left - final.width,
    top: final.top, bottom: 1024 - final.top - final.height };
  if (Math.abs(margins.left - margins.right) > 1 || Math.abs(margins.top - margins.bottom) > 1) throw new Error('Private logo is not centered');
  fs.writeFileSync(path.join(assets, 'private-logo.png'), output);
  const report = { sourceFile: 'assets/brand/null-private-logo-source.png',
    sourceSha256: crypto.createHash('sha256').update(original).digest('hex'),
    sourceBounds: box, outputBounds: final, margins, transparentOutsideTile: true,
    usage: 'Private New Tab home logo only; normal logo and application icons are unchanged.' };
  fs.writeFileSync(path.join(assets, 'brand/null-private-logo-layout.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('NULL_PRIVATE_LOGO=' + JSON.stringify(report));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
