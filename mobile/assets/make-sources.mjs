// Builds the icon and splash sources in this folder from the web app's PWA
// icon (public/android-chrome-512x512.png): the four suits on a cream card
// on the felt. `npm run assets` (in mobile/) turns them into every native
// size. Re-run this only if the art changes: node assets/make-sources.mjs
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const here = (f) => fileURLToPath(new URL(f, import.meta.url));
const src = here("../../public/android-chrome-512x512.png");

// Colours from src/index.css.
const FELT = "#0a2a21";
const CARD = "#f4ecd9";
const GOLD = "#c8a24a";
const CREAM_BG = "#ece2c8"; // light-theme background
const INK = [0x15, 0x13, 0x10];
const RED = [0xc8, 0x3a, 0x2a];

// The PWA icon is 512px with a faint hatch in its transparent area. Scale it
// up 4x, drop the hatch and recolour the suits, so edges stay crisp at any
// size. Returns a transparent 2048px PNG buffer.
async function art() {
  const { data, info } = await sharp(src)
    .resize(2048, 2048, { kernel: "lanczos3" })
    .blur(1.2)
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const alpha = Math.min(1, Math.max(0, (data[i + 3] - 90) / 70));
    const [r, g, b] = data[i] > data[i + 1] + 40 ? RED : INK;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = Math.round(alpha * 255);
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

// The card: rounded cream square with a gold edge and the suits inside.
async function card(size, artSize, radius) {
  const edge = Math.max(4, Math.round(size / 70));
  const shape = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect x="${edge / 2}" y="${edge / 2}" width="${size - edge}" height="${
        size - edge
      }" rx="${radius}" fill="${CARD}" stroke="${GOLD}" stroke-width="${edge}"/></svg>`
  );
  const suits = await sharp(await art())
    .resize(artSize, artSize)
    .toBuffer();
  const offset = Math.round((size - artSize) / 2);
  return sharp(shape)
    .composite([{ input: suits, left: offset, top: offset }])
    .png()
    .toBuffer();
}

// `bg` null = transparent. Drops the alpha channel when it's an opaque icon.
async function place(file, canvas, bg, cardBuf, cardSize, opaque) {
  const offset = Math.round((canvas - cardSize) / 2);
  let img = sharp({
    create: {
      width: canvas,
      height: canvas,
      channels: 4,
      background: bg ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([{ input: cardBuf, left: offset, top: offset }]);
  if (opaque) img = img.flatten({ background: bg }).removeAlpha();
  await img.png().toFile(here(file));
}

// iOS (and old Android) icon: full bleed, no transparency.
await place("icon-only.png", 1024, FELT, await card(720, 560, 150), 720, true);
// Android adaptive icon: the card stays inside the 66% safe circle.
await place("icon-foreground.png", 1024, null, await card(540, 420, 120), 540);
await sharp({
  create: { width: 1024, height: 1024, channels: 3, background: FELT },
})
  .png()
  .toFile(here("icon-background.png"));
// Splash screens (light and dark theme).
const logo = await card(640, 500, 140);
await place("splash.png", 2732, CREAM_BG, logo, 640, true);
await place("splash-dark.png", 2732, FELT, logo, 640, true);
