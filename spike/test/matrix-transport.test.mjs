import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { MatrixClient } from "../src/matrix-transport.mjs";

const API = "/_matrix/client/v3";

function startMock() {
  const state = { sends: [], byTxn: new Map(), requests: [] };
  const msg = (id, body, ts, extra = {}) => ({
    type: "m.room.message",
    event_id: id,
    sender: "@kudo:test",
    origin_server_ts: ts,
    content: { msgtype: "m.text", body, ...extra },
  });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    state.requests.push(`${req.method} ${p}`);
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      const json = (code, obj) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      if (req.method === "GET" && p === `${API}/sync`) {
        if (!url.searchParams.get("since")) {
          return json(200, {
            next_batch: "s1",
            rooms: {
              join: {
                "!r:test": {
                  timeline: {
                    events: [
                      msg("$m1", "hello", 1700000000000, {
                        "m.mentions": { user_ids: ["@claude-dev:test"] },
                        "m.relates_to": {
                          rel_type: "m.thread",
                          event_id: "$root",
                          "m.in_reply_to": { event_id: "$m0" },
                        },
                        "com.agentim.intent": "proposal",
                      }),
                    ],
                  },
                },
              },
            },
          });
        }
        return json(200, { next_batch: "s2", rooms: { join: {} } });
      }
      if (req.method === "PUT" && p.includes("/send/m.room.message/")) {
        const txn = decodeURIComponent(p.split("/").at(-1));
        if (state.byTxn.has(txn)) return json(200, { event_id: state.byTxn.get(txn) });
        const eventId = `$sent${state.sends.length + 1}`;
        state.byTxn.set(txn, eventId);
        state.sends.push({ txn, body });
        return json(200, { event_id: eventId });
      }
      if (req.method === "GET" && p.endsWith("/joined_members")) {
        return json(200, { joined: { "@kudo:test": {}, "@claude-dev:test": {} } });
      }
      if (req.method === "GET" && p.endsWith("/messages")) {
        return json(200, {
          chunk: [
            msg("$m3", "third", 3000),
            msg("$m2", "second", 2000),
            msg("$m1", "first", 1000),
          ],
        });
      }
      if (req.method === "GET" && p.includes("/event/")) {
        const id = decodeURIComponent(p.split("/event/").at(-1));
        return json(200, msg(id, "root message", 500));
      }
      if (req.method === "GET" && p.startsWith(`${API}/directory/room/`)) {
        return json(200, { room_id: "!r:test" });
      }
      if (req.method === "POST" && p.startsWith(`${API}/join/`)) {
        return json(200, { room_id: "!r:test" });
      }
      if (req.method === "PUT" && p.includes("/typing/")) return json(200, {});
      if (req.method === "GET" && p === `${API}/account/whoami`) return json(200, { user_id: "@claude-dev:test" });
      return json(404, { errcode: "M_NOT_FOUND", error: p });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, state, port: server.address().port }));
  });
}

function clientFor(port) {
  return new MatrixClient({
    homeserver: `http://127.0.0.1:${port}`,
    userId: "@claude-dev:test",
    accessToken: "test-token",
    kinds: new Map([["@claude-dev:test", "agent"]]),
  });
}

test("sync normalizes thread, mentions, reply, intent and sender kind", async () => {
  const { server, port } = await startMock();
  try {
    const client = clientFor(port);
    const { events, nextToken, rooms } = await client.sync(undefined, { timeoutMs: 10 });
    assert.equal(nextToken, "s1");
    assert.deepEqual(rooms, ["!r:test"]);
    assert.equal(events.length, 1);
    const ev = events[0];
    assert.equal(ev.id, "$m1");
    assert.equal(ev.roomId, "!r:test");
    assert.equal(ev.threadId, "$root");
    assert.equal(ev.replyTo, "$m0");
    assert.equal(ev.sender, "@kudo:test");
    assert.equal(ev.senderKind, "human");
    assert.equal(ev.intent, "proposal");
    assert.deepEqual(ev.mentions, ["@claude-dev:test"]);
    assert.equal(ev.createdAt, 1700000000000);
  } finally {
    server.close();
  }
});

test("send builds thread/mention/intent content and is idempotent by txn id", async () => {
  const { server, state, port } = await startMock();
  try {
    const client = clientFor(port);
    const first = await client.send("!r:test", {
      threadId: "$root",
      text: "hi @kudo",
      mentions: ["@kudo:test"],
      intent: "proposal",
      txnId: "tx-1",
    });
    assert.equal(first.eventId, "$sent1");
    assert.equal(first.txnId, "tx-1");
    assert.equal(state.sends.length, 1);
    const body = state.sends[0].body;
    assert.equal(body.msgtype, "m.text");
    assert.equal(body.body, "hi @kudo");
    assert.deepEqual(body["m.mentions"].user_ids, ["@kudo:test"]);
    assert.equal(body["m.relates_to"].rel_type, "m.thread");
    assert.equal(body["m.relates_to"].event_id, "$root");
    assert.equal(body["com.agentim.intent"], "proposal");

    const second = await client.send("!r:test", { text: "retry", txnId: "tx-1" });
    assert.equal(second.eventId, "$sent1");
    assert.equal(state.sends.length, 1, "same txn id must not create a second event");
  } finally {
    server.close();
  }
});

test("getMessages reverses to chronological and normalizes", async () => {
  const { server, port } = await startMock();
  try {
    const client = clientFor(port);
    const messages = await client.getMessages("!r:test", { limit: 3 });
    assert.deepEqual(
      messages.map((m) => m.id),
      ["$m1", "$m2", "$m3"],
    );
  } finally {
    server.close();
  }
});

test("members, joinRoom, resolveAlias, getEvent, whoami, typing", async () => {
  const { server, port } = await startMock();
  try {
    const client = clientFor(port);
    assert.deepEqual(await client.members("!r:test"), ["@kudo:test", "@claude-dev:test"]);
    assert.equal(await client.joinRoom("#r:test"), "!r:test");
    assert.equal(await client.resolveAlias("#r:test"), "!r:test");
    const root = await client.getEvent("!r:test", "$root");
    assert.equal(root.id, "$root");
    assert.equal(root.text, "root message");
    assert.equal((await client.whoami()).user_id, "@claude-dev:test");
    await client.setTyping("!r:test", true);
  } finally {
    server.close();
  }
});
