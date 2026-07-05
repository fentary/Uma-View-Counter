// api/rank/[username].js
// GET /rank/USERNAME?mode=osu|taiko|catch|mania
// Looks up the player's global rank on osu! and returns it drawn
// with the same character gifs as the view counter - no leading
// zeros, just the real rank number.

const { getUserRank } = require("../../lib/osu");
const { buildImageForNumber } = require("../../lib/digits");

// osu! usernames can contain spaces and unicode characters, so this
// is more permissive than the view counter's name validator - it
// just blocks characters that would break the URL/path.
function isValidUsername(username) {
  return (
    typeof username === "string" &&
    username.length >= 1 &&
    username.length <= 32 &&
    !/[\/\\]/.test(username)
  );
}

module.exports = async (req, res) => {
  const { username } = req.query;
  const mode = req.query.mode || "osu";

  if (!isValidUsername(username)) {
    res.status(400).send("Invalid username.");
    return;
  }

  let result;
  try {
    result = await getUserRank(username, mode);
  } catch (err) {
    res.status(502).send("Could not reach the osu! API right now.");
    return;
  }

  // Player doesn't exist, or exists but has no rank yet in this mode
  // (e.g. never submitted a ranked score) - show 0 rather than error,
  // so the image always loads something instead of breaking.
  const rank = result.found && result.rank ? result.rank : 0;

  const gifBuffer = await buildImageForNumber(rank, { pad: false });

  res.setHeader("Content-Type", "image/gif");
  // Ranks don't change every second like a view counter, so a short
  // cache is fine here and reduces load further.
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.status(200).send(gifBuffer);
};
