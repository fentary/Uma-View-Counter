// lib/digits.js
// Lê os 10 gifs (0 a 9) do disco e monta o SVG do contador.

const fs = require("fs");
const path = require("path");

const DIGIT_WIDTH = 80;
const DIGIT_HEIGHT = 150;

// Guardamos em memória depois da primeira leitura, pra não ler
// o arquivo do disco toda vez (mais rápido nas próximas chamadas).
const cache = {};

function getDigitBase64(digit) {
  if (!cache[digit]) {
    const filePath = path.join(process.cwd(), "digits", `${digit}.gif`);
    cache[digit] = fs.readFileSync(filePath).toString("base64");
  }
  return cache[digit];
}

function buildCounterSVG(numberString) {
  const digits = numberString.split("");
  const totalWidth = DIGIT_WIDTH * digits.length;

  const images = digits
    .map((digit, index) => {
      const x = index * DIGIT_WIDTH;
      const base64 = getDigitBase64(digit);
      return `<image x="${x}" y="0" width="${DIGIT_WIDTH}" height="${DIGIT_HEIGHT}" href="data:image/gif;base64,${base64}" />`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${DIGIT_HEIGHT}" viewBox="0 0 ${totalWidth} ${DIGIT_HEIGHT}">
${images}
</svg>`;
}

function isValidName(name) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(name);
}

module.exports = { buildCounterSVG, isValidName };
