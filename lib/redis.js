// lib/redis.js
// Conecta com o banco de dados Upstash Redis usando as chaves
// que o Vercel injeta automaticamente como variáveis de ambiente
// quando você conecta a integração (UPSTASH_REDIS_REST_URL e
// UPSTASH_REDIS_REST_TOKEN).

const { Redis } = require("@upstash/redis");

const redis = Redis.fromEnv();

module.exports = { redis };
