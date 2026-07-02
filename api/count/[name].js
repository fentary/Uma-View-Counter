// api/count/[name].js
// Rota principal: GET /count/SEUNOME
// Soma +1 no Redis (isso NUNCA zera sozinho) e devolve a imagem.

const { redis } = require("../../lib/redis");
const { buildCounterSVG, isValidName } = require("../../lib/digits");

module.exports = async (req, res) => {
  const { name } = req.query;

  if (!isValidName(name)) {
    res.status(400).send("Nome inválido. Use apenas letras, números, - e _.");
    return;
  }

  const newCount = await redis.incr(`counter:${name}`);
  const svg = buildCounterSVG(String(newCount));

  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.status(200).send(svg);
};
