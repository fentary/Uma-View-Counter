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

  // IMPORTANT: every digit is sampled independently down to the same
  // fixed frame count, based only on MAX_OUTPUT_FRAMES. We used to
  // pick whichever digit had the most original frames as a "leader"
  // to drive timing, but that made digits like 7 and 8 (which have
  // way more original frames than the rest) change the whole
  // animation's rhythm whenever they showed up - causing the
  // "speeds up on 7/8, normal on 9" glitch. Sampling everyone the
  // same fixed way, regardless of which digits appear, fixes that.
  const sampledByDigit = {};
  for (const digit of uniqueDigits) {
    const dd = digitData[digit];
    const frameCount = Math.min(MAX_OUTPUT_FRAMES, dd.pages);
    // Sample so that index 0 always lands on the TRUE first frame and
    // the last sampled index always lands on the TRUE last frame of
    // the original animation. The previous formula (i * pages / frameCount)
    // never actually reached the final frame, which cut off the last
    // bit of motion that the gif needs to loop back to frame 0 smoothly
    // - that's what made the start/end feel "different" from the
    // original file.
    const indices =
      frameCount === 1
        ? [0]
        : Array.from({ length: frameCount }, (_, i) =>
            Math.round((i * (dd.pages - 1)) / (frameCount - 1))
          );
    sampledByDigit[digit] = indices;
  }

  // In the rare case a digit has fewer original frames than
  // MAX_OUTPUT_FRAMES, everyone lines up to the shortest list so
  // every digit still has a matching frame at each output index.
  const outputFrameCount = Math.min(
    ...uniqueDigits.map((d) => sampledByDigit[d].length)
  );

  const totalWidth = DIGIT_WIDTH * digitChars.length;
  const frameByteSize = totalWidth * DIGIT_HEIGHT * 4;

  const outputFrames = [];
  const delays = [];

  for (let f = 0; f < outputFrameCount; f++) {
    const frameBuffer = Buffer.alloc(frameByteSize); // transparent background
    let delaySum = 0;

    digitChars.forEach((digit, position) => {
      const dd = digitData[digit];
      const frameIndex = sampledByDigit[digit][f];
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

    // Average the original delay across the unique digits present,
    // at their own matching sampled frame - stays consistent no
    // matter which digits happen to be in this particular count.
    uniqueDigits.forEach((digit) => {
      const dd = digitData[digit];
      const frameIndex = sampledByDigit[digit][f];
      delaySum += dd.delays[frameIndex] || 33;
    });
    delays.push(Math.round(delaySum / uniqueDigits.length));

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
