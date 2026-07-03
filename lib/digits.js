// lib/digits.js
// Reads the 10 digit gifs (0-9) and renders the counter as a real,
// ANIMATED gif, combining each digit's own animation side by side -
// using close to the FULL original frame count and the ORIGINAL
// per-frame timing, so the speed matches the gifs you sent as
// closely as possible while still loading reasonably fast.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const DIGIT_WIDTH = 80;
const DIGIT_HEIGHT = 150;

// Always show this many digits, padded with leading zeros.
// e.g. count = 1 -> "0000001"
const PAD_LENGTH = 7;

// Upper limit on how many frames the FINAL combined gif can have.
// Your original gifs have ~180-240 frames each. Using all of them
// combined across up to 7 digits would take too long to generate on
// every single page view, so we cap it - but much higher than
// before, to stay close to the original motion speed.
const MAX_OUTPUT_FRAMES = 90;

// Cached per digit, kept in memory for as long as the serverless
// function instance stays warm, so repeat requests skip re-reading
// and re-decoding the gif file from disk entirely.
const digitCache = {};

async function getDigitData(digit) {
  if (digitCache[digit]) return digitCache[digit];

  const filePath = path.join(process.cwd(), "digits", `${digit}.gif`);
  const fileBuffer = fs.readFileSync(filePath);

  const image = sharp(fileBuffer, { animated: true });
  const metadata = await image.metadata();
  const pages = metadata.pages || 1;
  const delays = metadata.delay && metadata.delay.length === pages
    ? metadata.delay
    : new Array(pages).fill(33);

  const { data } = await image.raw().toBuffer({ resolveWithObject: true });
  const frameByteSize = DIGIT_WIDTH * DIGIT_HEIGHT * 4;

  digitCache[digit] = { data, pages, delays, frameByteSize };
  return digitCache[digit];
}

async function buildCounterImage(rawCount) {
  const numberString = String(rawCount).padStart(PAD_LENGTH, "0");
  const digitChars = numberString.split("");
  const uniqueDigits = [...new Set(digitChars)];

  const digitData = {};
  for (const digit of uniqueDigits) {
    digitData[digit] = await getDigitData(digit);
  }

  // Use whichever digit has the most frames as the "timeline" -
  // its own original per-frame timing drives the whole animation,
  // exactly as it was in the file you sent.
  const referenceDigit = uniqueDigits.reduce((a, b) =>
    digitData[a].pages >= digitData[b].pages ? a : b
  );
  const referencePages = digitData[referenceDigit].pages;
  const outputFrameCount = Math.min(referencePages, MAX_OUTPUT_FRAMES);

  const sampleIndices = Array.from({ length: outputFrameCount }, (_, i) =>
    Math.floor((i * referencePages) / outputFrameCount)
  );

  const totalWidth = DIGIT_WIDTH * digitChars.length;
  const frameByteSize = totalWidth * DIGIT_HEIGHT * 4;

  const outputFrames = [];
  const delays = [];

  for (const refIndex of sampleIndices) {
    const frameBuffer = Buffer.alloc(frameByteSize); // transparent background

    digitChars.forEach((digit, position) => {
      const dd = digitData[digit];
      // Keep every digit in sync proportionally to the reference
      // digit's position in its own animation.
      const localIndex = Math.floor((refIndex * dd.pages) / referencePages);
      const src = dd.data.subarray(
        localIndex * dd.frameByteSize,
        (localIndex + 1) * dd.frameByteSize
      );
      const xOffsetBytes = position * DIGIT_WIDTH * 4;

      for (let row = 0; row < DIGIT_HEIGHT; row++) {
        const srcStart = row * DIGIT_WIDTH * 4;
        const destStart = row * totalWidth * 4 + xOffsetBytes;
        src.copy(frameBuffer, destStart, srcStart, srcStart + DIGIT_WIDTH * 4);
      }
    });

    outputFrames.push(frameBuffer);
    // The exact delay this frame had in the original file - untouched.
    delays.push(digitData[referenceDigit].delays[refIndex] || 33);
  }

  const combinedRaw = Buffer.concat(outputFrames);

  const gifBuffer = await sharp(combinedRaw, {
    raw: {
      width: totalWidth,
      height: DIGIT_HEIGHT * outputFrames.length,
      channels: 4,
      pageHeight: DIGIT_HEIGHT,
    },
  })
    .gif({ delay: delays, loop: 0 })
    .toBuffer();

  return gifBuffer;
}

function isValidName(name) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(name);
}

module.exports = { buildCounterImage, isValidName, PAD_LENGTH };
