// scripts/prerender-sizes.js
//
// Pre-generates the "small" and "large" versions of every digit gif,
// for every digit set found under /digits. This runs ONCE (you run
// it yourself, locally or as part of deploy), instead of resizing
// frames on every single request - which is what was causing the
// "large" size to sometimes time out and show a broken image.
//
// Usage: node scripts/prerender-sizes.js

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const DIGITS_ROOT = path.join(__dirname, "..", "digits");
const SCALES = { small: 0.6, large: 1.5 };

async function resizeGif(inputPath, outputPath, scale) {
  const buffer = fs.readFileSync(inputPath);
  const image = sharp(buffer, { animated: true });
  const metadata = await image.metadata();
  const pages = metadata.pages || 1;
  const delays = metadata.delay && metadata.delay.length === pages
    ? metadata.delay
    : new Array(pages).fill(33);

  const width = metadata.width;
  const pageHeight = metadata.pageHeight || metadata.height;

  const newWidth = Math.round(width * scale);
  const newPageHeight = Math.round(pageHeight * scale);

  const { data } = await image.raw().toBuffer({ resolveWithObject: true });

  const resizedRaw = await sharp(data, {
    raw: { width, height: pageHeight * pages, channels: 4 },
  })
    .resize({ width: newWidth, height: newPageHeight * pages, fit: "fill" })
    .raw()
    .toBuffer();

  const gifBuffer = await sharp(resizedRaw, {
    raw: { width: newWidth, height: newPageHeight * pages, channels: 4, pageHeight: newPageHeight },
  })
    .gif({ delay: delays, loop: 0 })
    .toBuffer();

  fs.writeFileSync(outputPath, gifBuffer);
}

async function main() {
  const digitSets = fs.readdirSync(DIGITS_ROOT).filter((entry) => {
    const full = path.join(DIGITS_ROOT, entry);
    return fs.statSync(full).isDirectory() && !["small", "large"].includes(entry);
  });

  for (const digitSet of digitSets) {
    const setDir = path.join(DIGITS_ROOT, digitSet);
    const files = fs.readdirSync(setDir).filter((f) => f.endsWith(".gif"));
    if (files.length === 0) continue;

    for (const sizeLabel of Object.keys(SCALES)) {
      const outDir = path.join(setDir, sizeLabel);
      fs.mkdirSync(outDir, { recursive: true });

      for (const file of files) {
        const inputPath = path.join(setDir, file);
        const outputPath = path.join(outDir, file);
        await resizeGif(inputPath, outputPath, SCALES[sizeLabel]);
        console.log(`${digitSet}/${sizeLabel}/${file} done`);
      }
    }
  }

  console.log("All sizes pre-rendered.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
