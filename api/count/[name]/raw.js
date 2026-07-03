// api/count/[name]/raw.js
// GET /count/YOURNAME/raw
// Returns just the number, in JSON, no image.

const { redis } = require("../../../lib/redis");
const { isValidName } = require("../../../lib/digits");

module.exports = async (req, res) => {
  const { name } = req.query;

  if (!isValidName(name)) {
    res.status(400).json({ error: "Invalid name" });
    return;
  }

  const current = (await redis.get(`counter:${name}`)) || 0;
  res.status(200).json({ name, count: Number(current) });
};
