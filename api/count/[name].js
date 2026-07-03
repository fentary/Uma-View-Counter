// api/count/[name].js
// Main route: GET /count/YOURNAME
// Increments the counter in Redis (this NEVER resets on its own) and
// returns a PNG image showing the number.

const { redis } = require("../../lib/redis");
const { buildCounterImage, isValidName } = require("../../lib/digits");

module.exports = async (req, res) => {
  const { name } = req.query;

  if (!isValidName(name)) {
    res.status(400).send("Invalid name. Use only letters, numbers, - and _.");
    return;
  }

  const newCount = await redis.incr(`counter:${name}`);
  const pngBuffer = await buildCounterImage(newCount);

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.status(200).send(pngBuffer);
};
