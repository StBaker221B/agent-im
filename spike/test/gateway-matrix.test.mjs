import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MatrixClient } from "../src/matrix-transport.mjs";
import { MockRuntime } from "../src/mock-runtime.mjs";
import { ScriptPeer, scripts } from "../src/script-peer.mjs";
import { createGatewayFromConfig } from "../src/supervisor.mjs";

const API = "/_matrix/client/v3";
const HUMAN = "@kudo:test";
const CLAUDE = "@claude-dev:test";
const PEER = "@script-peer:test";
const GROUP = "!group:test";
const DM = "!dm:test";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await sleep(10);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function startMock() {
  const state = {
    tokens: new Map([
      ["tok-human", HUMAN],
      ["tok-claude", CLAUDE],
      ["tok-peer", PEER],
    ]),
    rooms: new Map([
      [GROUP, new Set([HUMAN, CLAUDE, PEER])],
      [DM, new Set([HUMAN, PEER])],
    ]),
    events: [],
    txns: new Map(),
    seq: 0,
  };
  const userOf = (req) => state.tokens.get(req.headers.authorization?.replace("Bearer ", ""));
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      const json = (code, obj) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      const userId = userOf(req);
      if (!userId) return json(401, { errcode: "M_UNKNOWN_TOKEN" });
      if (req.method === "GET" && p === `${API}/sync`) {
        const since = Number(url.searchParams.get("since") ?? 0) || 0;
        const join = {};
        for (const [roomId, members] of state.rooms) {
          if (!members.has(userId)) continue;
          const events = state.events
            .slice(since)
            .filter((e) => e.roomId === roomId)
            .map(({ roomId: _r, ...ev }) => ev);
          join[roomId] = { timeline: { events } };
        }
        return json(200, { next_batch: String(state.events.length), rooms: { join } });
      }
      if (req.method === "PUT" && p.includes("/send/m.room.message/")) {
        const [, roomEnc] = p.split("/rooms/");
        const roomId = decodeURIComponent(roomEnc.split("/")[0]);
        if (!state.rooms.get(roomId)?.has(userId)) return json(403, { errcode: "M_FORBIDDEN" });
        const txn = decodeURIComponent(p.split("/").at(-1));
        if (state.txns.has(txn)) return json(200, { event_id: state.txns.get(txn) });
        const eventId = `$m${++state.seq}`;
        state.events.push({
          event_id: eventId,
          roomId,
          sender: userId,
          origin_server_ts: Date.now(),
          type: "m.room.message",
          content: body,
        });
        state.txns.set(txn, eventId);
        return json(200, { event_id: eventId });
      }
      if (req.method === "GET" && p.endsWith("/joined_members")) {
        const roomId = decodeURIComponent(p.split("/rooms/")[1].split("/")[0]);
        const members = state.rooms.get(roomId);
        if (!members?.has(userId)) return json(403, { errcode: "M_FORBIDDEN" });
        return json(200, { joined: Object.fromEntries([...members].map((m) => [m, {}])) });
      }
      if (req.method === "GET" && p.endsWith("/messages")) {
        const roomId = decodeURIComponent(p.split("/rooms/")[1].split("/")[0]);
        const chunk = state.events
          .filter((e) => e.roomId === roomId)
          .slice(-50)
          .reverse()
          .map(({ roomId: _r, ...ev }) => ev);
        return json(200, { chunk });
      }
      if (req.method === "GET" && p.includes("/event/")) {
        const id = decodeURIComponent(p.split("/event/")[1]);
        const ev = state.events.find((e) => e.event_id === id);
        if (!ev) return json(404, { errcode: "M_NOT_FOUND" });
        const { roomId: _r, ...rest } = ev;
        return json(200, rest);
      }
      if (req.method === "PUT" && p.includes("/typing/")) return json(200, {});
      if (req.method === "GET" && p === `${API}/account/whoami`) return json(200, { user_id: userId });
      return json(404, { errcode: "M_NOT_FOUND", error: p });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, state, port: server.address().port }));
  });
}

function makeConfig(port, dir) {
  return {
    transport: "matrix",
    matrix: { homeserver: `http://127.0.0.1:${port}` },
    rooms: [GROUP, DM],
    humans: [HUMAN],
    quietWindowMs: 80,
    maxTurnMs: 2000,
    syncTimeoutMs: 30,
    tickMs: 20,
    statePath: join(dir, "state.json"),
    auditPath: join(dir, "audit.jsonl"),
    agents: [
      { id: CLAUDE, runtime: "claude", accessToken: "tok-claude", roles: ["coder"], domains: ["auth"], speakMode: "volunteer", wakePolicy: "mention_or_reply" },
      { id: PEER, runtime: "script", script: "reviewer", accessToken: "tok-peer", roles: ["reviewer"], domains: ["review"], speakMode: "volunteer", wakePolicy: "mention_or_reply" },
    ],
  };
}

function runtimes(mockReply) {
  const mock = new MockRuntime({ agentId: CLAUDE, reply: mockReply });
  const peer = new ScriptPeer({ agentId: PEER, handler: scripts.reviewer });
  return { mock, map: new Map([[CLAUDE, mock], [PEER, peer]]) };
}

test("gateway over the Matrix transport: group chain, DM, restart dedup", async () => {
  const { server, port } = await startMock();
  const dir = mkdtempSync(join(tmpdir(), "agent-im-gwmatrix-"));
  try {
    const humanClient = new MatrixClient({ homeserver: `http://127.0.0.1:${port}`, userId: HUMAN, accessToken: "tok-human" });
    const first = runtimes((envelope, n) =>
      n === 1 ? "方案：JWT + refresh token。@script-peer 你 review 一下。" : "PASS",
    );
    const built1 = await createGatewayFromConfig(makeConfig(port, dir), { runtimes: first.map });
    await built1.gateway.start();

    const sent = await humanClient.send(GROUP, { text: "@claude-dev 登录怎么做？", mentions: [CLAUDE] });
    const groupThread = built1.engine.getThread(GROUP, "main");
    await waitFor(() => groupThread.messages.length >= 3, "group chain");
    await waitFor(() => groupThread.quiescent, "group quiescent");
    assert.equal(groupThread.messages.length, 3);
    assert.equal(groupThread.messages[1].sender, CLAUDE);
    assert.equal(groupThread.messages[2].sender, PEER);
    assert.equal(first.mock.calls.length, 2, "second turn was PASS");

    await humanClient.send(DM, { text: "在吗？" });
    const dmThread = built1.engine.getThread(DM, "main");
    await waitFor(() => dmThread.messages.length >= 2, "dm reply");
    await waitFor(() => dmThread.quiescent, "dm quiescent");
    assert.equal(dmThread.messages[1].sender, PEER);
    assert.match(dmThread.messages[1].text, /@kudo/);

    await built1.gateway.stop();
    await sleep(15);
    const missed = await humanClient.send(GROUP, {
      text: "重启后这条还要回吗？@claude-dev",
      mentions: [CLAUDE],
    });

    const second = runtimes(() => "PASS");
    const built2 = await createGatewayFromConfig(makeConfig(port, dir), { runtimes: second.map });
    await built2.gateway.start();
    await waitFor(() => second.mock.calls.length >= 1, "restart processes missed message");
    const thread2 = built2.engine.getThread(GROUP, "main");
    await waitFor(() => thread2.quiescent, "restart quiescent");

    assert.equal(second.mock.calls.length, 1);
    assert.equal(second.mock.calls[0].id, missed.eventId);
    assert.ok(!second.mock.calls.some((c) => c.id !== missed.eventId), "old messages not re-run");
    assert.ok(thread2.messages.some((m) => m.id === missed.eventId));
    assert.ok(thread2.messages.some((m) => m.id === sent.eventId), "history hydrated");
    await built2.gateway.stop();
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
