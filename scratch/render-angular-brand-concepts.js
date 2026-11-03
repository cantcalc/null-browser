// Preview-only vector studies; production assets/icon.svg is not modified.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'assets', 'brand-explorations');
const concepts = [
  { name: 'CUT', file: 'angular-01-cut.svg', subtitle: 'Split geometry / a precise diagonal cut' },
  { name: 'FOLD', file: 'angular-02-fold.svg', subtitle: 'Faceted planes / a folded silhouette' },
  { name: 'WING', file: 'angular-03-wing.svg', subtitle: 'Asymmetric wings / forward motion' },
];
async function main() {
  const pieces = [];
  const labels = [];
  for (const [i, concept] of concepts.entries()) {
    const source = fs.readFileSync(path.join(dir, concept.file));
    const left = 96 + i * 440;
    const tile = await sharp(source).resize(256, 256).png().toBuffer();
    fs.writeFileSync(path.join(dir, concept.file.replace('.svg', '.png')), tile);
    pieces.push({ input: tile, left: left + 44, top: 138 });
    labels.push(`<text x="${left}" y="467" class="number">0${i + 1}</text><text x="${left + 48}" y="467" class="name">${concept.name}</text><text x="${left}" y="503" class="note">${concept.subtitle}</text>`);
    let smallX = left;
    for (const size of [16, 24, 32, 48]) {
      pieces.push({ input: await sharp(source).resize(size, size).png().toBuffer(), left: smallX, top: 582 - size });
      labels.push(`<text x="${smallX + size / 2}" y="610" text-anchor="middle" class="size">${size}</text>`);
      smallX += size + 30;
    }
  }
  const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="700"><rect width="1440" height="700" fill="#edeef1"/><style>text{font-family:Arial,Helvetica,sans-serif}.brand{font-size:28px;font-weight:700;letter-spacing:-1px;fill:#17181b}.meta{font-size:11px;letter-spacing:2px;fill:#737780}.number{font-size:18px;fill:#8a8d95}.name{font-size:27px;font-weight:700;letter-spacing:1px;fill:#18191d}.note{font-size:13px;fill:#70747d}.size{font-size:10px;fill:#8a8d95}</style><text x="96" y="69" class="brand">NULL</text><text x="1344" y="66" text-anchor="end" class="meta">ANGULAR / MONOCHROME STUDIES</text><path d="M96 94H1344" stroke="#d8dadf"/>${labels.join('')}<text x="96" y="663" class="meta">VECTOR CONCEPTS / PREVIEW ONLY</text></svg>`);
  const board = path.join(dir, 'angular-directions.png');
  await sharp(background).composite(pieces).png().toFile(board);
  console.log(JSON.stringify({ board, concepts: concepts.map(x => path.join(dir, x.file)), productionLogoUnchanged: true }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
