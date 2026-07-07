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

// The selectable display sizes, as a scale factor relative to the
// native 80x150 sprite size.
const SIZE_SCALES = { small: 0.6, medium: 1 };

const SIZE_FRAME_CAPS = { small: 90, medium: 90 };

function resolveDigitFolder(digitSet, size) {
  if (size === "medium") return path.join(process.cwd(), "digits", digitSet);
  return path.join(process.cwd(), "digits", digitSet, size);
}

// Cached per (digitSet:size:digit), kept in memory for as long as the
// serverless function instance stays warm.
const digitCache = {};

async function decodeGifBuffer(fileBuffer) {
  const image = sharp(fileBuffer, { animated: true });
  const metadata = await image.metadata();
  const pages = metadata.pages || 1;
  const delays = metadata.delay && metadata.delay.length === pages
    ? metadata.delay
    : new Array(pages).fill(33);

  const { data } = await image.raw().toBuffer({ resolveWithObject: true });
  const width = metadata.width;
  const height = metadata.pageHeight || metadata.height;

  return { data, pages, delays, width, height };
}

async function getDigitData(digitSet, digit, size) {
  const cacheKey = `${digitSet}:${size}:${digit}`;
  if (digitCache[cacheKey]) return digitCache[cacheKey];

  const preferredPath = path.join(resolveDigitFolder(digitSet, size), `${digit}.gif`);

  let decoded;
  if (fs.existsSync(preferredPath)) {
    // A pre-rendered file exists (either the native "medium" file, or
    // a "small" version made by scripts/prerender-sizes.js) - use it
    // directly, no resizing needed at request time.
    decoded = await decodeGifBuffer(fs.readFileSync(preferredPath));
  } else {
    // No pre-rendered "small" file for this digit set yet (e.g. you
    // just dropped new gifs straight into digits/<set>/ without
    // running the prerender script). Fall back to resizing the
    // original file on the fly, just this once - the result gets
    // cached in memory, so this only happens on the first request
    // per digit after a cold start, not on every view.
    const basePath = path.join(process.cwd(), "digits", digitSet, `${digit}.gif`);
    const base = await decodeGifBuffer(fs.readFileSync(basePath));
    const scale = SIZE_SCALES[size] || 1;

    if (scale === 1) {
      decoded = base;
    } else {
      const newWidth = Math.round(base.width * scale);
      const newHeight = Math.round(base.height * scale);
      const resizedRaw = await sharp(base.data, {
        raw: { width: base.width, height: base.height * base.pages, channels: 4 },
      })
        .resize({ width: newWidth, height: newHeight * base.pages, fit: "fill" })
        .raw()
        .toBuffer();

      decoded = { data: resizedRaw, pages: base.pages, delays: base.delays, width: newWidth, height: newHeight };
    }
  }

  const frameByteSize = decoded.width * decoded.height * 4;
  digitCache[cacheKey] = { ...decoded, frameByteSize };
  return digitCache[cacheKey];
}

async function buildImageForNumber(rawCount, options = {}) {
  const { pad = true, digitSet = "view", size = "medium" } = options;
  const resolvedSize = SIZE_SCALES[size] ? size : "medium";

  const numberString = pad ? String(rawCount).padStart(PAD_LENGTH, "0") : String(rawCount);
  const digitChars = numberString.split("");
  const uniqueDigits = [...new Set(digitChars)];

  const digitData = {};
  for (const digit of uniqueDigits) {
    digitData[digit] = await getDigitData(digitSet, digit, resolvedSize);
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
  const effectiveMaxFrames = Math.min(MAX_OUTPUT_FRAMES, SIZE_FRAME_CAPS[resolvedSize] || MAX_OUTPUT_FRAMES);
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
