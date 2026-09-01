/**
 * Builds every FireNow brand asset from the single source mark in `brand/`.
 *
 * The mark ships as dark-green line art on white. That reads correctly on a
 * light tile and disappears on the near-black console, so the source is turned
 * into an alpha mask once and tinted twice: green for light surfaces, white for
 * dark ones. Re-run after replacing `brand/firenow.jpg`.
 *
 *     node scripts/build-brand-assets.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'brand', 'firenow.jpg');
const publicDir = join(root, 'public');
const brandDir = join(publicDir, 'brand');

const GREEN = '#1B3B1B';
const INK = '#08090A';
const MARK = 1024;

/** Alpha from luminance: the darker the ink, the more opaque the pixel. */
async function alphaMask(size) {
  return sharp(source)
    .trim({ background: '#ffffff', threshold: 18 })
    .resize(size, size, { fit: 'contain', background: '#ffffff' })
    .greyscale()
    .negate()
    // Pushes JPEG ringing around the strokes down to fully transparent.
    .linear(1.35, -22)
    .raw()
    .toBuffer();
}

async function tintedMark(size, colour) {
  const mask = await alphaMask(size);
  return sharp({ create: { width: size, height: size, channels: 3, background: colour } })
    .joinChannel(mask, { raw: { width: size, height: size, channels: 1 } })
    .png()
    .toBuffer();
}

const roundedRect = (size, radius) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`
  + `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`,
);

/** A white rounded tile carrying the green mark — the icon on any tab strip. */
async function tile(size) {
  const inner = Math.round(size * 0.62);
  const mark = await tintedMark(inner, GREEN);
  const filled = await sharp({ create: { width: size, height: size, channels: 4, background: '#FFFFFF' } })
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toBuffer();
  return sharp(filled)
    .composite([{ input: roundedRect(size, Math.round(size * 0.22)), blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function openGraph() {
  const width = 1200;
  const height = 630;
  const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <radialGradient id="glow" cx="18%" cy="26%" r="62%">
        <stop offset="0%" stop-color="#FF6B00" stop-opacity="0.20"/>
        <stop offset="100%" stop-color="#FF6B00" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="${INK}"/>
    <rect width="${width}" height="${height}" fill="url(#glow)"/>
    <text x="96" y="330" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="86" font-weight="700" fill="#F7F7F8" letter-spacing="-3">FireNow</text>
    <text x="98" y="392" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="32" fill="#9A9A9E">Agent-native wildfire command</text>
    <rect x="98" y="432" width="86" height="3" fill="#FF6B00"/>
    <text x="98" y="500" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="24" fill="#6A6A6E">21 WebMCP tools · Rothermel 1972 · training beta</text>
  </svg>`);
  const badge = await tile(148);
  return sharp(background)
    .composite([{ input: badge, top: 120, left: 96 }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

await mkdir(brandDir, { recursive: true });

const outputs = [
  [join(brandDir, 'mark.png'), await tintedMark(MARK, GREEN)],
  [join(brandDir, 'mark-light.png'), await tintedMark(MARK, '#FFFFFF')],
  [join(publicDir, 'icon-512.png'), await tile(512)],
  [join(publicDir, 'favicon-192.png'), await tile(192)],
  [join(publicDir, 'apple-touch-icon.png'), await tile(180)],
  [join(publicDir, 'favicon-32.png'), await tile(32)],
  [join(publicDir, 'og.png'), await openGraph()],
];

for (const [path, data] of outputs) {
  await writeFile(path, data);
  const { width, height } = await sharp(data).metadata();
  console.log(`${path.slice(root.length + 1)}  ${width}x${height}  ${Math.round(data.length / 1024)} kB`);
}
