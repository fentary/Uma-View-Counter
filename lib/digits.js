// lib/digits.js
// Reads the 10 digit gifs (0-9) from disk and renders the counter as a
// real PNG image. We switched from SVG to PNG because several platforms
// (like osu!'s profile bbcode) block SVG images for security reasons -
// PNG works everywhere.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const DIGIT_WIDTH = 80;
const DIGIT_HEIGHT = 150;

// Always show this many digits, padded with leading zeros.
// e.g. count = 1 -> "0000000001"
const PAD_LENGTH = 10;

// Cache each digit's raw file buffer in memory after the first read,
// so we don't hit the disk on every request.
const bufferCache = {};

function getDigitBuffer(digit) {
  if (!bufferCache[digit]) {
    const filePath = path.join(process.cwd(), "digits", `${digit}.gif`);
    bufferCache[digit] = fs.readFileSync(filePath);
  }
  return bufferCache[digit];
}

async function buildCounterImage(rawCount) {
  const numberString = String(rawCount).padStart(PAD_LENGTH, "0");
  const digits = numberString.split("");
  const totalWidth = DIGIT_WIDTH * digits.length;

  // sharp() only reads the first frame of a gif by default, which is
  // exactly what we want for a static PNG output.
  const composites = digits.map((digit, index) => ({
    input: getDigitBuffer(digit),
    left: index * DIGIT_WIDTH,
    top: 0,
  }));

  const buffer = await sharp({
    create: {
      width: totalWidth,
      height: DIGIT_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  return buffer;
}

function isValidName(name) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(name);
}

module.exports = { buildCounterImage, isValidName, PAD_LENGTH };
