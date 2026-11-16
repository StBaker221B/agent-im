// Agent IM MVP: control plane + gateway host + web API.
//
// One loopback process owns the human session, the agent workers and the
// web client. The browser talks to /api only; Matrix tokens never leave this
// process.
//
//   npm run start            # http://127.0.0.1:8790
//   npm run start -- --port 8890
//
// The web build lives in ../web/dist. For UI development run Vite there and
// proxy /api to this server.

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Store, dataDir, defaultSystemPrompt, localpart } from "./store.mjs";
import { TEMPLATE_IDS, TEMPLATE_LIST, getTemplate, publicTemplate } from "./role-templates.mjs";
import { createMatrixAdmin } from "./matrix-admin.mjs";
import { createHost } from "./gateway-host.mjs";
import { MatrixClient } from "../spike/src/matrix-transport.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(here, "..", "web", "dist");
const portArg = process.argv.indexOf("--port");
const port = Number(portArg >= 0 ? process.argv[portArg + 1] : (process.env.PORT ?? 8790));
const hostName = "127.0.0.1";
const log = (...args) => console.log(...args);

const store = new Store();
const admin = createMatrixAdmin({
  homeserver: store.homeserver,
  registrationToken: store.registrationToken,
});

const kinds = new Map([[store.human.id, "human"]]);
for (const agent of store.agents) kinds.set(agent.id, "agent");

async function ensureHumanSession() {
  const client = new MatrixClient({
    homeserver: store.homeserver,
    userId: store.human.id,
    accessToken: store.human.accessToken,
    kinds,
  });
  try {
    await client.whoami();
    return client;
  } catch (err) {
    log(`[app] human token rejected (${err.message}); logging in again`);
    const session = await admin.login({ username: store.human.name, password: store.human.password });
    if (!session?.access_token)
      throw new Error("human login failed; check state.json or rerun setup-matrix", { cause: err });
    store.human.accessToken = session.access_token;
    store.save();
    return new MatrixClient({
      homeserver: store.homeserver,
      userId: store.human.id,
      accessToken: session.access_token,
      kinds,
    });
  }
}

const human = await ensureHumanSession();

async function reconcileRooms() {
  for (const room of store.rooms) {
    try {
      const members = await admin.members(human.accessToken, room.id);
      if (!members.length) continue;
      const others = members.filter((m) => m !== store.human.id);
      // Keep the stored kind: a group with one agent still has two members.
      const patch = { memberIds: members };
      if (room.kind === "dm" && others.length === 1) patch.peerId = others[0];
      store.updateRoom(room.id, patch);
    } catch (err) {
      log(`[app] room ${room.id} reconcile failed: ${err.message}`);
    }
  }
}

await reconcileRooms();

const host = await createHost({ store, dataDir, kinds, log });
await host.start();

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req, limit = 256 * 1024) {
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

const nameOf = new Map([store.human.id, ...store.agents.map((a) => a.id)].map((id) => [id, localpart(id)]));

function displayOf(id) {
  if (id === store.human.id) return store.human.displayName;
  return store.agent(id)?.displayName ?? localpart(id);
}

function mentionIdsIn(text, room) {
  const members = new Set(room.memberIds ?? []);
  const byName = new Map();
  const roleCounts = new Map();
  for (const id of members) {
    const agent = store.agent(id);
    for (const alias of [agent?.role, ...(agent?.roles ?? [])].filter(Boolean)) {
      roleCounts.set(alias, (roleCounts.get(alias) ?? 0) + 1);
    }
  }
  for (const id of members) {
    byName.set(localpart(id), id);
    const display = displayOf(id);
    if (display && !byName.has(display)) byName.set(display, id);
    const agent = store.agent(id);
    for (const alias of [agent?.role, ...(agent?.roles ?? [])].filter(Boolean)) {
      if (roleCounts.get(alias) === 1 && !byName.has(alias)) byName.set(alias, id);
    }
  }
  const out = [];
  for (const m of String(text).matchAll(/@([\p{L}\p{N}._=-]+)(?::([A-Za-z0-9.-]+))?/gu)) {
    const id = m[2] ? `@${m[1]}:${m[2]}` : byName.get(m[1]);
    if (id && members.has(id) && id !== store.human.id && !out.includes(id)) out.push(id);
  }
  return out;
}

async function roomMessages(roomId, limit = 100) {
  const messages = await human.getMessages(roomId, { limit });
  return messages.filter((m) => m.text && m.threadId === "main");
}

function messageView(m) {
  return {
    id: m.id,
    sender: m.sender,
    senderName: nameOf.get(m.sender) ?? localpart(m.sender),
    displayName: displayOf(m.sender),
    kind: m.senderKind,
    msgtype: m.msgtype ?? "m.text",
    text: m.text,
    url: m.url ?? null,
    fileInfo: m.fileInfo ?? null,
    mentions: m.mentions,
    createdAt: m.createdAt,
  };
}

async function roomSummary(room) {
  let messages = [];
  try {
    messages = await roomMessages(room.id, 100);
  } catch (err) {
    log(`[app] messages ${room.id} failed: ${err.message}`);
  }
  const last = messages.at(-1) ?? null;
  const unread = messages.filter(
    (m) => m.sender !== store.human.id && (m.createdAt ?? 0) > (room.lastReadTs ?? 0),
  ).length;
  return {
    ...room,
    members: (room.memberIds ?? []).map((id) => ({
      id,
      name: nameOf.get(id) ?? localpart(id),
      displayName: displayOf(id),
      kind: id === store.human.id ? "human" : "agent",
      role: store.agent(id)?.role ?? null,
    })),
    lastMessage: last ? messageView(last) : null,
    unread,
    activity: host.roomActivity(room.id),
  };
}

async function bootstrap() {
  const rooms = await Promise.all(store.rooms.map((room) => roomSummary(room)));
  rooms.sort((a, b) => (b.lastMessage?.createdAt ?? 0) - (a.lastMessage?.createdAt ?? 0));
  const agents = store.publicAgents().map((a) => ({
    ...a,
    kind: "agent",
    status: host.agentStatus(a.id),
  }));
  return {
    human: { id: store.human.id, name: store.human.name, displayName: store.human.displayName },
    homeserver: store.homeserver,
    serverName: store.serverName,
    agents,
    rooms,
    totalUnread: rooms.reduce((n, r) => n + r.unread, 0),
  };
}

async function usageSummary() {
  const today = new Date().toISOString().slice(0, 10);
  const rows = new Map(
    store.agents.map((a) => [
      a.id,
      {
        id: a.id,
        name: a.name,
        displayName: a.displayName,
        todayTurns: 0,
        todayCost: 0,
        totalTurns: 0,
        totalCost: 0,
      },
    ]),
  );
  let text = "";
  try {
    text = await readFile(join(dataDir, "audit.jsonl"), "utf8");
  } catch {
    // no usage yet
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || entry.kind !== "usage" || !entry.agentId) continue;
    const row = rows.get(entry.agentId);
    if (!row) continue;
    const cost = Number(entry.costUsd) || 0;
    row.totalTurns += 1;
    row.totalCost += cost;
    if (String(entry.ts ?? "").slice(0, 10) === today) {
      row.todayTurns += 1;
      row.todayCost += cost;
    }
  }
  const agents = [...rows.values()];
  return {
    today,
    agents,
    totalTurns: agents.reduce((n, a) => n + a.totalTurns, 0),
    totalCost: agents.reduce((n, a) => n + a.totalCost, 0),
    todayTurns: agents.reduce((n, a) => n + a.todayTurns, 0),
    todayCost: agents.reduce((n, a) => n + a.todayCost, 0),
  };
}

function validateUsername(username) {
  if (!/^[a-z0-9._=-]{1,32}$/.test(username)) {
    throw Object.assign(new Error("ID 只能是小写字母、数字和 . _ = -，长度 1–32"), { status: 400 });
  }
  if (store.agent(username)) throw Object.assign(new Error("这个 ID 已经存在"), { status: 409 });
}

const TOOL_MODES = new Set(["template", "full", "off"]);
const FULL_TOOLS = ["Read", "Glob", "Grep", "PowerShell", "Edit", "Write"];

function toolArgsFor(template, mode, runtime) {
  if (runtime !== "claude" || mode === "off") return [];
  const allow = mode === "full" ? FULL_TOOLS : (template?.tools?.allow ?? []);
  if (!allow.length) return [];
  return ["--permission-mode", "dontAsk", "--allowedTools", allow.join(",")];
}

function toolsModeOf(body, fallback = "template") {
  if (TOOL_MODES.has(body.toolsMode)) return body.toolsMode;
  if (body.toolsEnabled === false) return "off";
  if (body.toolsEnabled === true) return "template";
  return fallback;
}

function parseRoles(body) {
  const list = Array.isArray(body.roles)
    ? body.roles.map(String).filter(Boolean)
    : String(body.roles ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  // Template ids are added by the server; keep them out of user tags.
  return list.filter((r) => !TEMPLATE_IDS.includes(r));
}

async function createAgent(body) {
  const username = String(body.username ?? "")
    .trim()
    .toLowerCase();
  const displayName = String(body.displayName ?? "").trim() || username;
  const runtime = body.runtime === "script" ? "script" : "claude";
  const templateId = TEMPLATE_IDS.includes(body.templateId) ? body.templateId : "generic";
  const template = getTemplate(templateId);
  const tags = parseRoles(body);
  const roles = [...new Set([template.id, ...tags])];
  const toolsMode = runtime === "claude" ? toolsModeOf(body, "template") : "off";
  const toolsEnabled = toolsMode !== "off";
  validateUsername(username);

  const password = randomBytes(18).toString("base64url");
  const account = await admin.registerOrLogin({ username, password, displayName });
  await admin.setDisplayName(account.accessToken, account.userId, displayName);

  const agent = {
    id: account.userId,
    name: username,
    username,
    displayName,
    password,
    accessToken: account.accessToken,
    runtime,
    role: template.role,
    templateId,
    script: runtime === "script" ? "reviewer" : undefined,
    roles,
    domains: [],
    systemPrompt:
      String(body.systemPrompt ?? "").trim() ||
      defaultSystemPrompt({ displayName, name: username, roles: [template.name, ...tags] }),
    wakePolicy: runtime === "script" ? "mention_only" : (template.defaultWakePolicy ?? "human_all"),
    toolsMode,
    toolsEnabled,
    dailyBudgetUsd: Math.max(0, Number(body.dailyBudgetUsd) || 0),
    extraArgs: toolArgsFor(template, toolsMode, runtime),
    status: "active",
    agentHome: join(dataDir, "agents", username),
    createdAt: new Date().toISOString(),
  };
  store.addAgent(agent);
  await host.attachAgent(agent);
  log(`[app] agent created ${agent.id} template=${templateId} runtime=${runtime}`);
  return {
    id: agent.id,
    name: agent.name,
    displayName: agent.displayName,
    runtime: agent.runtime,
    role: agent.role,
    templateId: agent.templateId,
    templateName: template.name,
    mission: template.mission,
    roles: agent.roles,
    toolsMode: agent.toolsMode,
    toolsEnabled: agent.toolsEnabled,
    dailyBudgetUsd: Number(agent.dailyBudgetUsd ?? 0),
    status: "idle",
  };
}

const WAKE_POLICIES = new Set(["human_all", "mention_only", "all", "mention_or_reply", "digest"]);

async function updateAgent(agentId, body) {
  const agent = store.agent(agentId);
  if (!agent) throw Object.assign(new Error("agent not found"), { status: 404 });
  const patch = {};
  if (typeof body.displayName === "string" && body.displayName.trim())
    patch.displayName = body.displayName.trim();

  const oldTemplateId = agent.templateId;
  let template = getTemplate(agent.templateId) ?? getTemplate("generic");
  let templateChanged = false;
  if (body.templateId !== undefined) {
    if (!TEMPLATE_IDS.includes(body.templateId))
      throw Object.assign(new Error("bad templateId"), { status: 400 });
    template = getTemplate(body.templateId);
    templateChanged = template.id !== oldTemplateId;
    patch.templateId = template.id;
    patch.role = template.role;
  }

  if (body.roles !== undefined) {
    patch.roles = [...new Set([template.id, ...parseRoles(body)])];
  } else if (templateChanged) {
    patch.roles = [...new Set([template.id, ...(agent.roles ?? []).filter((r) => r !== oldTemplateId)])];
  }

  if (body.wakePolicy !== undefined) {
    if (!WAKE_POLICIES.has(body.wakePolicy))
      throw Object.assign(new Error("bad wakePolicy"), { status: 400 });
    patch.wakePolicy = body.wakePolicy;
  }

  let toolsMode = agent.toolsMode ?? (agent.toolsEnabled ? "template" : "off");
  let toolsChanged = false;
  if (body.toolsMode !== undefined || body.toolsEnabled !== undefined) {
    const next = toolsModeOf(body, toolsMode);
    toolsChanged = next !== toolsMode;
    toolsMode = next;
  }
  const toolsEnabled = toolsMode !== "off";
  if (toolsEnabled !== Boolean(agent.toolsEnabled)) {
    patch.toolsEnabled = toolsEnabled;
    toolsChanged = true;
  }
  if (templateChanged || toolsChanged) {
    patch.toolsMode = toolsMode;
    patch.toolsEnabled = toolsEnabled;
    patch.extraArgs = toolArgsFor(template, toolsMode, agent.runtime);
  }

  const promptChanged = typeof body.systemPrompt === "string" && body.systemPrompt !== agent.systemPrompt;
  if (typeof body.systemPrompt === "string") patch.systemPrompt = body.systemPrompt;
  if (body.dailyBudgetUsd !== undefined) {
    const value = Number(body.dailyBudgetUsd);
    if (!Number.isFinite(value) || value < 0)
      throw Object.assign(new Error("bad dailyBudgetUsd"), { status: 400 });
    patch.dailyBudgetUsd = value;
  }
  Object.assign(agent, patch);
  if (patch.displayName) {
    for (const room of store.rooms) {
      if (room.kind === "dm" && room.peerId === agent.id) room.name = patch.displayName;
    }
    await admin.setDisplayName(agent.accessToken, agent.id, patch.displayName).catch(() => {});
  }
  store.save();
  const engineAgent = host.engine.agents.get(agent.id);
  if (engineAgent) {
    if (patch.displayName) engineAgent.displayName = patch.displayName;
    if (patch.roles) engineAgent.roles = patch.roles;
    if (patch.wakePolicy) engineAgent.wakePolicy = patch.wakePolicy;
    if (templateChanged) engineAgent.role = template.role;
  }
  if (promptChanged || templateChanged || toolsChanged) await host.updateAgent(agent);
  log(`[app] agent updated ${agent.id}`);
  return {
    id: agent.id,
    name: agent.name,
    displayName: agent.displayName,
    runtime: agent.runtime,
    role: agent.role,
    templateId: agent.templateId,
    templateName: template.name,
    mission: template.mission,
    roles: agent.roles,
    toolsMode: agent.toolsMode,
    toolsEnabled: Boolean(agent.toolsEnabled),
    dailyBudgetUsd: Number(agent.dailyBudgetUsd ?? 0),
    wakePolicy: agent.wakePolicy,
    status: host.agentStatus(agent.id),
  };
}

async function createDm(body) {
  const agent = store.agent(String(body.agentId ?? ""));
  if (!agent) throw Object.assign(new Error("agent not found"), { status: 404 });
  const existing = store.dmWith(agent.id);
  if (existing) return { room: await roomSummary(existing), existing: true };

  const roomId = await admin.createRoom(store.human.accessToken, {
    name: agent.displayName,
    invite: [agent.id],
    isDirect: true,
  });
  await admin.join(agent.accessToken, roomId);
  const room = store.addRoom({
    id: roomId,
    kind: "dm",
    mode: "brief",
    name: agent.displayName,
    peerId: agent.id,
    memberIds: [store.human.id, agent.id],
    createdAt: new Date().toISOString(),
    lastReadTs: Date.now(),
  });
  await host.attachRoom(roomId, "brief");
  log(`[app] dm created ${room.id} with ${agent.id}`);
  return { room: await roomSummary(room), existing: false };
}

async function createGroup(body) {
  const name = String(body.name ?? "").trim();
  const rawIds = Array.isArray(body.agentIds) ? body.agentIds : [];
  const ids = [...new Set(rawIds.map(String))];
  if (!name) throw Object.assign(new Error("群聊需要一个名字"), { status: 400 });
  if (!ids.length) throw Object.assign(new Error("至少选择一个 agent"), { status: 400 });
  const agents = ids.map((id) => store.agent(id)).filter(Boolean);
  if (agents.length !== ids.length) throw Object.assign(new Error("有 agent 不存在"), { status: 404 });

  const roomId = await admin.createRoom(store.human.accessToken, {
    name,
    invite: agents.map((a) => a.id),
  });
  for (const agent of agents) await admin.join(agent.accessToken, roomId);
  const room = store.addRoom({
    id: roomId,
    kind: "group",
    mode: "brief",
    name,
    peerId: null,
    memberIds: [store.human.id, ...agents.map((a) => a.id)],
    createdAt: new Date().toISOString(),
    lastReadTs: Date.now(),
  });
  await host.attachRoom(roomId, "brief");
  log(`[app] group created ${room.id} "${name}" agents=${agents.length}`);
  return { room: await roomSummary(room), existing: false };
}

async function updateRoom(roomId, body) {
  const room = store.room(roomId);
  if (!room) throw Object.assign(new Error("room not found"), { status: 404 });
  if (body.mode !== undefined) {
    const mode = body.mode === "discussion" ? "discussion" : "brief";
    store.updateRoom(roomId, { mode });
    host.setRoomMode(roomId, mode);
  }
  return roomSummary(store.room(roomId));
}

async function addMembers(roomId, body) {
  const room = store.room(roomId);
  if (!room) throw Object.assign(new Error("room not found"), { status: 404 });
  if (room.kind === "dm") throw Object.assign(new Error("私聊不能加人；请新建群聊"), { status: 400 });
  const raw = Array.isArray(body.agentIds) ? body.agentIds : [];
  const ids = [...new Set(raw.map(String))].filter((id) => !room.memberIds.includes(id));
  const agents = ids.map((id) => store.agent(id)).filter(Boolean);
  if (!agents.length) return { room: await roomSummary(room), added: [] };
  for (const agent of agents) {
    await admin.invite(store.human.accessToken, roomId, agent.id);
    await admin.join(agent.accessToken, roomId);
  }
  store.updateRoom(roomId, {
    memberIds: [...new Set([...room.memberIds, ...agents.map((a) => a.id)])],
  });
  await host.syncRoom(roomId);
  log(`[app] room ${roomId} invited ${agents.map((a) => a.id).join(",")}`);
  return { room: await roomSummary(store.room(roomId)), added: agents.map((a) => a.id) };
}

async function deleteRoom(roomId) {
  const room = store.room(roomId);
  if (!room) throw Object.assign(new Error("room not found"), { status: 404 });
  await admin
    .leave(store.human.accessToken, roomId)
    .catch((err) => log(`[app] human leave failed: ${err.message}`));
  for (const memberId of room.memberIds) {
    const agent = store.agent(memberId);
    if (!agent) continue;
    await admin
      .leave(agent.accessToken, roomId)
      .catch((err) => log(`[app] ${agent.name} leave failed: ${err.message}`));
  }
  await host.removeRoom(roomId);
  store.removeRoom(roomId);
  log(`[app] room removed ${roomId}`);
  return { ok: true };
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    return json(res, 200, await bootstrap());
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    const health = await host.gateway.health();
    return json(res, 200, { ok: true, running: health.running, rooms: health.rooms });
  }

  if (req.method === "GET" && url.pathname === "/api/role-templates") {
    return json(res, 200, { templates: TEMPLATE_LIST.map(publicTemplate) });
  }

  if (req.method === "GET" && url.pathname === "/api/usage") {
    return json(res, 200, await usageSummary());
  }

  if (req.method === "GET" && url.pathname === "/api/search") {
    const q = String(url.searchParams.get("q") ?? "").trim();
    if (!q) return json(res, 200, { query: "", results: [] });
    const needle = q.toLowerCase();
    const results = [];
    for (const room of store.rooms) {
      let messages = [];
      try {
        messages = await roomMessages(room.id, 100);
      } catch {
        // a room may be unreadable; skip it
      }
      for (const m of messages) {
        if (!m.text?.toLowerCase().includes(needle)) continue;
        results.push({
          room: { id: room.id, kind: room.kind, name: room.name },
          message: messageView(m),
        });
      }
    }
    results.sort((a, b) => (b.message.createdAt ?? 0) - (a.message.createdAt ?? 0));
    return json(res, 200, { query: q, results: results.slice(0, 60) });
  }

  if (req.method === "GET" && parts[1] === "rooms" && parts[3] === "messages" && parts.length === 4) {
    const roomId = decodeURIComponent(parts[2]);
    if (!store.room(roomId)) return json(res, 404, { error: "room not found" });
    const messages = await roomMessages(roomId, 100);
    return json(res, 200, { messages: messages.map(messageView) });
  }

  if (req.method === "POST" && parts[1] === "rooms" && parts[3] === "messages" && parts.length === 4) {
    const roomId = decodeURIComponent(parts[2]);
    const room = store.room(roomId);
    if (!room) return json(res, 404, { error: "room not found" });
    const body = await readBody(req);
    const text = String(body.text ?? "").trim();
    if (!text) return json(res, 400, { error: "消息不能为空" });
    const mentions = mentionIdsIn(text, room);
    const sent = await human.send(roomId, { threadId: "main", text, mentions });
    store.markRead(roomId, Date.now());
    return json(res, 200, {
      eventId: sent.eventId,
      mentions,
      message: {
        id: sent.eventId,
        sender: store.human.id,
        senderName: store.human.name,
        displayName: store.human.displayName,
        kind: "human",
        text,
        mentions,
        createdAt: Date.now(),
      },
    });
  }

  if (req.method === "POST" && parts[1] === "rooms" && parts[3] === "upload" && parts.length === 4) {
    const roomId = decodeURIComponent(parts[2]);
    if (!store.room(roomId)) return json(res, 404, { error: "room not found" });
    const body = await readBody(req, 16 * 1024 * 1024);
    const filename = String(body.filename ?? "file").slice(0, 200);
    const contentType = String(body.contentType ?? "application/octet-stream");
    const bytes = Buffer.from(String(body.data ?? ""), "base64");
    if (!bytes.length) return json(res, 400, { error: "文件为空" });
    if (bytes.length > 8 * 1024 * 1024) return json(res, 400, { error: "文件不能超过 8MB" });
    const mxc = await human.uploadMedia(bytes, { contentType, filename });
    const msgtype = contentType.startsWith("image/") ? "m.image" : "m.file";
    const info = { mimetype: contentType, size: bytes.length };
    const sent = await human.send(roomId, {
      threadId: "main",
      msgtype,
      text: filename,
      url: mxc,
      info,
    });
    store.markRead(roomId, Date.now());
    return json(res, 200, {
      eventId: sent.eventId,
      message: {
        id: sent.eventId,
        sender: store.human.id,
        senderName: store.human.name,
        displayName: store.human.displayName,
        kind: "human",
        msgtype,
        text: filename,
        url: mxc,
        fileInfo: info,
        mentions: [],
        createdAt: Date.now(),
      },
    });
  }

  if (req.method === "GET" && url.pathname === "/api/media") {
    const uri = String(url.searchParams.get("uri") ?? "");
    const match = uri.match(/^mxc:\/\/([^/]+)\/(.+)$/);
    if (!match) return json(res, 400, { error: "bad mxc uri" });
    const media = await human.downloadMedia(match[1], match[2]);
    res.writeHead(200, {
      "Content-Type": media.contentType,
      "Content-Length": media.body.length,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
    return res.end(media.body);
  }

  if (req.method === "POST" && parts[1] === "rooms" && parts[3] === "read" && parts.length === 4) {
    const roomId = decodeURIComponent(parts[2]);
    if (!store.room(roomId)) return json(res, 404, { error: "room not found" });
    const body = await readBody(req);
    store.markRead(roomId, Number(body.ts) || Date.now());
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && parts[1] === "rooms" && parts[3] === "members" && parts.length === 4) {
    const roomId = decodeURIComponent(parts[2]);
    const body = await readBody(req);
    return json(res, 200, await addMembers(roomId, body));
  }

  if (req.method === "DELETE" && parts[1] === "rooms" && parts.length === 3) {
    const roomId = decodeURIComponent(parts[2]);
    return json(res, 200, await deleteRoom(roomId));
  }

  if (req.method === "PATCH" && parts[1] === "rooms" && parts.length === 3) {
    const roomId = decodeURIComponent(parts[2]);
    const body = await readBody(req);
    return json(res, 200, await updateRoom(roomId, body));
  }

  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readBody(req);
    const kind = body.kind === "dm" ? "dm" : "group";
    const result = kind === "dm" ? await createDm(body) : await createGroup(body);
    return json(res, 200, result);
  }

  if (req.method === "POST" && url.pathname === "/api/agents") {
    const body = await readBody(req);
    return json(res, 200, await createAgent(body));
  }

  if (req.method === "PATCH" && parts[1] === "agents" && parts.length === 3) {
    const agentId = decodeURIComponent(parts[2]);
    const body = await readBody(req);
    return json(res, 200, await updateAgent(agentId, body));
  }

  return json(res, 404, { error: "not found" });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

async function serveStatic(res, pathname) {
  if (!existsSync(webDist)) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("web/dist not built yet. Run: cd agent-im/web && npm install && npm run build");
  }
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let file = resolve(webDist, rel);
  if (!file.startsWith(webDist)) file = join(webDist, "index.html");
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
  } catch {
    file = join(webDist, "index.html");
  }
  const data = await readFile(file);
  res.writeHead(200, {
    "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
    "Cache-Control": file.includes(`${join(webDist, "assets")}`)
      ? "public, max-age=31536000, immutable"
      : "no-store",
    "Content-Length": data.length,
    "X-Content-Type-Options": "nosniff",
  });
  res.end(data);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${hostName}:${port}`);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return await serveStatic(res, url.pathname);
  } catch (err) {
    log(`[app] ${req.method} ${url.pathname} -> ${err.status ?? 500} ${err.message}`);
    json(res, err.status ?? 502, { error: err.message ?? String(err) });
  }
});

server.listen(port, hostName, () => {
  log(`agent-im app  http://${hostName}:${port}`);
  log(`homeserver   ${store.homeserver}`);
  log(`human        ${store.human.id}`);
  log(`agents       ${store.agents.map((a) => a.name).join(", ")}`);
  log(`rooms        ${store.rooms.length}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    log(`\n[app] ${signal}; stopping`);
    server.close();
    await host.stop().catch(() => {});
    process.exit(0);
  });
}
