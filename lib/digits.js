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

async function buildImageForNumber(rawCount, options = {}) {
  const { pad = true } = options;
  const numberString = pad ? String(rawCount).padStart(PAD_LENGTH, "0") : String(rawCount);
  const digitChars = numberString.split("");
  const uniqueDigits = [...new Set(digitChars)];

  const digitData = {};
  for (const digit of uniqueDigits) {
    digitData[digit] = await getDigitData(digit);
  }

  // Real fix, no shortcuts: instead of forcing every digit onto a
  // single "leader" digit's frame numbers (which stretched/squeezed
  // the other digits and caused slow-looking moments), we build a
  // shared timeline out of the ACTUAL millisecond timestamps where
  // each digit changes frame in its own original file. Every digit
  // then simply shows whichever of its own frames is "current" at
  // each of those timestamps - exactly the pose and timing it would
  // have if you opened that single gif by itself.
  const cumulative = {}; // digit -> [0, t1, t2, ..., totalDuration]
  const totalDuration = {}; // digit -> total ms for one full native loop
  for (const digit of uniqueDigits) {
    const dd = digitData[digit];
    const cum = [0];
    for (let i = 0; i < dd.pages; i++) cum.push(cum[i] + dd.delays[i]);
    cumulative[digit] = cum;
    totalDuration[digit] = cum[dd.pages];
  }

  // We play for as long as the SLOWEST digit's one full native loop
  // takes, so that digit completes a perfectly authentic, untouched
  // cycle. Shorter-looping digits simply repeat within that window,
  // also at their own real speed.
  const targetDuration = Math.max(...uniqueDigits.map((d) => totalDuration[d]));

  // Collect every real frame-change timestamp, from every digit,
  // repeated as many times as needed to fill the target duration.
  const boundarySet = new Set([0]);
  for (const digit of uniqueDigits) {
    const cum = cumulative[digit];
    const loopLength = totalDuration[digit];
    if (loopLength <= 0) continue;
    for (let base = 0; base < targetDuration; base += loopLength) {
      for (const t of cum) {
        const absoluteT = base + t;
        if (absoluteT < targetDuration) boundarySet.add(Math.round(absoluteT));
      }
    }
  }
  boundarySet.add(Math.round(targetDuration));

  let boundaries = [...boundarySet].sort((a, b) => a - b);

  // Safety cap (still controlled by COUNTER_MAX_FRAMES in Vercel, if
  // you ever set it). Normally not needed - your gifs are small
  // enough that every real frame-change event fits comfortably. This
  // only kicks in if a future combination of gifs ever produced an
  // unreasonably large number of events.
  if (boundaries.length - 1 > MAX_OUTPUT_FRAMES) {
    const step = (boundaries.length - 1) / MAX_OUTPUT_FRAMES;
    const sampled = Array.from({ length: MAX_OUTPUT_FRAMES + 1 }, (_, i) =>
      boundaries[Math.min(boundaries.length - 1, Math.round(i * step))]
    );
    boundaries = [...new Set(sampled)];
  }

  // Given a real elapsed time, find which frame of ITS OWN animation
  // this digit should be showing right now (wrapping around if this
  // digit's loop is shorter than the target duration).
  function frameIndexAtTime(digit, elapsedMs) {
    const dd = digitData[digit];
    const loopLength = totalDuration[digit];
    const t = loopLength > 0 ? elapsedMs % loopLength : 0;
    const cum = cumulative[digit];
    // cum is sorted; find the last index i where cum[i] <= t
    let lo = 0, hi = dd.pages - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (cum[mid] <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  const totalWidth = DIGIT_WIDTH * digitChars.length;
  const frameByteSize = totalWidth * DIGIT_HEIGHT * 4;

  const outputFrames = [];
  const delays = [];

  for (let b = 0; b < boundaries.length - 1; b++) {
    const t = boundaries[b];
    const nextT = boundaries[b + 1];
    const delay = nextT - t;
    if (delay <= 0) continue;

    const frameBuffer = Buffer.alloc(frameByteSize); // transparent background

    digitChars.forEach((digit, position) => {
      const dd = digitData[digit];
      const frameIndex = frameIndexAtTime(digit, t);
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

    outputFrames.push(frameBuffer);
    delays.push(delay);
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

// Kept for the view counter routes, which always want 7 zero-padded digits.
async function buildCounterImage(rawCount) {
  return buildImageForNumber(rawCount, { pad: true });
}

module.exports = { buildCounterImage, buildImageForNumber, isValidName, PAD_LENGTH };
