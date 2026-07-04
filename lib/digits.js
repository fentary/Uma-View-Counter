// lib/digits.js
// Reads the 10 digit gifs (0-9) and renders the counter as a real,
// ANIMATED gif, combining each digit's own animation side by side -
// using close to the original frame count and original per-frame
// timing, so the speed matches the gifs you sent as closely as
// possible while still loading reasonably fast.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const DIGIT_WIDTH = 80;
const DIGIT_HEIGHT = 150;

// Always show this many digits, padded with leading zeros.
// e.g. count = 1 -> "0000001"
const PAD_LENGTH = 7;

// Upper limit on how many frames the FINAL combined gif can have.
// You can change this WITHOUT touching any code: in your Vercel
// project, go to Settings -> Environment Variables, add/edit
// COUNTER_MAX_FRAMES with a number (e.g. 90), then Redeploy.
//   - Higher number = closer to the original speed, but slower to load
//   - Lower number = loads faster, but more "sped up" looking
const MAX_OUTPUT_FRAMES = parseInt(process.env.COUNTER_MAX_FRAMES, 10) || 90;

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

  // Your gifs each have TWO distinct phases baked in (e.g. a faster
  // ~11-frame intro, then a slower alternating hold) - and different
  // digits switch from phase 1 to phase 2 at slightly different
  // frame numbers. Averaging delays across digits (what we tried
  // before) mixed "still in the fast phase" with "already in the
  // slow phase" at the same instant, creating a rhythm that didn't
  // match ANY of the original files.
  //
  // Instead, one digit is picked as the "leader" and dictates the
  // real, untouched timing - exactly as it plays in its own original
  // file. We pick whichever digit repeats the most in the number,
  // since with 7-digit padding that's almost always "0" - the digit
  // you'll actually be looking at most of the time.
  const occurrences = {};
  digitChars.forEach((d) => { occurrences[d] = (occurrences[d] || 0) + 1; });
  const leaderDigit = uniqueDigits.reduce((a, b) =>
    occurrences[b] > occurrences[a] ? b : a
  );
  const leaderData = digitData[leaderDigit];
  const outputFrameCount = Math.max(1, Math.min(MAX_OUTPUT_FRAMES, leaderData.pages));

  const mapToOwnRange = (outIndex, pages) =>
    outputFrameCount === 1
      ? 0
      : Math.round((outIndex * (pages - 1)) / (outputFrameCount - 1));

  const totalWidth = DIGIT_WIDTH * digitChars.length;
  const frameByteSize = totalWidth * DIGIT_HEIGHT * 4;

  const outputFrames = [];
  const delays = [];

  for (let f = 0; f < outputFrameCount; f++) {
    const frameBuffer = Buffer.alloc(frameByteSize); // transparent background

    digitChars.forEach((digit, position) => {
      const dd = digitData[digit];
      const frameIndex = mapToOwnRange(f, dd.pages);
      const src = dd.data.subarray(
        frameIndex * dd.frameByteSize,
        (frameIndex + 1) * dd.frameByteSize
      );
      const xOffsetBytes = position * DIGIT_WIDTH * 4;

      for (let row = 0; row < DIGIT_HEIGHT; row++) {
        const srcStart = row * DIGIT_WIDTH * 4;
        const destStart = row * totalWidth * 4 + xOffsetBytes;
        src.copy(frameBuffer, destStart, srcStart, srcStart + DIGIT_WIDTH * 4);
      }
    });

    // The leader digit's own real delay at this point - untouched,
    // no averaging, no blending with any other digit's timing.
    const leaderFrameIndex = mapToOwnRange(f, leaderData.pages);
    delays.push(leaderData.delays[leaderFrameIndex] || 100);

    outputFrames.push(frameBuffer);
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
