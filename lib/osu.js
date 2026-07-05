// lib/osu.js
// Talks to the official osu! API (v2) to find a player's global rank.
//
// You need two things from your osu! OAuth application (created at
// https://osu.ppy.sh/home/account/edit under "OAuth"), set as
// environment variables in Vercel:
//   OSU_CLIENT_ID
//   OSU_CLIENT_SECRET

const { redis } = require("./redis");

// The osu! API uses OAuth "client credentials" - basically, our
// server logs in as itself (not as any particular player) to get a
// token, then uses that token to look up public player data.
//
// Kept in memory for as long as the serverless instance stays warm,
// so we don't ask for a new token on every single request.
let cachedToken = null; // { token, expiresAt }

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }

  const response = await fetch("https://osu.ppy.sh/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: process.env.OSU_CLIENT_ID,
      client_secret: process.env.OSU_CLIENT_SECRET,
      grant_type: "client_credentials",
      scope: "public",
    }),
  });

  if (!response.ok) {
    throw new Error(`osu! login failed (${response.status})`);
  }

  const data = await response.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.token;
}

// The generator page shows "std / taiko / catch / mania" (the names
// players know), but the osu! API itself expects "osu / taiko /
// fruits / mania". This translates between the two.
const MODE_ALIASES = {
  std: "osu",
  osu: "osu",
  standard: "osu",
  taiko: "taiko",
  catch: "fruits",
  fruits: "fruits",
  mania: "mania",
};

function normalizeMode(mode) {
  const key = String(mode || "osu").toLowerCase();
  return MODE_ALIASES[key] || "osu";
}

async function fetchRankFromOsu(username, mode) {
  const token = await getAccessToken();
  const apiMode = normalizeMode(mode);

  const url = `https://osu.ppy.sh/api/v2/users/${encodeURIComponent(username)}/${apiMode}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (response.status === 404) {
    return { found: false, rank: null };
  }

  if (!response.ok) {
    throw new Error(`osu! API error (${response.status})`);
  }

  const data = await response.json();
  const rank =
    data.statistics && typeof data.statistics.global_rank === "number"
      ? data.statistics.global_rank
      : null;

  return { found: true, rank, username: data.username };
}

// How long a looked-up rank is cached before we ask the osu! API
// again for the same player+mode. This keeps things fast and stays
// well within osu!'s API rate limits, at the cost of the number
// being up to this many hours "behind" reality - same trade-off the
// site you showed me uses (they mention updates every ~4 hours too).
const CACHE_TTL_SECONDS = 4 * 60 * 60; // 4 hours

async function getUserRank(username, mode) {
  const apiMode = normalizeMode(mode);
  const cacheKey = `rank:${apiMode}:${username.toLowerCase()}`;

  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  const result = await fetchRankFromOsu(username, mode);
  await redis.set(cacheKey, result, { ex: CACHE_TTL_SECONDS });
  return result;
}

module.exports = { getUserRank, normalizeMode };
