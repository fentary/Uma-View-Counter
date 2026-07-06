// lib/digits.js
// Reads digit gifs (0-9) and renders a number as a real, ANIMATED
// gif, combining each digit's own animation side by side - using a
// real merged timeline (see buildImageForNumber) so every digit
// plays at its own true original speed, no distortion.
//
// Supports more than one "digit set" (a folder of 0.gif..9.gif) -
// the view counter and the rank counter use different character
// gifs, so each has its own folder under /digits.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const NATIVE_DIGIT_WIDTH = 80;
const NATIVE_DIGIT_HEIGHT = 150;

// Always show this many digits, padded with leading zeros, for the
// view counter. e.g. count = 1 -> "000001"
const PAD_LENGTH = 6;

// Upper limit on how many frames the FINAL combined gif can have.
// You can change this WITHOUT touching any code: in your Vercel
// project, go to Settings -> Environment Variables, add/edit
// COUNTER_MAX_FRAMES with a number (e.g. 90), then Redeploy.
// This is a safety cap and normally doesn't kick in at all - see
// buildImageForNumber for how frame timing actually works.
const MAX_OUTPUT_FRAMES = parseInt(process.env.COUNTER_MAX_FRAMES, 10) || 90;

// The three selectable display sizes, as a scale factor relative to
// the native 80x150 sprite size.
const SIZE_SCALES = { small: 0.6, medium: 1, large: 1.5 };

// Bigger images cost noticeably more time to encode as an animated
// gif (not just proportionally - there's a real jump once frames get
// much wider). To keep "large" loading in a reasonable time, we cap
// how many frames it's allowed to use a bit more strictly than the
// other sizes. This only trades a little smoothness for speed - the
// overall timing/duration logic is unaffected.
const SIZE_FRAME_CAPS = { small: 90, medium: 90, large: 40 };

function resolveDigitFolder(digitSet) {
  // "view" -> /digits/view, "rank" -> /digits/rank
  return path.join(process.cwd(), "digits", digitSet);
}

// Cached per (digitSet:digit:scale), kept in memory for as long as
// the serverless function instance stays warm.
const digitCache = {};

async function getDigitData(digitSet, digit, scale) {
  const cacheKey = `${digitSet}:${digit}:${scale}`;
  if (digitCache[cacheKey]) return digitCache[cacheKey];

  const filePath = path.join(resolveDigitFolder(digitSet), `${digit}.gif`);
  const fileBuffer = fs.readFileSync(filePath);

  const image = sharp(fileBuffer, { animated: true });
  const metadata = await image.metadata();
  const pages = metadata.pages || 1;
  const delays = metadata.delay && metadata.delay.length === pages
    ? metadata.delay
    : new Array(pages).fill(33);

  const { data: nativeData } = await image.raw().toBuffer({ resolveWithObject: true });
  const nativeFrameByteSize = NATIVE_DIGIT_WIDTH * NATIVE_DIGIT_HEIGHT * 4;

  const width = Math.round(NATIVE_DIGIT_WIDTH * scale);
  const height = Math.round(NATIVE_DIGIT_HEIGHT * scale);
  const frameByteSize = width * height * 4;

  let data;
  if (scale === 1) {
    data = nativeData;
  } else {
    // Resize every individual frame once, here, so the (much more
    // frequent) per-request compositing step never has to resize
    // anything itself.
    const resizedFrames = [];
    for (let i = 0; i < pages; i++) {
      const frame = nativeData.subarray(i * nativeFrameByteSize, (i + 1) * nativeFrameByteSize);
      const resized = await sharp(frame, {
        raw: { width: NATIVE_DIGIT_WIDTH, height: NATIVE_DIGIT_HEIGHT, channels: 4 },
      })
        .resize(width, height)
        .raw()
        .toBuffer();
      resizedFrames.push(resized);
    }
    data = Buffer.concat(resizedFrames);
  }

  digitCache[cacheKey] = { data, pages, delays, frameByteSize, width, height };
  return digitCache[cacheKey];
}

async function buildImageForNumber(rawCount, options = {}) {
  const { pad = true, digitSet = "view", size = "medium" } = options;
  const scale = SIZE_SCALES[size] || SIZE_SCALES.medium;

  const numberString = pad ? String(rawCount).padStart(PAD_LENGTH, "0") : String(rawCount);
  const digitChars = numberString.split("");
  const uniqueDigits = [...new Set(digitChars)];

  const digitData = {};
  for (const digit of uniqueDigits) {
    digitData[digit] = await getDigitData(digitSet, digit, scale);
  }

  const digitWidth = digitData[uniqueDigits[0]].width;
  const digitHeight = digitData[uniqueDigits[0]].height;

  // Real fix, no shortcuts: instead of forcing every digit onto a
  // single "leader" digit's frame numbers, we build a shared timeline
  // out of the ACTUAL millisecond timestamps where each digit changes
  // frame in its own original file. Every digit then simply shows
  // whichever of its own frames is "current" at each of those
  // timestamps - exactly the pose and timing it would have if you
  // opened that single gif by itself.
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

  // Safety cap (also controlled by COUNTER_MAX_FRAMES in Vercel, if
  // you ever set it) - and, for "large", a stricter cap since bigger
  // frames take noticeably longer to encode (see SIZE_FRAME_CAPS).
  const effectiveMaxFrames = Math.min(MAX_OUTPUT_FRAMES, SIZE_FRAME_CAPS[size] || MAX_OUTPUT_FRAMES);
  if (boundaries.length - 1 > effectiveMaxFrames) {
    const step = (boundaries.length - 1) / effectiveMaxFrames;
    const sampled = Array.from({ length: effectiveMaxFrames + 1 }, (_, i) =>
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
    let lo = 0, hi = dd.pages - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (cum[mid] <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  const totalWidth = digitWidth * digitChars.length;
  const frameByteSize = totalWidth * digitHeight * 4;

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
      const xOffsetBytes = position * digitWidth * 4;

      for (let row = 0; row < digitHeight; row++) {
        const srcStart = row * digitWidth * 4;
        const destStart = row * totalWidth * 4 + xOffsetBytes;
        src.copy(frameBuffer, destStart, srcStart, srcStart + digitWidth * 4);
      }
    });

    outputFrames.push(frameBuffer);
    delays.push(delay);
  }

  const combinedRaw = Buffer.concat(outputFrames);

  const gifBuffer = await sharp(combinedRaw, {
    raw: {
      width: totalWidth,
      height: digitHeight * outputFrames.length,
      channels: 4,
      pageHeight: digitHeight,
    },
  })
    .gif({ delay: delays, loop: 0 })
    .toBuffer();

  return gifBuffer;
}

function isValidName(name) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(name);
}

// Kept for the view counter routes, which always want 6 zero-padded
// digits using the "view" character set.
async function buildCounterImage(rawCount, options = {}) {
  return buildImageForNumber(rawCount, { pad: true, digitSet: "view", ...options });
}

module.exports = { buildCounterImage, buildImageForNumber, isValidName, PAD_LENGTH, SIZE_SCALES };
