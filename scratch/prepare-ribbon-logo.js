// Use the white rounded tile as the icon boundary. Remove the surrounding
// black presentation matte while keeping the dark ribbon inside the tile.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'assets');
const source = path.join(assets, 'brand', 'null-logo-source.png');
const edgeInset = 2;
async function bounds(input, threshold = 32) {
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const at = (y * info.width + x) * info.channels;
    if (Math.max(data[at], data[at + 1], data[at + 2]) > threshold) {
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (right < left) throw new Error('No visible logo in selected image');
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

async function tileOutline(input, box) {
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const points = [];
  for (let y = box.top; y < box.top + box.height; y++) {
    let first = -1, last = -1;
    for (let x = box.left; x < box.left + box.width; x++) {
      const at = (y * info.width + x) * info.channels;
      if (Math.max(data[at], data[at + 1], data[at + 2]) <= 32) continue;
      if (first < 0) first = x;
      last = x;
    }
    if (first >= 0) points.push([first - box.left, y - box.top], [last - box.left, y - box.top]);
  }
  // The tile is convex. Its outer hull preserves black folds even where they
  // touch the background, unlike removing all connected black pixels.
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const lower = [], upper = [];
  for (const point of points) {
    while (lower.length > 1 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  for (let i = points.length - 1; i >= 0; i--) {
    const point = points[i];
    while (upper.length > 1 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  // The source was flattened onto black. Its first edge pixels contain that
  // matte, so move the alpha boundary just inside the clean white surface.
  const insetHull = hull.map((point, i) => {
    const previous = hull[(i + hull.length - 1) % hull.length], next = hull[(i + 1) % hull.length];
    const normal = (a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
      return [-dy / length, dx / length];
    };
    const a = normal(previous, point), b = normal(point, next);
    const scale = edgeInset / (1 + a[0] * b[0] + a[1] * b[1]);
    return [point[0] + 0.5 + (a[0] + b[0]) * scale, point[1] + 0.5 + (a[1] + b[1]) * scale];
  });
  return Buffer.from(`<svg width="${box.width}" height="${box.height}" xmlns="http://www.w3.org/2000/svg"><polygon points="${insetHull.map(p => p.join(',')).join(' ')}" fill="white"/></svg>`);
}
async function main() {
  fs.mkdirSync(path.dirname(source), { recursive: true });
  if (process.argv[2]) fs.copyFileSync(path.resolve(process.argv[2]), source);
  const original = fs.readFileSync(source), metadata = await sharp(original).metadata();
  if (metadata.width !== metadata.height) throw new Error('The supplied logo canvas must be square');
  const box = await bounds(original);
  const cropped = await sharp(original).extract(box).ensureAlpha()
    .composite([{ input: await tileOutline(original, box), blend: 'dest-in' }]).png().toBuffer();
  const output = await sharp(cropped).trim({ background: '#00000000', threshold: 0 }).resize(1024, 1024, {
    fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  const final = await bounds(output);
  const margins = { left: final.left, right: 1024 - final.left - final.width,
    top: final.top, bottom: 1024 - final.top - final.height };
  if (Math.abs(margins.left - margins.right) > 1 || Math.abs(margins.top - margins.bottom) > 1) throw new Error('Logo is not centered');
  fs.writeFileSync(path.join(assets, 'icon.png'), output);
  const report = { sourceFile: 'assets/brand/null-logo-source.png',
    sourceSha256: crypto.createHash('sha256').update(original).digest('hex'),
    originalDimensions: { width: metadata.width, height: metadata.height },
    sourceBounds: box, crop: box, matteEdgeInsetSourcePx: edgeInset, transparentOutsideWhiteTile: true, outputDimensions: { width: 1024, height: 1024 },
    outputBounds: final, margins,
    maxCenterErrorPx: Math.max(Math.abs(margins.left - margins.right), Math.abs(margins.top - margins.bottom)) / 2,
    masterBytes: output.length,
    method: 'Crop to the white tile; inset its convex alpha boundary by two source pixels to exclude black-matted edges; preserve internal dark ribbon; trim transparent padding, uniformly scale and center.' };
  fs.writeFileSync(path.join(assets, 'brand', 'null-logo-layout.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('NULL_LOGO_LAYOUT=' + JSON.stringify(report));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { bounds, tileOutline };
