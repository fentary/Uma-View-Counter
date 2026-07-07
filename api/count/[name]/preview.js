// api/count/[name]/preview.js
// GET /count/YOURNAME/preview?size=small|medium
// Shows the current number WITHOUT incrementing it. Useful for testing.

const { redis } = require("../../../lib/redis");
const { buildCounterImage, isValidName, SIZE_SCALES } = require("../../../lib/digits");

function resolveSize(size) {
  return SIZE_SCALES[size] ? size : "medium";
}

module.exports = async (req, res) => {
  const { name } = req.query;

  if (!isValidName(name)) {
    res.status(400).send("Invalid name. Use only letters, numbers, - and _.");
    return;
  }

  const current = (await redis.get(`counter:${name}`)) || 0;
  const gifBuffer = await buildCounterImage(current, { size: resolveSize(req.query.size) });

  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.status(200).send(gifBuffer);
};
