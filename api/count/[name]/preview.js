// api/count/[name]/preview.js
// GET /count/SEUNOME/preview
// Mostra o número atual SEM incrementar. Útil pra testar o link.

const { redis } = require("../../../lib/redis");
const { buildCounterSVG, isValidName } = require("../../../lib/digits");

module.exports = async (req, res) => {
  const { name } = req.query;

  if (!isValidName(name)) {
    res.status(400).send("Nome inválido. Use apenas letras, números, - e _.");
    return;
  }

  const current = (await redis.get(`counter:${name}`)) || 0;
  const svg = buildCounterSVG(String(current));

  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.status(200).send(svg);
};
