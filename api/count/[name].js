// api/count/[name].js
// Main route: GET /count/YOURNAME?size=small|medium|large
// Increments the counter in Redis (this NEVER resets on its own) and
// returns a gif image showing the number, using the VIEW counter
// character set.

const { redis } = require("../../lib/redis");
const { buildCounterImage, isValidName, SIZE_SCALES } = require("../../lib/digits");

function resolveSize(size) {
  return SIZE_SCALES[size] ? size : "medium";
}

module.exports = async (req, res) => {
  const { name } = req.query;

  if (!isValidName(name)) {
    res.status(400).send("Invalid name. Use only letters, numbers, - and _.");
    return;
  }

  const newCount = await redis.incr(`counter:${name}`);
  const gifBuffer = await buildCounterImage(newCount, { size: resolveSize(req.query.size) });

  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.status(200).send(gifBuffer);
};
