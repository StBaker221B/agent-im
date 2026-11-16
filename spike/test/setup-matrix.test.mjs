import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupMatrix } from "../scripts/setup-matrix.mjs";

const API = "/_matrix/client/v3";

function startMock() {
  const state = { users: new Map(), tokens: new Map(), aliases: new Map(), rooms: new Map(), seq: 0 };
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
      if (req.method === "POST" && p === `${API}/register`) {
        if (state.users.has(body.username)) return json(400, { errcode: "M_USER_IN_USE" });
        const userId = `@${body.username}:test`;
        const accessToken = `token-${body.username}`;
        state.users.set(body.username, { password: body.password, userId });
        state.tokens.set(accessToken, userId);
        return json(200, { user_id: userId, access_token: accessToken, device_id: "dev" });
      }
      if (req.method === "POST" && p === `${API}/login`) {
        const username = body.identifier?.user;
        const user = state.users.get(username);
        if (!user || user.password !== body.password) return json(403, { errcode: "M_FORBIDDEN" });
        const accessToken = `token-${username}`;
        state.tokens.set(accessToken, user.userId);
        return json(200, { user_id: user.userId, access_token: accessToken, device_id: "dev" });
      }
      if (req.method === "PUT" && p.startsWith(`${API}/profile/`)) return json(200, {});
      if (req.method === "GET" && p.startsWith(`${API}/directory/room/`)) {
        const alias = decodeURIComponent(p.split("/directory/room/")[1]);
        const roomId = state.aliases.get(alias);
        return roomId ? json(200, { room_id: roomId }) : json(404, { errcode: "M_NOT_FOUND" });
      }
      if (req.method === "POST" && p === `${API}/createRoom`) {
        const roomId = `!room${++state.seq}:test`;
        if (body.room_alias_name) state.aliases.set(`#${body.room_alias_name}:test`, roomId);
        state.rooms.set(roomId, new Set());
        const creator = state.tokens.get(req.headers.authorization?.replace("Bearer ", ""));
        if (creator) state.rooms.get(roomId).add(creator);
        return json(200, { room_id: roomId });
      }
      if (req.method === "POST" && p.endsWith("/invite")) return json(200, {});
      if (req.method === "POST" && p.startsWith(`${API}/join/`)) {
        const roomId = decodeURIComponent(p.split("/join/")[1]);
        const userId = state.tokens.get(req.headers.authorization?.replace("Bearer ", ""));
        if (!state.rooms.has(roomId)) return json(404, { errcode: "M_NOT_FOUND" });
        state.rooms.get(roomId).add(userId);
        return json(200, { room_id: roomId });
      }
      return json(404, { errcode: "M_NOT_FOUND", error: p });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, state, port: server.address().port }));
  });
}

test("setup-matrix registers users, creates group+DM, and is idempotent", async () => {
  const { server, state, port } = await startMock();
  const dir = mkdtempSync(join(tmpdir(), "agent-im-setup-"));
  try {
    const opts = {
      homeserver: `http://127.0.0.1:${port}`,
      serverName: "test",
      roomAliasLocalpart: "agent-room",
      usersPath: join(dir, "users.json"),
      outPath: join(dir, "config.json"),
      cwd: dir,
      log: () => {},
    };
    const first = await setupMatrix(opts);
    assert.equal(first.config.transport, "matrix");
    assert.equal(first.config.rooms.length, 2);
    assert.equal(first.config.agents.length, 2);
    assert.equal(first.config.humans.length, 1);
    assert.ok(first.config.agents.every((a) => a.accessToken));
    assert.equal(state.users.size, 3);
    assert.equal(state.rooms.size, 2);
    assert.equal(state.rooms.get(first.groupRoomId).size, 3, "human + 2 agents in group");
    assert.equal(state.rooms.get(first.dmRoomId).size, 2, "human + peer in dm");

    const configOnDisk = JSON.parse(readFileSync(opts.outPath, "utf8"));
    assert.deepEqual(configOnDisk.rooms, first.config.rooms);
    assert.ok(configOnDisk.humanAccessToken);

    const second = await setupMatrix(opts);
    assert.equal(second.groupRoomId, first.groupRoomId);
    assert.equal(second.dmRoomId, first.dmRoomId);
    assert.equal(state.rooms.size, 2, "second run reuses rooms");
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
