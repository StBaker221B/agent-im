// Local web console for the Agent IM spike.
//
// Serves one static page and proxies room reads/writes through the human's
// Matrix account. The access token stays in this process; the browser never
// sees it. Loopback only on purpose (v0).
//
// Usage:
//   npm run ui
//   npm run ui -- --port 8899
//   MATRIX_CONFIG=.tmp/matrix-config.json npm run ui

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/supervisor.mjs";
import { MatrixClient } from "../src/matrix-transport.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const configPath = resolve(root, process.env.MATRIX_CONFIG ?? ".tmp/matrix-config.json");
const portArg = process.argv.indexOf("--port");
const port = Number(portArg >= 0 ? process.argv[portArg + 1] : process.env.UI_PORT ?? 8787);
const host = "127.0.0.1";
const indexFile = join(root, "ui", "index.html");

const config = loadConfig(configPath);
const humanId = config.humans?.[0];
if (!humanId || !config.humanAccessToken) {
  throw new Error(`${configPath} needs humans[0] and humanAccessToken; run setup-matrix first`);
}

const localpart = (id) => String(id).replace(/^@/, "").split(":")[0];

const members = [
  { id: humanId, name: localpart(humanId), kind: "human", roles: [] },
  ...config.humans.slice(1).map((id) => ({ id, name: localpart(id), kind: "human", roles: [] })),
  ...config.agents.map((a) => ({
    id: a.id,
    name: localpart(a.id),
    kind: "agent",
    runtime: a.runtime,
    roles: a.roles ?? [],
  })),
];

const rooms = config.rooms.map((id, i) => ({
  id,
  label: i === 0 ? "群聊" : i === 1 ? "私聊" : `房间 ${i + 1}`,
  kind: i === 0 ? "group" : i === 1 ? "dm" : "room",
}));

const byName = new Map(members.map((m) => [m.name, m.id]));
const nameOf = new Map(members.map((m) => [m.id, m.name]));

const client = new MatrixClient({
  homeserver: config.matrix.homeserver,
  userId: humanId,
  accessToken: config.humanAccessToken,
  kinds: new Map(members.map((m) => [m.id, m.kind])),
  log: () => {},
});

function mentionsIn(text) {
  const out = [];
  for (const m of text.matchAll(/@([A-Za-z0-9._=-]+)(?::([A-Za-z0-9.-]+))?/g)) {
    const id = m[2] ? `@${m[1]}:${m[2]}` : byName.get(m[1]);
    if (id && id !== humanId && !out.includes(id)) out.push(id);
  }
  return out;
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("request body too large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/config") {
    return json(res, 200, {
      human: humanId,
      humanName: localpart(humanId),
      homeserver: config.matrix.homeserver,
      quietWindowMs: config.quietWindowMs,
      rooms,
      members,
    });
  }

  if (url.pathname === "/api/messages") {
    const roomId = url.searchParams.get("room");
    if (!rooms.some((r) => r.id === roomId)) return json(res, 400, { error: "unknown room" });
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 100);
    const messages = await client.getMessages(roomId, { limit });
    return json(
      res,
      200,
      messages.filter((m) => m.text).map((m) => ({
        id: m.id,
        sender: m.sender,
        senderName: nameOf.get(m.sender) ?? localpart(m.sender),
        kind: m.senderKind,
        text: m.text,
        mentions: m.mentions,
        threadId: m.threadId,
        createdAt: m.createdAt,
      })),
    );
  }

  if (url.pathname === "/api/send" && req.method === "POST") {
    const body = await readBody(req);
    const roomId = String(body.roomId ?? "");
    if (!rooms.some((r) => r.id === roomId)) return json(res, 400, { error: "unknown room" });
    const text = String(body.text ?? "").trim();
    if (!text) return json(res, 400, { error: "empty message" });
    const mentions = mentionsIn(text);
    const sent = await client.send(roomId, { threadId: "main", text, mentions });
    return json(res, 200, { eventId: sent.eventId, mentions });
  }

  return json(res, 404, { error: "not found" });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${host}:${port}`);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = await readFile(indexFile);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Length": html.length,
      });
      return res.end(html);
    }

    if (url.pathname === "/favicon.ico") {
      res.writeHead(204);
      return res.end();
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 502, { error: err.message ?? String(err) });
  }
});

server.listen(port, host, () => {
  console.log(`agent-im ui  http://${host}:${port}`);
  console.log(`homeserver   ${config.matrix.homeserver}`);
  console.log(`human        ${humanId}`);
  console.log(`rooms        ${rooms.map((r) => `${r.label}=${r.id}`).join(" ")}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`\n[ui] ${signal}; stopping`);
    server.close(() => process.exit(0));
  });
}
