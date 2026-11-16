// Idempotent local Matrix setup for the spike.
// Registers users (or logs in if they exist), creates a group room + a DM,
// and writes .tmp/matrix-config.json with access tokens for the gateway.
//
// Usage:
//   node scripts/setup-matrix.mjs
//   node scripts/setup-matrix.mjs --homeserver http://127.0.0.1:8008 --server-name localhost
//
// Prerequisite: a local Tuwunel homeserver with registration enabled
// (see docs/12-matrix-host-wsl.md). Tokens are written under spike/.tmp,
// which is gitignored. Do not commit them.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SYSTEM_PROMPT = `You are @claude-dev, a coding agent participating in a multi-agent IM room.
Reply as yourself, one concise message. Do not prefix your name.
Follow the response markers in the user message.
Do not use tools unless the human explicitly asks for code changes or commands.`;

export function defaultUsers() {
  const password = () => randomBytes(12).toString("base64url");
  return {
    users: [
      { username: "kudo", kind: "human", displayName: "Kudo", password: password() },
      { username: "claude-dev", kind: "agent", displayName: "Claude Dev", password: password(), runtime: "claude", roles: ["coder"], domains: ["auth"], speakMode: "volunteer", wakePolicy: "mention_or_reply", systemPrompt: SYSTEM_PROMPT },
      { username: "script-peer", kind: "agent", displayName: "Script Peer", password: password(), runtime: "script", script: "reviewer", roles: ["reviewer"], domains: ["review"], speakMode: "volunteer", wakePolicy: "mention_or_reply" },
    ],
  };
}

export async function setupMatrix({
  homeserver = "http://127.0.0.1:8008",
  serverName = "localhost",
  roomAliasLocalpart = "agent-room",
  usersPath = resolve(join(process.cwd(), ".tmp", "matrix-users.json")),
  outPath = resolve(join(process.cwd(), ".tmp", "matrix-config.json")),
  registrationToken = process.env.MATRIX_REGISTRATION_TOKEN ?? "",
  cwd = process.cwd(),
  log = console.log,
} = {}) {
  const base = homeserver.replace(/\/+$/, "");

  function loadUsers() {
    if (!existsSync(usersPath)) {
      const data = defaultUsers();
      mkdirSync(dirname(usersPath), { recursive: true });
      writeFileSync(usersPath, JSON.stringify(data, null, 2) + "\n", "utf8");
      log(`created ${usersPath} (keep it local; it contains dev passwords)`);
      return data;
    }
    return JSON.parse(readFileSync(usersPath, "utf8"));
  }

  async function request(method, path, { body, token } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, body: json };
  }

  async function login(user) {
    const res = await request("POST", "/_matrix/client/v3/login", {
      body: {
        type: "m.login.password",
        identifier: { type: "m.id.user", user: user.username },
        password: user.password,
        initial_device_display_name: "agent-im",
      },
    });
    return res.ok ? res.body : null;
  }

  async function register(user) {
    const baseBody = {
      username: user.username,
      password: user.password,
      initial_device_display_name: "agent-im",
    };
    const query = registrationToken ? `?kind=user&token=${encodeURIComponent(registrationToken)}` : "?kind=user";
    let res = await request("POST", `/_matrix/client/v3/register${query}`, { body: baseBody });
    if (res.ok) return res.body;
    if (res.body?.errcode === "M_USER_IN_USE") return null;

    // UIAA: some servers require a second request with the same session and a
    // flow-specific auth dict. Try the token flow first when configured, then
    // dummy registration.
    const session = res.body?.session;
    const flows = res.body?.flows ?? [];
    const attempts = [];
    if (registrationToken) {
      attempts.push({ type: "m.login.registration_token", token: registrationToken });
    }
    if (flows.includes("m.login.dummy")) attempts.push({ type: "m.login.dummy" });
    for (const auth of attempts) {
      res = await request("POST", "/_matrix/client/v3/register?kind=user", {
        body: { ...baseBody, auth, ...(session ? { session } : {}) },
      });
      if (res.ok) return res.body;
      if (res.body?.errcode === "M_USER_IN_USE") return null;
    }
    throw new Error(`register ${user.username} failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  async function registerOrLogin(user) {
    const reg = await register(user);
    if (reg?.access_token && reg?.user_id) return { userId: reg.user_id, accessToken: reg.access_token };
    const logRes = await login(user);
    if (logRes?.access_token && logRes?.user_id) return { userId: logRes.user_id, accessToken: logRes.access_token };
    throw new Error(
      `cannot register or log in ${user.username}. If the account exists with another password, delete ${usersPath} and reset the homeserver database.`,
    );
  }

  async function setDisplayName(token, userId, displayName) {
    if (!displayName) return;
    await request("PUT", `/_matrix/client/v3/profile/${encodeURIComponent(userId)}/displayname`, {
      token,
      body: { displayname: displayName },
    });
  }

  async function resolveAlias(alias) {
    const res = await request("GET", `/_matrix/client/v3/directory/room/${encodeURIComponent(alias)}`);
    return res.ok ? res.body.room_id : null;
  }

  async function createRoom(token, body) {
    const res = await request("POST", "/_matrix/client/v3/createRoom", { token, body });
    if (!res.ok) throw new Error(`createRoom failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.room_id;
  }

  async function invite(token, roomId, userId) {
    const res = await request("POST", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`, {
      token,
      body: { user_id: userId },
    });
    if (!res.ok && !["M_FORBIDDEN", "M_BAD_STATE"].includes(res.body?.errcode)) {
      throw new Error(`invite ${userId} to ${roomId} failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
  }

  async function joinRoom(token, roomId) {
    const res = await request("POST", `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, { token, body: {} });
    if (!res.ok) throw new Error(`join ${roomId} failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body?.room_id ?? roomId;
  }

  async function main() {
    const { users } = loadUsers();
    const humans = users.filter((u) => (u.kind ?? "human") === "human");
    const agents = users.filter((u) => u.kind === "agent");
    if (!humans.length) throw new Error("at least one human user is required");

    const accounts = new Map();
    for (const user of users) {
      const account = await registerOrLogin(user);
      accounts.set(user.username, account);
      await setDisplayName(account.accessToken, account.userId, user.displayName);
      log(`ok ${user.username} -> ${account.userId}`);
    }

    const firstHuman = accounts.get(humans[0].username);
    const agentAccounts = agents.map((a) => ({ user: a, ...accounts.get(a.username) }));
    const groupAlias = `#${roomAliasLocalpart}:${serverName}`;
    const dmAlias = `#${roomAliasLocalpart}-dm:${serverName}`;

    let groupRoomId = await resolveAlias(groupAlias);
    if (!groupRoomId) {
      groupRoomId = await createRoom(firstHuman.accessToken, {
        name: "Agent IM",
        room_alias_name: roomAliasLocalpart,
        preset: "private_chat",
        invite: agentAccounts.map((a) => a.userId),
        creation_content: { "m.federate": false },
      });
      log(`created group ${groupAlias} -> ${groupRoomId}`);
    } else {
      log(`reusing group ${groupAlias} -> ${groupRoomId}`);
    }
    for (const agent of agentAccounts) {
      await invite(firstHuman.accessToken, groupRoomId, agent.userId);
      await joinRoom(agent.accessToken, groupRoomId);
      log(`joined ${agent.user.username} to group`);
    }

    const dmPeer = agentAccounts.find((a) => a.user.script === "reviewer") ?? agentAccounts[0];
    let dmRoomId = await resolveAlias(dmAlias);
    if (!dmRoomId) {
      dmRoomId = await createRoom(firstHuman.accessToken, {
        name: "Agent IM DM",
        room_alias_name: `${roomAliasLocalpart}-dm`,
        preset: "private_chat",
        invite: [dmPeer.userId],
        is_direct: true,
        creation_content: { "m.federate": false },
      });
      log(`created dm ${dmAlias} -> ${dmRoomId}`);
    } else {
      log(`reusing dm ${dmAlias} -> ${dmRoomId}`);
    }
    await invite(firstHuman.accessToken, dmRoomId, dmPeer.userId);
    await joinRoom(dmPeer.accessToken, dmRoomId);
    log(`joined ${dmPeer.user.username} to dm`);

    const agentsConfig = agentAccounts.map(({ user, userId, accessToken }) => ({
      id: userId,
      runtime: user.runtime ?? "script",
      script: user.script,
      accessToken,
      roles: user.roles ?? [],
      domains: user.domains ?? [],
      speakMode: user.speakMode ?? "volunteer",
      wakePolicy: user.wakePolicy ?? "mention_or_reply",
      canInvite: user.canInvite ?? "allowlist",
      allowlist: user.allowlist ?? [],
      systemPrompt: user.systemPrompt,
      agentHome: join(cwd, ".tmp", "agents", user.username),
    }));

    const config = {
      transport: "matrix",
      matrix: { homeserver: base },
      rooms: [groupRoomId, dmRoomId],
      humans: [firstHuman.userId],
      humanAccessToken: firstHuman.accessToken,
      quietWindowMs: 30_000,
      maxTurnMs: 300_000,
      syncTimeoutMs: 30_000,
      tickMs: 1000,
      statePath: join(cwd, ".tmp", "matrix-gateway-state.json"),
      auditPath: join(cwd, ".tmp", "audit.jsonl"),
      agents: agentsConfig,
    };
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(config, null, 2) + "\n", "utf8");
    log(`\nwrote ${outPath}`);
    log(`group: ${groupRoomId}`);
    log(`dm:    ${dmRoomId}`);
    log("tokens are in the config file; do not commit it (spike/.tmp is gitignored).");
    log("next: npm run matrix-gateway");
    return { config, groupRoomId, dmRoomId, accounts };
  }

  return main();
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : fallback;
  };
  setupMatrix({
    homeserver: arg("homeserver", "http://127.0.0.1:8008"),
    serverName: arg("server-name", "localhost"),
    roomAliasLocalpart: arg("room-alias", "agent-room"),
    usersPath: resolve(arg("users", join(process.cwd(), ".tmp", "matrix-users.json"))),
    outPath: resolve(arg("out", join(process.cwd(), ".tmp", "matrix-config.json"))),
    registrationToken: arg("registration-token", process.env.MATRIX_REGISTRATION_TOKEN ?? ""),
  }).catch((err) => {
    console.error(err.stack ?? err.message ?? err);
    process.exitCode = 1;
  });
}
