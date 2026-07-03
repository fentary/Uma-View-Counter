// lib/digits.js
// Reads the 10 digit gifs (0-9) and renders the counter as a real,
// ANIMATED gif, combining each digit's own animation side by side.
//
// How it works:
// 1) For each digit we need, we decode its source gif into raw pixel
//    frames (only once - kept in memory for next requests too, since
//    Vercel reuses "warm" function instances between calls).
// 2) We sample a fixed number of frames from each digit's animation
//    (they don't all have the same number of frames originally).
// 3) For every output frame, we glue the matching frame of each digit
//    side by side, then hand the whole stack of frames to sharp, which
//    encodes it back into a single animated gif.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const DIGIT_WIDTH = 80;
const DIGIT_HEIGHT = 150;

// Always show this many digits, padded with leading zeros.
// e.g. count = 1 -> "0000001"
const PAD_LENGTH = 7;

// How many frames to sample out of each digit's animation for the
// final output. Higher = smoother animation but bigger/slower file.
const MAX_FRAMES = 20;

// Delay between frames in the output, in centiseconds (1/100s).
// 6 = 60ms per frame, a natural speed for these sprites.
const FRAME_DELAY_CS = 6;

// Cached per digit: array of MAX_FRAMES raw RGBA buffers.
// Filled in the first time a digit is needed, reused after that for
// as long as the serverless function instance stays warm.
const framesCache = {};

async function getDigitFrames(digit) {
  if (framesCache[digit]) return framesCache[digit];

  const filePath = path.join(process.cwd(), "digits", `${digit}.gif`);
  const fileBuffer = fs.readFileSync(filePath);

  const image = sharp(fileBuffer, { animated: true });
  const metadata = await image.metadata();
  const totalPages = metadata.pages || 1;

  const { data } = await image.raw().toBuffer({ resolveWithObject: true });

  const frameByteSize = DIGIT_WIDTH * DIGIT_HEIGHT * 4;

  // Evenly sample MAX_FRAMES indices across however many frames the
  // source animation actually has.
  const sampleIndices = Array.from({ length: MAX_FRAMES }, (_, i) =>
    Math.floor((i * totalPages) / MAX_FRAMES)
  );

  const frames = sampleIndices.map((frameIndex) =>
    data.subarray(frameIndex * frameByteSize, (frameIndex + 1) * frameByteSize)
  );

  framesCache[digit] = frames;
  return frames;
}

async function buildCounterImage(rawCount) {
  const numberString = String(rawCount).padStart(PAD_LENGTH, "0");
  const digitChars = numberString.split("");

  // Only decode the digits we actually need (a counter showing
  // "0000007" only needs digit 0 and digit 7, not all ten).
  const uniqueDigits = [...new Set(digitChars)];
  const framesByDigit = {};
  for (const digit of uniqueDigits) {
    framesByDigit[digit] = await getDigitFrames(digit);
  }

  const totalWidth = DIGIT_WIDTH * digitChars.length;
  const frameByteSize = totalWidth * DIGIT_HEIGHT * 4;

  const outputFrames = [];
  for (let frameIndex = 0; frameIndex < MAX_FRAMES; frameIndex++) {
    const frameBuffer = Buffer.alloc(frameByteSize); // transparent background

    digitChars.forEach((digit, position) => {
      const digitFrame = framesByDigit[digit][frameIndex];
      const xOffsetBytes = position * DIGIT_WIDTH * 4;

      for (let row = 0; row < DIGIT_HEIGHT; row++) {
        const srcStart = row * DIGIT_WIDTH * 4;
        const destStart = row * totalWidth * 4 + xOffsetBytes;
        digitFrame.copy(frameBuffer, destStart, srcStart, srcStart + DIGIT_WIDTH * 4);
      }
    });

    outputFrames.push(frameBuffer);
  }

  const combinedRaw = Buffer.concat(outputFrames);

  const gifBuffer = await sharp(combinedRaw, {
    raw: {
      width: totalWidth,
      height: DIGIT_HEIGHT * MAX_FRAMES,
      channels: 4,
      pageHeight: DIGIT_HEIGHT,
    },
  })
    .gif({ delay: new Array(MAX_FRAMES).fill(FRAME_DELAY_CS), loop: 0 })
    .toBuffer();

  return gifBuffer;
}

function isValidName(name) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(name);
}

module.exports = { buildCounterImage, isValidName, PAD_LENGTH };
