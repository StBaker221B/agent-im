// Send a message as the configured human, resolving @localpart to m.mentions.
// Usage:
//   npm run say -- --text "@claude-dev 你好"
//   npm run say -- --room dm --text "在吗？"
//   npm run say -- --thread '$eventid' --text "继续"
//
// The human access token comes from .tmp/matrix-config.json (gitignored).

import { join } from "node:path";
import { loadConfig } from "../src/supervisor.mjs";
import { MatrixClient } from "../src/matrix-transport.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const configPath = arg("config", join(process.cwd(), ".tmp", "matrix-config.json"));
const config = loadConfig(configPath);
const humanId = config.humans?.[0];
const accessToken = config.humanAccessToken ?? process.env.MATRIX_HUMAN_TOKEN;
if (!humanId || !accessToken) throw new Error("config needs humans[0] and humanAccessToken (or MATRIX_HUMAN_TOKEN)");

const text = arg("text", "");
if (!text) throw new Error("missing --text");
const roomArg = arg("room", config.rooms?.[0]);
const roomId =
  roomArg === "dm" ? config.rooms?.[1] : roomArg === "group" ? config.rooms?.[0] : roomArg;
if (!roomId) throw new Error("missing room");

const localparts = new Map();
for (const id of [...(config.humans ?? []), ...(config.agents ?? []).map((a) => a.id)]) {
  localparts.set(String(id).replace(/^@/, "").split(":")[0], id);
}
const mentions = [];
for (const m of text.matchAll(/@([A-Za-z0-9._=-]+)(?::([A-Za-z0-9.-]+))?/g)) {
  const id = m[2] ? `@${m[1]}:${m[2]}` : localparts.get(m[1]);
  if (id && id !== humanId && !mentions.includes(id)) mentions.push(id);
}

const client = new MatrixClient({
  homeserver: config.matrix.homeserver,
  userId: humanId,
  accessToken,
  kinds: new Map([
    ...(config.humans ?? []).map((id) => [id, "human"]),
    ...(config.agents ?? []).map((a) => [a.id, "agent"]),
  ]),
});
const sent = await client.send(roomId, {
  threadId: arg("thread", "main"),
  text,
  mentions,
});
console.log(`sent ${sent.eventId} to ${roomId} mentions=${JSON.stringify(mentions)}`);
